import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { emitInboxUpdate } from '@/lib/event-bus';
import { getZone } from '@/lib/conversation-zones';
import { threadKeyFor } from '@/lib/inbox-data';
import { whatsappClient } from '@/lib/whatsapp-client';

// --- Si los mensajes tardan en aparecer (varios segundos, en vez
// de instantáneo) ---
// Este endpoint es la pieza clave de la entrega rápida: Kapso llama aquí
// apenas llega un mensaje nuevo, y este archivo empuja el aviso al instante
// a la bandeja vía SSE (ver emitInboxUpdate más abajo, y src/lib/event-bus.ts).
// Sin esto, la app solo se entera del mensaje nuevo en el siguiente sondeo
// automático (cada 8-10 segundos) — de ahí la lentitud.
// Para que Kapso pueda llamar a este endpoint necesitas un túnel activo
// (en desarrollo local usamos cloudflared) apuntando a este servidor, y que
// la URL configurada en Kapso coincida con la del túnel actual — el túnel
// gratuito de cloudflared genera una URL nueva cada vez que se reinicia, así
// que si el proceso se cae (se cierra la terminal, se reinicia la PC, etc.)
// la URL vieja registrada en Kapso deja de servir y los webhooks dejan de
// llegar, sin ningún error visible en la app — solo se pone lenta.
// Para levantarlo de nuevo: `npx cloudflared tunnel --url http://localhost:4000`,
// y luego actualizar la URL en Kapso con
// `.agents/skills/integrate-whatsapp/scripts/update.js` (ver ese script y
// list.js para los flags exactos).

type InboundWebhookPayload = {
  message?: {
    id?: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
    kapso?: {
      direction?: string;
      status?: string;
      content?: string;
    };
  };
  conversation?: {
    id?: string;
    phone_number?: string;
  };
  phone_number_id?: string;
};

// Funcionalidad "Reaccionar a un mensaje": el webhook de Kapso para un
// evento de reacción (poner o quitar una) trae, en la práctica, el mismo
// `type: 'text'` y `direction: 'inbound'` que un mensaje de texto genuino —
// la única pista real es que el "contenido" es en realidad esta frase
// generada por Kapso, no algo que el cliente haya escrito. Ninguna de las
// dos (poner o quitar) debe mostrarse como burbuja de chat ni disparar una
// respuesta de la IA — se probó dejar ver la de "poner" y el usuario no la
// quiso, así que ambas quedan ocultas.
const REACTION_EVENT_CONTENT_PATTERN = /^(Reacted with .+ to message |Reaction removed from message )/;

function isReactionEventPayload(payload: InboundWebhookPayload): boolean {
  if (payload.message?.type === 'reaction') return true;

  const content = payload.message?.text?.body ?? payload.message?.kapso?.content;
  return typeof content === 'string' && REACTION_EVENT_CONTENT_PATTERN.test(content);
}

/**
 * Para un mensaje de texto entrante, arma el objeto Message completo que
 * espera la bandeja (ver src/lib/inbox-data.ts) para poder empujarlo directo
 * a la caché de consultas del navegador vía SSE — evitando el round-trip
 * extra a la API de Kapso que un simple "ve a refrescar" costaría.
 */
function buildLiveMessageFromPayload(payload: InboundWebhookPayload) {
  const conversationId = payload.conversation?.id;
  const phoneNumberId = payload.phone_number_id;
  const phoneNumber = payload.conversation?.phone_number;
  const messageId = payload.message?.id;
  const content = payload.message?.text?.body ?? payload.message?.kapso?.content;

  if (!conversationId || !phoneNumberId || !phoneNumber || !messageId || !content) {
    return undefined;
  }

  if (isReactionEventPayload(payload)) {
    return undefined;
  }

  const timestampSeconds = Number(payload.message?.timestamp);
  const createdAt = Number.isFinite(timestampSeconds)
    ? new Date(timestampSeconds * 1000).toISOString()
    : new Date().toISOString();

  return {
    id: messageId,
    conversationId,
    phoneNumberId,
    direction: 'inbound' as const,
    content,
    createdAt,
    status: payload.message?.kapso?.status,
    phoneNumber,
  };
}

// Caché en memoria de zona-por-conversación: un mismo chat activo genera
// varios webhooks seguidos en poco tiempo (el mensaje entrante, y después
// "enviado" → "entregado" → "leído" por cada respuesta nuestra) — sin esto,
// resolveEventZona() le pegaba a la API de Kapso una vez por cada uno de
// esos eventos, aunque la zona de ese chat no cambió entre medio. Con el
// caché, solo el primer evento de una conversación paga ese viaje de red;
// el resto se resuelve al instante. Vencimiento corto (no hace falta que
// sea largo: si alguien reasigna la zona de un chat a mitad de una
// conversación activa, el peor caso es que el próximo par de eventos
// viajen todavía con la zona vieja, hasta que venza el caché — el sondeo
// de respaldo igual reconcilia todo después). Mismo patrón que
// getProcessedMessageIds en src/lib/auto-reply.ts: vive en globalThis para
// sobrevivir la recarga de módulos de Turbopack en desarrollo.
const CONVERSATION_ZONA_CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutos

type CachedConversationZona = {
  threadKey: string;
  zona: string | undefined;
  cachedAt: number;
};

