import { buildKapsoFields } from '@kapso/whatsapp-cloud-api';
import { generateAIResponse, type ChatHistoryMessage } from '@/lib/ai-client';
import { isGreeting, matchMenuOption, MENU_MESSAGE } from '@/lib/auto-reply-flow';
import { whatsappClient } from '@/lib/whatsapp-client';
import { emitInboxUpdate } from '@/lib/event-bus';

// Mismo patrón que en src/app/api/webhooks/whatsapp/route.ts y
// src/app/api/conversations/route.ts: el texto que Kapso genera para un
// evento de reacción ("Reacted with 👍 to message ..." / "Reaction removed
// from message ...") no es algo que el cliente haya escrito — si se cuela en
// el historial que le mandamos a la IA, la confunde (puede intentar
// "responder" a esa frase como si fuera un mensaje real).
const REACTION_EVENT_TEXT_PATTERN = /^(Reacted with .+ to message |Reaction removed from message )/;

/**
 * Funcionalidad "Historial real para la IA": trae los últimos mensajes de
 * texto reales de esta conversación (ni reacciones ni ruido) para que
 * generateAIResponse (src/lib/ai-client.ts) sepa qué se habló antes, en vez
 * de responder como si fuera la primera vez que el cliente escribe. Se
 * ordena del más viejo al más nuevo, terminando en el mensaje entrante al
 * que se está respondiendo. Si algo falla (o no hay conversationId), se
 * cae en un historial de un solo mensaje — el comportamiento de antes.
 */
async function fetchRecentConversationHistory(
  phoneNumberId: string,
  conversationId: string,
  incomingText: string,
): Promise<ChatHistoryMessage[]> {
  try {
    const response = await whatsappClient.messages.listByConversation({
      phoneNumberId,
      conversationId,
      limit: 20,
      fields: buildKapsoFields(['direction', 'content'])
    });

    const history = response.data
      .map((msg) => {
        if (msg.type === 'reaction') return undefined;

        const kapso = msg.kapso as { direction?: string; content?: unknown } | undefined;
        const rawContent = kapso?.content;
        const content = typeof rawContent === 'string'
          ? rawContent
          : (rawContent && typeof rawContent === 'object' && 'text' in rawContent && typeof (rawContent as { text?: unknown }).text === 'string')
            ? (rawContent as { text: string }).text
            : (typeof msg.text?.body === 'string' ? msg.text.body : undefined);

        if (!content || REACTION_EVENT_TEXT_PATTERN.test(content)) return undefined;

        return {
          role: (kapso?.direction === 'outbound' ? 'assistant' : 'user') as ChatHistoryMessage['role'],
          content,
          timestamp: msg.timestamp
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
      // Últimos 12 turnos de contexto — de sobra para que la IA entienda por
      // dónde va la conversación sin mandarle el historial completo cada vez.
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));

    if (history.length === 0) {
      return [{ role: 'user', content: incomingText }];
    }

    // El mensaje al que se está respondiendo debe quedar al final — por si
    // el fetch todavía no lo incluye (una carrera con la propia escritura en
    // Kapso), se agrega a mano en vez de asumir que ya está.
    const last = history[history.length - 1];
    if (last.role !== 'user' || last.content !== incomingText) {
      history.push({ role: 'user', content: incomingText });
    }

    return history;
  } catch (error) {
    console.error('Failed to fetch conversation history for AI context:', error);
    return [{ role: 'user', content: incomingText }];
  }
}

type SendMessageResult = {
  messages?: Array<{ id?: string }>;
  messageId?: string;
  id?: string;
};

/** Misma extracción "duck-typed" que usa el cliente para sus propias respuestas de envío (ver message-view.tsx). */
function extractSentMessageId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const sendResult = result as SendMessageResult;
  return sendResult.messages?.find((message) => typeof message.id === 'string')?.id
    ?? sendResult.messageId
    ?? sendResult.id
    ?? undefined;
}

