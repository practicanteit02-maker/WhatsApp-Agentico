/**
 * Funcionalidad "Mensajes destacados": guarda en localStorage la lista de
 * mensajes que el usuario marcó con estrella, sin importar en qué
 * conversación estén, para poder listarlos todos juntos desde el menú "⋮"
 * de la lista de chats (ver el botón "Estrella" en cada burbuja de
 * src/components/message-view.tsx y el panel en
 * src/components/conversation-list.tsx).
 */

const STARRED_MESSAGES_STORAGE_KEY = 'whatsapp-cloud-inbox-starred-messages';

export type StarredMessage = {
  /** Id del mensaje (igual al `message.id` que usa MessageView). */
  id: string;
  /** Clave del chat (ConversationThread.key) al que pertenece, para poder abrirlo desde el panel. */
  threadKey: string;
  contactName?: string;
  phoneNumber?: string;
  content: string;
  direction: 'inbound' | 'outbound';
  createdAt: string;
};

function isStarredMessage(value: unknown): value is StarredMessage {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as StarredMessage).id === 'string' &&
    typeof (value as StarredMessage).threadKey === 'string'
  );
}

export function loadStarredMessages(): StarredMessage[] {
  try {
    const raw = window.localStorage.getItem(STARRED_MESSAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStarredMessage);
  } catch {
    return [];
  }
}

export function saveStarredMessages(list: StarredMessage[]) {
  try {
    window.localStorage.setItem(STARRED_MESSAGES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Los destacados siguen funcionando para esta sesión aunque el storage no esté disponible.
  }
}

export function isMessageStarred(messageId: string, starred: StarredMessage[]): boolean {
  return starred.some((item) => item.id === messageId);
}

/** Activa/desactiva la estrella de un mensaje y persiste el resultado. */
export function toggleStarredMessage(message: StarredMessage, current: StarredMessage[]): StarredMessage[] {
  const next = isMessageStarred(message.id, current)
    ? current.filter((item) => item.id !== message.id)
    : [message, ...current];
  saveStarredMessages(next);
  return next;
}
