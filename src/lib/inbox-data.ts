import type { MediaData } from '@kapso/whatsapp-cloud-api';

export type ConversationStatusFilter = 'all' | 'active' | 'ended';

export type Conversation = {
  id: string;
  phoneNumber: string;
  status: string;
  lastActiveAt?: string;
  phoneNumberId: string;
  inboxPhoneNumber?: string;
  inboxDisplayName?: string;
  businessAccountId?: string;
  metadata?: Record<string, unknown>;
  contactName?: string;
  messagesCount?: number;
  /** Funcionalidad "Contactos con username (BSUID)": el ID de Meta para un
   * contacto que le oculta su número de teléfono al negocio (usa solo un
   * username de WhatsApp) — `phoneNumber` viene vacío para estos casos.
   * Confirmado con soporte de Kapso: para mandarle algo a este tipo de
   * contacto, el mensaje debe llevar `recipient` (este valor) en vez de `to`
   * — ver businessScopedUserIdFor más abajo y su uso en message-view.tsx /
   * template-composer.tsx / las rutas de envío. */
  businessScopedUserId?: string;
  lastMessage?: {
    content: string;
    direction: string;
    type?: string;
  };
};

export type Message = {
  id: string;
  conversationId: string;
  phoneNumberId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
  status?: string;
  phoneNumber: string;
  hasMedia: boolean;
  mediaData?: {
    url: string;
    contentType?: string;
    filename?: string;
  } | (MediaData & { url: string });
  reactionEmoji?: string | null;
  reactedToMessageId?: string | null;
  contextMessageId?: string | null;
  repliedTo?: {
    id: string;
    conversationId: string;
    content: string;
    direction: 'inbound' | 'outbound';
    messageType?: string;
    senderName?: string;
  } | null;
  filename?: string | null;
  mimeType?: string | null;
  messageType?: string;
  caption?: string | null;
  metadata?: {
    mediaId?: string;
    caption?: string;
  };
};

export type ConversationThread = {
  key: string;
  phoneNumber: string;
  phoneNumberId: string;
  inboxPhoneNumber?: string;
  inboxDisplayName?: string;
  businessAccountId?: string;
  /** Ver el comentario junto a Conversation['businessScopedUserId']. */
  businessScopedUserId?: string;
  contactName?: string;
  conversations: Conversation[];
  latestConversation: Conversation;
  conversationCount: number;
  previousConversationIds: string[];
  status: string;
  lastActiveAt?: string;
  lastMessage?: Conversation['lastMessage'];
};

export const CONVERSATIONS_QUERY_KEY = ['conversations'] as const;

export function conversationMessagesQueryKey(phoneNumberId: string | undefined, conversationId: string) {
  return ['conversation-messages', phoneNumberId ?? '', conversationId] as const;
}

export function phoneThreadMessagesQueryKey(
  phoneNumberId: string | undefined,
  phoneNumber: string | undefined,
  conversationIds: string[]
) {
  return ['phone-thread-messages', phoneNumberId ?? '', phoneNumber ?? '', conversationIds.join(':')] as const;
}

export function parseTimestamp(timestamp?: string): number {
  if (!timestamp) return 0;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : 0;
}

/** La misma clave de agrupación bajo la que se guarda/busca un chat,
 * calculable con solo un número de teléfono + id de número de teléfono (no
 * hace falta el objeto Conversation completo) — permite que un componente
 * que solo tiene esas dos props (por ejemplo la vista del chat abierto) se
 * refiera a "este chat" en localStorage de la misma forma que la lista de
 * conversaciones.
 *
 * Funcionalidad "Contactos con username (BSUID)": cuando hay
 * `businessScopedUserId`, tiene prioridad sobre el número de teléfono (no al
 * revés) — comprobado en la práctica: un contacto que empieza sin número
 * (solo username) puede terminar con un número real asociado a una
 * conversación puntual una vez Meta lo resuelve al mandarle algo, mientras
 * que conversaciones más viejas del mismo contacto se quedan sin número. El
 * business_scoped_user_id es el único dato que se mantiene igual en todas
 * esas conversaciones — agrupar por el número (cuando a veces está y a veces
 * no) partía a este mismo contacto en chats separados. `fallbackId` (el id
 * de una conversación puntual) queda como último recurso, solo para
 * contactos sin número NI business_scoped_user_id.
 */
