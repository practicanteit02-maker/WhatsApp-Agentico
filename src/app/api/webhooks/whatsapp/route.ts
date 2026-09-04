import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { emitInboxUpdate } from '@/lib/event-bus';

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

    emitInboxUpdate({
      reason: event === 'whatsapp.message.received' ? 'message.received' : 'message.status',
      phoneNumberId: payload.phone_number_id,
      conversationId: payload.conversation?.id,
      message: isInboundTextMessage ? buildLiveMessageFromPayload(payload) : undefined,
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