// Registro para evitar duplicados: así el webhook y el fallback de "disparar
// al abrir el chat" (ver más abajo) nunca responden al mismo mensaje del
// cliente dos veces. Ambos caminos pueden competir legítimamente: el webhook
// todavía está esperando a Groq/WhatsApp (puede tardar un par de segundos)
// mientras un agente abre el chat y ve ese mismo último mensaje sin
// responder, disparando también el fallback — sin esto, eso producía dos
// respuestas de IA independientes para un mismo mensaje.
//
// Se guarda en globalThis (como src/lib/event-bus.ts) para que sobreviva las
// recargas de Turbopack HMR en desarrollo en vez de reiniciarse con cada
// edición. Un id de mensaje se reclama de forma síncrona, antes de cualquier
// `await`, así que el que llegue primero gana la carrera y el otro lo ve ya reclamado.
const DEDUPE_TTL_MS = 10 * 60 * 1000; // 10 minutos — de sobra para que cualquiera de los dos caminos termine.

function getProcessedMessageIds(): Map<string, number> {
  const store = globalThis as unknown as { __autoReplyProcessedMessageIds?: Map<string, number> };
  if (!store.__autoReplyProcessedMessageIds) {
    store.__autoReplyProcessedMessageIds = new Map();
  }
  return store.__autoReplyProcessedMessageIds;
}

function claimMessageId(messageId: string): boolean {
  const processed = getProcessedMessageIds();

  const cutoff = Date.now() - DEDUPE_TTL_MS;
  for (const [id, claimedAt] of processed) {
    if (claimedAt < cutoff) processed.delete(id);
  }

  if (processed.has(messageId)) return false;
  processed.set(messageId, Date.now());
  return true;
}

/**
 * Decide qué responder a un texto entrante de WhatsApp y lo envía. Compartido por:
 * - el manejador del webhook (src/app/api/webhooks/whatsapp/route.ts), que
 *   llama a esto en el instante en que Kapso nos notifica un mensaje nuevo del cliente.
 * - el endpoint "disparar al abrir el chat" (src/app/api/messages/trigger-ai-reply),
 *   un respaldo que la bandeja llama cuando un agente abre un chat cuyo
 *   último mensaje sigue siendo un inbound sin responder — por si el camino
 *   del webhook lo dejó pasar (un túnel caído, un request perdido, etc).
 *
 * `messageId`, cuando se proporciona, evita duplicados entre ambos caminos
 * (ver arriba) para que el mismo mensaje entrante nunca reciba dos
 * respuestas independientes.
 *
 * `conversationId`, cuando se proporciona, permite empujar la respuesta
 * directo a cualquier pestaña de la bandeja abierta vía SSE en el instante
 * en que se envía (ver event-bus.ts) — sin esto, la UI solo se entera de la
 * respuesta cuando el propio webhook de estado de Kapso vuelve a llegarnos
 * con el estado del mensaje saliente, lo cual puede tardar unos segundos más.
 *
 * Lógica de respuesta, en orden:
 * 1. Saludo ("hola", "buenos días", ...) → bienvenida fija + menú numerado.
 * 2. Un número de menú suelto ("1".."4") → la respuesta fija de esa opción.
 * 3. Cualquier otra cosa → respuesta libre del proveedor de IA.
 */
export async function sendAutoReply(
  phoneNumberId: string,
  to: string,
  incomingText: string,
  messageId?: string,
  conversationId?: string,
): Promise<void> {
  if (messageId && !claimMessageId(messageId)) return;

  const menuOptionReply = matchMenuOption(incomingText);
  let replyText: string;

  if (menuOptionReply) {
    replyText = menuOptionReply;
  } else if (isGreeting(incomingText)) {
    replyText = MENU_MESSAGE;
  } else {
    const history = conversationId
      ? await fetchRecentConversationHistory(phoneNumberId, conversationId, incomingText)
      : [{ role: 'user' as const, content: incomingText }];
    replyText = await generateAIResponse(history);
  }

  if (!replyText) return;

  const result = await whatsappClient.messages.sendText({
    phoneNumberId,
    to,
    body: replyText
  });

  // Avisa a cualquier pestaña de la bandeja abierta al instante, igual que
  // el webhook hace para los mensajes entrantes — no espera el webhook de
  // estado de Kapso para esto.
  const sentMessageId = extractSentMessageId(result);
  emitInboxUpdate({
    reason: 'message.sent',
    phoneNumberId,
    conversationId,
    message: conversationId && sentMessageId
      ? {
          id: sentMessageId,
          conversationId,
          phoneNumberId,
          direction: 'outbound',
          content: replyText,
          createdAt: new Date().toISOString(),
          status: 'sent',
          phoneNumber: to,
        }
      : undefined,
  });
}