export function threadKeyFor(
  phoneNumberId: string,
  phoneNumber: string,
  fallbackId?: string,
  businessScopedUserId?: string,
): string {
  const trimmedPhoneNumber = phoneNumber.trim();
  const comparablePhoneNumber = trimmedPhoneNumber.replace(/\D/g, '');
  const contactKey = (businessScopedUserId?.trim() ? `bsuid:${businessScopedUserId.trim()}` : undefined)
    || comparablePhoneNumber
    || trimmedPhoneNumber
    || `conversation:${fallbackId ?? ''}`;
  return `${phoneNumberId}:${contactKey}`;
}

function conversationGroupKey(conversation: Conversation): string {
  return threadKeyFor(conversation.phoneNumberId, conversation.phoneNumber, conversation.id, conversation.businessScopedUserId);
}

/** Conjunto de strings genérico respaldado por localStorage, usado para las
 * marcas de chat que solo existen del lado del cliente (archivado, marcado
 * como no leído, ...) que esta bandeja rastrea — la API de Kapso no tiene
 * ningún concepto de servidor para esto, así que vive enteramente en el navegador. */
export function loadStoredStringSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveStoredStringSet(key: string, values: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(values)));
  } catch {
    // Sigue funcionando para esta sesión aunque el storage no esté disponible.
  }
}

function byMostRecentConversation(a: Conversation, b: Conversation): number {
  const delta = parseTimestamp(b.lastActiveAt) - parseTimestamp(a.lastActiveAt);
  if (delta !== 0) return delta;
  return b.id.localeCompare(a.id);
}

export async function fetchConversations(): Promise<Conversation[]> {
  const response = await fetch('/api/conversations?limit=100');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch conversations');
  }

  return data.data || [];
}

