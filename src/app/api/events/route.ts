import {
  CHAT_COLLAB_EVENT,
  INBOX_UPDATE_EVENT,
  inboxEventBus,
  type ChatCollabPayload,
  type InboxUpdatePayload,
} from '@/lib/event-bus';

// Debe correr en el servidor Node.js de larga duración (no en el runtime
// Edge) y nunca optimizarse estáticamente, ya que esta es una conexión de
// streaming persistente.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Stream de Server-Sent Events: empuja un mensaje pequeño en el instante en
 * que el webhook de WhatsApp registra algo nuevo, para que la bandeja pueda
 * refrescarse de inmediato en vez de esperar a su intervalo de sondeo. El
 * sondeo se mantiene como respaldo por si una conexión se cae.
 */
export async function GET(request: Request) {
  const encoder = new TextEncoder();

  let onUpdate: (payload: InboxUpdatePayload) => void;
  let onCollabUpdate: (payload: ChatCollabPayload) => void;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller ya cerrado (cliente desconectado); se ignora.
        }
      };

      send('ready', { ok: true });

      onUpdate = (payload) => send('update', payload);
      inboxEventBus.on(INBOX_UPDATE_EVENT, onUpdate);

      // Funcionalidad "Candado de chat": mismo stream, un tipo de evento
      // aparte — ver src/lib/chat-collab.ts y el hook useInboxLiveUpdates.
      onCollabUpdate = (payload) => send('collab', payload);
      inboxEventBus.on(CHAT_COLLAB_EVENT, onCollabUpdate);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          // se ignora
        }
      }, HEARTBEAT_INTERVAL_MS);

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        inboxEventBus.off(INBOX_UPDATE_EVENT, onUpdate);
        inboxEventBus.off(CHAT_COLLAB_EVENT, onCollabUpdate);
        try {
          controller.close();
        } catch {
          // ya estaba cerrado
        }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      inboxEventBus.off(INBOX_UPDATE_EVENT, onUpdate);
      inboxEventBus.off(CHAT_COLLAB_EVENT, onCollabUpdate);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
