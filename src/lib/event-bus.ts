import { EventEmitter } from 'events';

/**
 * Bus de eventos a nivel de proceso usado para empujar notificaciones de
 * "algo cambió" desde el manejador del webhook de WhatsApp hacia cualquier
 * conexión SSE abierta (ver src/app/api/events/route.ts), para que la
 * bandeja se refresque al instante en que llega un mensaje en vez de esperar
 * al siguiente sondeo.
 *
 * Se guarda en `globalThis` para que la recarga de módulos del modo
 * desarrollo de Next.js (fast refresh / recompilación de rutas de Turbopack)
 * no cree una segunda instancia del emisor, desconectada.
 */
const globalForEventBus = globalThis as unknown as {
  whatsappEventBus?: EventEmitter;
};

export const inboxEventBus: EventEmitter =
  globalForEventBus.whatsappEventBus ?? new EventEmitter();

inboxEventBus.setMaxListeners(50);

if (!globalForEventBus.whatsappEventBus) {
  globalForEventBus.whatsappEventBus = inboxEventBus;
}

export const INBOX_UPDATE_EVENT = 'inbox-update';

export type InboxLiveMessage = {
  id: string;
  conversationId: string;
  phoneNumberId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
  status?: string;
  phoneNumber: string;
};

export type InboxUpdatePayload = {
  reason: 'message.received' | 'message.status' | 'message.sent';
  conversationId?: string;
  phoneNumberId?: string;
  /**
   * Presente solo para eventos `message.received` de texto plano: el mensaje
   * ya armado completo, suficiente para renderizarlo de inmediato. Mandar
   * esto junto con el "aviso" de SSE le permite al cliente mostrar la
   * burbuja en el instante en que llega, en vez de esperar el round-trip
   * extra a la API de Kapso que necesitaría un refetch simple. Igual sigue
   * un refetch en segundo plano después, para reconciliar.
   */
  message?: InboxLiveMessage;
};

export function emitInboxUpdate(payload: InboxUpdatePayload) {
  inboxEventBus.emit(INBOX_UPDATE_EVENT, payload);
}

// Funcionalidad "Quién está escribiendo": mismo bus/conexión SSE de
// arriba, pero para avisar en vivo de "alguien está escribiendo en este
// chat ahora mismo" y "quién mandó este mensaje" (ver
// src/lib/chat-collab.ts) — evento aparte de INBOX_UPDATE_EVENT para no
// mezclar semánticas distintas sobre un mismo nombre de evento.
// NOTA: esto ya NO restringe quién puede escribir (eso existió como
// "candado de chat" con pedir/aceptar/rechazar acceso, y se sacó a pedido
// del usuario) — es puramente informativo, cualquier perfil puede mandar
// mensajes en cualquier momento.
export const CHAT_COLLAB_EVENT = 'chat-collab-update';

export type ChatPresenceState = {
  typingBy: string | null;
  typingUntil: number | null;
};

export type ChatCollabPayload = {
  threadKey: string;
  presence?: ChatPresenceState;
  attribution?: { messageId: string; profile: string };
};

export function emitChatCollabUpdate(payload: ChatCollabPayload) {
  inboxEventBus.emit(CHAT_COLLAB_EVENT, payload);
}