export async function fetchConversationMessages(conversationId: string, phoneNumberId?: string): Promise<Message[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (phoneNumberId) {
    params.set('phoneNumberId', phoneNumberId);
  }

  const response = await fetch(`/api/messages/${conversationId}?${params.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch messages');
  }

  const messages = (data.data || []).map((message: Omit<Message, 'conversationId'>) => ({
    ...message,
    phoneNumberId: message.phoneNumberId ?? phoneNumberId ?? '',
    conversationId,
  }));

  return normalizeMessages(messages);
}

export function groupConversationsByPhoneNumber(conversations: Conversation[]): ConversationThread[] {
  const groupedConversations = new Map<string, Conversation[]>();

  conversations.forEach((conversation) => {
    const key = conversationGroupKey(conversation);
    const existing = groupedConversations.get(key) || [];
    existing.push(conversation);
    groupedConversations.set(key, existing);
  });

  return Array.from(groupedConversations.entries())
    .map(([key, threadConversations]) => {
      const sortedConversations = [...threadConversations].sort(byMostRecentConversation);
      const latestConversation = sortedConversations[0];

      return {
        key,
        phoneNumber: latestConversation.phoneNumber,
        phoneNumberId: latestConversation.phoneNumberId,
        inboxPhoneNumber: latestConversation.inboxPhoneNumber,
        inboxDisplayName: latestConversation.inboxDisplayName,
        businessAccountId: latestConversation.businessAccountId,
        businessScopedUserId: latestConversation.businessScopedUserId
          || sortedConversations.find(conversation => conversation.businessScopedUserId)?.businessScopedUserId,
        contactName: latestConversation.contactName || sortedConversations.find(conversation => conversation.contactName)?.contactName,
        conversations: sortedConversations,
        latestConversation,
        conversationCount: sortedConversations.length,
        previousConversationIds: sortedConversations.slice(1).map(conversation => conversation.id),
        status: latestConversation.status,
        lastActiveAt: latestConversation.lastActiveAt,
        lastMessage: latestConversation.lastMessage,
      };
    })
    .sort((a, b) => byMostRecentConversation(a.latestConversation, b.latestConversation));
}

export function filterConversationThreads(
  threads: ConversationThread[],
  statusFilter: ConversationStatusFilter,
  searchQuery: string,
): ConversationThread[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return threads.filter((thread) => {
    if (statusFilter !== 'all' && thread.latestConversation.status !== statusFilter) {
      return false;
    }

    if (!normalizedQuery) return true;

    return (
      thread.phoneNumber.toLowerCase().includes(normalizedQuery) ||
      thread.inboxPhoneNumber?.toLowerCase().includes(normalizedQuery) ||
      thread.inboxDisplayName?.toLowerCase().includes(normalizedQuery) ||
      thread.contactName?.toLowerCase().includes(normalizedQuery) ||
      thread.conversations.some(conversation => conversation.id.toLowerCase().includes(normalizedQuery))
    );
  });
}

export function countThreadsByStatus(threads: ConversationThread[]) {
  return threads.reduce(
    (counts, thread) => {
      counts.all += 1;
      if (thread.latestConversation.status === 'active') counts.active += 1;
      if (thread.latestConversation.status === 'ended') counts.ended += 1;
      return counts;
    },
    { all: 0, active: 0, ended: 0 },
  );
}

export function shortConversationId(conversationId?: string): string {
  if (!conversationId) return '';
  return conversationId.replace(/-/g, '').slice(0, 8);
}

function getReplyPreviewContent(message: Message): string {
  const content = message.caption || message.content || message.filename || '';
  const trimmedContent = content.trim();

  if (trimmedContent) {
    return trimmedContent.length > 120 ? `${trimmedContent.slice(0, 117)}...` : trimmedContent;
  }

  if (message.hasMedia && message.messageType) {
    return `${message.messageType.charAt(0).toUpperCase()}${message.messageType.slice(1)} message`;
  }

  return 'Message';
}

// Funcionalidad "Reaccionar a un mensaje": frase que Kapso genera para el
// propio evento de reacción ("Reacted with 👍 to message ..." / "Reaction
// removed from message ..."). Ninguna de las dos se muestra como burbuja en
// el chat (se probó dejar ver la de "poner" y el usuario no la quiso) —
// ambas solo se usan para calcular la insignia de emoji que aparece pegada
// en la esquina del mensaje al que reaccionan. El webhook en tiempo real
// (ver src/app/api/webhooks/whatsapp/route.ts) ya filtra esto antes de
// empujar el aviso por SSE; esto es el respaldo, la única fuente de verdad
// real para lo que se termina pintando.
const REACTION_EVENT_CONTENT_PATTERN = /^(Reacted with .+ to message |Reaction removed from message )/;

function looksLikeReactionEvent(message: Message): boolean {
  return message.messageType === 'reaction' ||
    (typeof message.content === 'string' && REACTION_EVENT_CONTENT_PATTERN.test(message.content));
}

export function normalizeMessages(messages: Message[]): Message[] {
  const reactions = messages.filter(looksLikeReactionEvent);
  const regularMessages = messages.filter(message => !looksLikeReactionEvent(message));
  const reactionMap = new Map<string, string>();
  const messageMap = new Map(regularMessages.map(message => [message.id, message]));

  // Funcionalidad "Reaccionar a un mensaje": quitar una reacción se hace
  // mandando una reacción nueva con emoji vacío (ver handleSendReaction en
  // message-view.tsx), así que hay que procesar las reacciones en orden
  // cronológico y dejar que la última gane *aunque venga vacía* — si solo
  // nos quedáramos con la última que tuviera emoji, un "quitar reacción" se
  // ignoraría y la insignia vieja se quedaría pegada para siempre.
  [...reactions]
    .sort((a, b) => parseTimestamp(a.createdAt) - parseTimestamp(b.createdAt))
    .forEach((reaction) => {
      if (reaction.reactedToMessageId) {
        reactionMap.set(reaction.reactedToMessageId, reaction.reactionEmoji ?? '');
      }
    });

  return regularMessages
    .map((message) => {
      const reaction = reactionMap.get(message.id);
      const contextMessageId = message.contextMessageId?.trim();
      const repliedMessage = contextMessageId ? messageMap.get(contextMessageId) : undefined;
      const repliedTo = message.repliedTo ?? (
        repliedMessage
          ? {
              id: repliedMessage.id,
              conversationId: repliedMessage.conversationId,
              content: getReplyPreviewContent(repliedMessage),
              direction: repliedMessage.direction,
              messageType: repliedMessage.messageType,
              senderName: repliedMessage.direction === 'outbound' ? 'You' : 'Contact',
            }
          : contextMessageId
            ? {
                id: contextMessageId,
                conversationId: message.conversationId,
                content: 'Original message',
                direction: 'inbound' as const,
                senderName: 'Contact',
              }
            : undefined
      );

      return {
        ...message,
        ...(reaction ? { reactionEmoji: reaction } : {}),
        ...(repliedTo ? { repliedTo } : {}),
      };
    })
    .sort((a, b) => parseTimestamp(a.createdAt) - parseTimestamp(b.createdAt));
}