function getConversationZonaCache(): Map<string, CachedConversationZona> {
  const store = globalThis as unknown as { __webhookConversationZonaCache?: Map<string, CachedConversationZona> };
  if (!store.__webhookConversationZonaCache) {
    store.__webhookConversationZonaCache = new Map();
  }
  return store.__webhookConversationZonaCache;
}

/**
 * Zona real del chat de este evento de webhook (ver src/lib/conversation-zones.ts),
 * para que /api/events pueda decidir a qué conexiones SSE reenviarlo — ver
 * el comentario de InboxUpdatePayload.zona en src/lib/event-bus.ts. El
 * payload del webhook no siempre trae el teléfono/BSUID real del contacto
 * (solo viene en buildLiveMessageFromPayload, y solo para mensajes de texto
 * entrantes), así que acá se pide con conversations.get() — la misma
 * consulta global por id que ya usa /api/messages/[conversationId] — para
 * poder calcular el mismo threadKey que el resto de la app. Se resuelve una
 * sola vez por evento (acá, en el productor, y con el caché de arriba), no
 * una vez por cada conexión SSE abierta que lo reciba.
 */
async function resolveEventZona(payload: InboundWebhookPayload): Promise<string | undefined> {
  const conversationId = payload.conversation?.id;
  const phoneNumberId = payload.phone_number_id;
  if (!conversationId || !phoneNumberId) {
    return undefined;
  }

  const cache = getConversationZonaCache();

  // Barrido de entradas vencidas — mismo patrón que claimMessageId en
  // src/lib/auto-reply.ts, para que el Map no crezca sin límite.
  const cutoff = Date.now() - CONVERSATION_ZONA_CACHE_TTL_MS;
  for (const [id, entry] of cache) {
    if (entry.cachedAt < cutoff) cache.delete(id);
  }

  const cached = cache.get(conversationId);
  if (cached) {
    return cached.zona;
  }

  try {
    const conversationRecord = await whatsappClient.conversations.get({ conversationId });
    const threadKey = threadKeyFor(
      phoneNumberId,
      typeof conversationRecord.phoneNumber === 'string' ? conversationRecord.phoneNumber : '',
      conversationId,
      typeof conversationRecord.businessScopedUserId === 'string' ? conversationRecord.businessScopedUserId : undefined
    );
    const zona = await getZone(threadKey);
    // Solo se cachea el resultado de una consulta exitosa (aunque no
    // tenga zona asignada todavía) — un fallo de Kapso/Dynamo no queda
    // "atascado" en el caché, se reintenta en el próximo evento.
    cache.set(conversationId, { threadKey, zona, cachedAt: Date.now() });
    return zona;
  } catch (error) {
    console.error('No se pudo resolver la zona del chat para el evento SSE:', error);
    return undefined;
  }
}

// Funcionalidad "Responder solo al abrir el chat": este webhook ya NO
// responde automáticamente apenas llega un mensaje nuevo (eso vivía en una
// función `autoReplyToInboundMessage` aquí mismo, ahora quitada) — a pedido
// del usuario, la IA solo debe contestar cuando un agente entra al chat. Ese
// disparador sigue vivo en src/components/message-view.tsx (el useEffect
// que llama a /api/messages/trigger-ai-reply apenas se abre un chat cuyo
// último mensaje sigue sin responder), que a su vez usa la misma
// sendAutoReply de src/lib/auto-reply.ts que se usaba aquí. Este webhook
// sigue avisando por SSE (ver emitInboxUpdate más abajo) para que la burbuja
// del mensaje entrante aparezca al instante — eso es aparte de la respuesta
// automática y no se tocó.

function verifySignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const received = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (received.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(received, expectedBuffer);
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    const signature = request.headers.get('x-webhook-signature');
    const event = request.headers.get('x-webhook-event');
    const idempotencyKey = request.headers.get('x-idempotency-key');

    const secret = process.env.WEBHOOK_SECRET;

    if (!secret) {
      console.error('WEBHOOK_SECRET is not configured');
      return NextResponse.json(
        { error: 'Webhook secret is not configured' },
        { status: 500 }
      );
    }

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing webhook signature' },
        { status: 401 }
      );
    }

    if (!verifySignature(rawBody, signature, secret)) {
      console.error('Invalid Kapso webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const payload = JSON.parse(rawBody) as InboundWebhookPayload;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('KAPSO WEBHOOK RECEIVED');
    console.log('Event:', event);
    console.log('Idempotency key:', idempotencyKey);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Avisa al instante (vía SSE) a cualquier pestaña de la bandeja abierta
    // que algo cambió, en vez de hacerlas esperar a su siguiente sondeo. Para
    // mensajes de texto entrantes también podemos entregar el mensaje ya
    // armado, para que la UI muestre la burbuja de inmediato, antes de que
    // llegue siquiera su propio refetch (disparado justo después, para reconciliar).
    const isInboundTextMessage = event === 'whatsapp.message.received'
      && payload.message?.kapso?.direction === 'inbound'
      && payload.message?.type === 'text';

    const zona = await resolveEventZona(payload);

    emitInboxUpdate({
      reason: event === 'whatsapp.message.received' ? 'message.received' : 'message.status',
      phoneNumberId: payload.phone_number_id,
      conversationId: payload.conversation?.id,
      message: isInboundTextMessage ? buildLiveMessageFromPayload(payload) : undefined,
      zona,
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);

    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}