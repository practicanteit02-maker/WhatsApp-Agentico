"use client";

import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  format,
  formatDistanceToNow,
  isValid,
  isToday,
  isYesterday,
  differenceInHours,
} from "date-fns";
import {
  RefreshCw,
  Paperclip,
  Smile,
  Send,
  X,
  XCircle,
  ArrowLeft,
  Check,
  Clock,
  Eye,
  EyeOff,
  Reply,
  Star,
  User,
  LayoutTemplate,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxLiveUpdates } from "@/hooks/use-inbox-live-updates";
import { convertImageToSupportedFormatIfNeeded } from "@/lib/convert-image";
import { playSentMessageSound } from "@/lib/notification-sounds";
import type { ChatCollabPayload, ChatPresenceState } from "@/lib/event-bus";
import { getProfileStyle } from "@/lib/mock-profiles";
import {
  CONVERSATIONS_QUERY_KEY,
  type Conversation,
  type Message,
  conversationMessagesQueryKey,
  fetchConversationMessages,
  normalizeMessages,
  parseTimestamp,
  phoneThreadMessagesQueryKey,
  threadKeyFor,
} from "@/lib/inbox-data";
import { isMessageStarred, type StarredMessage } from "@/lib/starred-messages";
import { MediaMessage } from "@/components/media-message";
import { TemplateComposer } from "@/components/template-composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

// Exclusión puntual (a pedido explícito del usuario, sin traer de vuelta la
// función general de "Eliminar mensaje" que se quitó antes): dos intentos
// fallidos de la plantilla "bienvenida" a Diego F. que quedaron como "Not
// delivered" mientras se resolvía la configuración de facturación de Meta —
// ya sin ningún valor para mostrar, pero imposibles de borrar de verdad del
// historial de Kapso/WhatsApp. Si en el futuro hace falta ocultar otro
// mensaje puntual así, lo más simple es agregar su id acá también.
const HARDCODED_HIDDEN_MESSAGE_IDS = new Set([
  "wamid.HBgTQ08uMTc0ODMzMzEwNjI2OTk1MRUUABEYFENFNEM5RDFCNEYxMkNBMjQ2NDJFAA==",
  "wamid.HBgTQ08uMTc0ODMzMzEwNjI2OTk1MRUUABEYFENFRUIyN0Q5MjQ5Q0Q0QjZFQ0VFAA==",
]);

function formatMessageTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isValid(date)) {
      return format(date, "HH:mm");
    }
    return "";
  } catch {
    return "";
  }
}

function formatDateDivider(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (!isValid(date)) return "";

    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMMM d, yyyy");
  } catch {
    return "";
  }
}

function formatLastSeen(timestamp?: string): string | null {
  if (!timestamp) return null;

  try {
    const date = new Date(timestamp);
    if (!isValid(date)) return null;

    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return null;
  }
}

function formatDisplayPhoneNumber(phoneNumber?: string): string | null {
  if (!phoneNumber) return null;

  const trimmedPhoneNumber = phoneNumber.trim();
  if (!trimmedPhoneNumber) return null;
  if (trimmedPhoneNumber.startsWith("+")) return trimmedPhoneNumber;
  if (/^\d+$/.test(trimmedPhoneNumber)) return `+${trimmedPhoneNumber}`;

  return trimmedPhoneNumber;
}

/** `onMedia`: cuando los checks van sobre la pastillita semitransparente de
 * una burbuja "transparente" de foto/video (ver isMediaOnlyBubble), en vez
 * de sobre el fondo normal de la burbuja — el gris apagado de siempre no se
 * ve bien ahí encima (poco contraste según la foto de fondo), así que ahí
 * "sent"/"delivered"/"pending" se fuerzan a blanco. "read" se deja con su
 * azul de siempre, que sí se distingue bien sobre esa pastillita oscura. */
function MessageStatusChecks({ status, onMedia = false }: { status: string; onMedia?: boolean }) {
  if (status === "pending") {
    return (
      <Clock aria-label="Sending" className={cn("size-3.5", onMedia ? "text-white/80" : "text-muted-foreground")} />
    );
  }

  if (status === "read" || status === "delivered") {
    return (
      <span
        aria-label={status === "read" ? "Read" : "Delivered"}
        className={cn(
          "relative inline-flex h-3.5 w-[1.125rem] items-center",
          status === "read" ? "text-[var(--chat-check-read)]" : onMedia ? "text-white" : "text-[var(--chat-check)]",
        )}
      >
        <Check aria-hidden="true" className="absolute left-0 top-0 size-3.5" />
        <Check aria-hidden="true" className="absolute right-0 top-0 size-3.5" />
      </span>
    );
  }

  if (status === "sent") {
    return (
      <Check aria-label="Sent" className={cn("size-3.5", onMedia ? "text-white" : "text-[var(--chat-check)]")} />
    );
  }

  return null;
}

function shouldShowDateDivider(
  currentMsg: Message,
  prevMsg: Message | null,
): boolean {
  if (!prevMsg) return true;

  try {
    const currentDate = new Date(currentMsg.createdAt);
    const prevDate = new Date(prevMsg.createdAt);

    if (!isValid(currentDate) || !isValid(prevDate)) return false;

    return format(currentDate, "yyyy-MM-dd") !== format(prevDate, "yyyy-MM-dd");
  } catch {
    return false;
  }
}

function isWithin24HourWindow(messages: Message[]): boolean {
  // Busca el último mensaje entrante
  const inboundMessages = messages.filter((msg) => msg.direction === "inbound");

  if (inboundMessages.length === 0) {
    // Todavía no hay mensajes entrantes - solo se permiten plantillas
    return false;
  }

  const lastInboundMessage = inboundMessages[inboundMessages.length - 1];

  try {
    const lastMessageDate = new Date(lastInboundMessage.createdAt);
    if (!isValid(lastMessageDate)) return false;

    const hoursSinceLastMessage = differenceInHours(
      new Date(),
      lastMessageDate,
    );
    return hoursSinceLastMessage < 24;
  } catch {
    return false; // En caso de error, solo se permiten plantillas
  }
}

type CollabAction = "typing" | "attribute";

/** Funcionalidad "Quién está escribiendo": dispara una acción contra
 * /api/conversations/collab (ver ese archivo y src/lib/chat-collab.ts) —
 * "fire and forget": el estado real que manda es el que llega de vuelta
 * por SSE (ver useInboxLiveUpdates más abajo), así que si este request
 * puntual falla por una red inestable no vale la pena romper el envío del
 * mensaje ni mostrar un error por esto. */
async function postCollabAction(
  threadKey: string,
  action: CollabAction,
  extra?: { profile?: string; messageId?: string },
) {
  try {
    await fetch("/api/conversations/collab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadKey, action, ...extra }),
    });
  } catch {
    // ver comentario de arriba
  }
}

function getDisabledInputMessage(messages: Message[]): string {
  const inboundMessages = messages.filter((msg) => msg.direction === "inbound");

  if (inboundMessages.length === 0) {
    return "Este contacto todavía no te ha escrito — el primer mensaje tiene que ser una plantilla aprobada.";
  }

  return "El último mensaje fue hace más de 24 horas — mandale una plantilla o esperá a que te vuelva a escribir.";
}

const MESSAGE_SKELETON_WIDTHS = [280, 180, 320, 210, 260, 170];
// El check doble ("delivered") de un mensaje saliente depende de que a este
// chat le llegue, o el aviso del webhook por SSE (ver useInboxLiveUpdates más
// abajo), o el sondeo normal de este hook — y el sondeo normal, a propósito,
// es lento (8s, ver el comentario junto a refetchInterval) para no competir
// con los envíos por el presupuesto limitado de conexiones del navegador. Si
// el webhook no llega (p. ej. el túnel de cloudflared caído — ver el
// comentario grande en src/app/api/webhooks/whatsapp/route.ts), el único
// camino que queda es ese sondeo lento, y el check doble tarda hasta 8s en
// aparecer en vez de casi al instante. Mientras haya un mensaje saliente
// reciente todavía en "sent" (un solo check, sin confirmar entrega/lectura
// aún), se sondea mucho más seguido — así el check doble no depende de que
// el webhook esté funcionando.
const OUTBOUND_STATUS_FAST_POLL_INTERVAL_MS = 2_000;
const OUTBOUND_STATUS_FAST_POLL_WINDOW_MS = 30_000;
const OUTBOUND_STATUS_NORMAL_POLL_INTERVAL_MS = 8_000;
// Funcionalidad "Reaccionar a un mensaje": emojis rápidos que ofrece el
// selector que abre el botón de carita junto a Responder/Estrella en cada
// burbuja (ver el botón "React" y handleSendReaction más abajo).
const QUICK_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const LOCAL_REPLY_CONTEXT_STORAGE_KEY = "whatsapp-cloud-inbox-reply-contexts";
const LOCAL_REPLY_CONTEXT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LOCAL_REPLY_CONTEXTS = 200;

const EMOJI_CATEGORIES: Array<{ label: string; emojis: string[] }> = [
  {
    label: "Emoticones",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙",
      "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤔", "🤨",
      "😐", "😑", "😶", "🙄", "😏", "😣", "😥", "😮", "🤐", "😯",
      "😪", "😫", "🥱", "😴", "😌", "😔", "😕", "🙁", "☹️", "😖",
      "😞", "😟", "😢", "😭", "😤", "😠", "😡", "🤬", "😳", "🥵",
      "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🫡", "🤫", "🤥",
    ],
  },
  {
    label: "Gestures",
    emojis: [
      "👍", "👎", "👌", "🤌", "✌️", "🤞", "🤟", "🤘", "👊", "✊",
      "👏", "🙌", "👐", "🤲", "🙏", "💪", "🤝", "👋", "🖐️", "☝️",
      "👉", "👈", "👆", "👇", "✋", "🤙", "🖖", "💅",
    ],
  },
  {
    label: "Hearts",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "😻",
    ],
  },
  {
    label: "Common",
    emojis: [
      "🔥", "✨", "🎉", "🎊", "✅", "❌", "❗", "❓", "⭐", "🌟",
      "💯", "⚡", "☀️", "🌈", "☕", "🍕", "🎂", "📦", "📱", "💰",
      "🕒", "📅", "📍", "🔔", "🔒", "👀", "💬", "🙏",
    ],
  },
];

type RepliedToMessage = NonNullable<Message["repliedTo"]>;

type LocalReplyContext = {
  contextMessageId: string;
  repliedTo: RepliedToMessage;
  createdAt: number;
};

type LocalReplyContexts = Record<string, LocalReplyContext>;

type SendMessageResult = {
  messages?: Array<{ id?: string }>;
  messageId?: string;
  id?: string;
  contextMessageId?: string;
};

function extractTranscriptDisplayContent(content: string): string | undefined {
  const match = content.match(/\bTranscript:\s*[\s\S]*$/i);
  if (!match) return undefined;

  return match[0]
    .replace(/\s+\bURL:\s*https?:\/\/\S+[\s\S]*$/i, '')
    .trim();
}

function isGeneratedAttachmentDisplayContent(content: string): boolean {
  return (
    /^https?:\/\//i.test(content) ||
    /\bURL:\s*https?:\/\//i.test(content) ||
    /^(image|video|audio|document|sticker)\s+attached\b/i.test(content)
  );
}

// Tipos de mensaje cuyo "content" puede venir con el texto autogenerado
// ("Sticker attached (archivo.webp) [Size: ... | Type: ...]") en vez de un
// texto de verdad escrito por alguien — para esos, ese texto se oculta (no
// tiene nada que decirle al usuario, la imagen/sticker ya se ve solo). Antes
// esto solo cubría 'image' y 'audio', por lo que a los stickers (y videos y
// documentos) se les colaba ese texto crudo debajo de la burbuja.
const MESSAGE_TYPES_WITH_GENERATED_CONTENT = new Set(['image', 'video', 'document', 'sticker']);

function getDisplayMessageContent(message: Message): string | null {
  if (!message.content || message.content === "[Image attached]") {
    return null;
  }

  const trimmedContent = message.content.trim();

  if (message.messageType === 'audio') {
    return extractTranscriptDisplayContent(trimmedContent) ??
      (isGeneratedAttachmentDisplayContent(trimmedContent) ? null : trimmedContent);
  }

  if (
    MESSAGE_TYPES_WITH_GENERATED_CONTENT.has(message.messageType ?? '') &&
    isGeneratedAttachmentDisplayContent(trimmedContent)
  ) {
    return null;
  }

  return trimmedContent;
}

// El formato en línea propio de WhatsApp: *negrita*, _cursiva_,
// ~tachado~, ```monoespaciado```. Nuestras burbujas mostraban estos
// marcadores literalmente en vez de renderizarlos, aunque el WhatsApp real
// del destinatario ya los renderiza — esto parsea la misma sintaxis para
// que nuestra vista previa coincida con lo que el cliente realmente ve. El
// contenido de cada delimitador debe empezar y terminar en un carácter que
// no sea espacio (regla del propio WhatsApp), lo que evita que algo como
// "5 * 3 = 15" se malinterprete como negrita.
const WHATSAPP_FORMATTING_PATTERN =
  /\*(\S(?:[^*]*\S)?)\*|_(\S(?:[^_]*\S)?)_|~(\S(?:[^~]*\S)?)~|```(\S(?:[^`]*\S)?)```/g;

function formatWhatsAppText(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(WHATSAPP_FORMATTING_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    const [, bold, italic, strike, mono] = match;
    if (bold !== undefined) {
      nodes.push(<strong key={key++}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key++}>{italic}</em>);
    } else if (strike !== undefined) {
      nodes.push(<s key={key++}>{strike}</s>);
    } else if (mono !== undefined) {
      nodes.push(<code key={key++} className="font-mono text-[0.9em]">{mono}</code>);
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function getReplyPreviewContent(message: Message): string {
  const content = getDisplayMessageContent(message) || message.caption || message.filename || '';
  const trimmedContent = content.trim();

  if (trimmedContent) {
    return trimmedContent.length > 140 ? `${trimmedContent.slice(0, 137)}...` : trimmedContent;
  }

  if (message.hasMedia && message.messageType) {
    return `${message.messageType.charAt(0).toUpperCase()}${message.messageType.slice(1)} message`;
  }

  return 'Message';
}

function getMessageSenderLabel(
  message: Pick<Message, 'direction'>,
  contactName?: string,
  phoneNumber?: string,
): string {
  if (message.direction === 'outbound') return 'you';
  return contactName || phoneNumber || 'contact';
}

function extractSentMessageId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;

  const sendResult = result as SendMessageResult;
  const sentMessageId = sendResult.messages?.find((message) => typeof message.id === "string")?.id;

  return sentMessageId ?? sendResult.messageId ?? sendResult.id ?? null;
}

function pruneLocalReplyContexts(contexts: LocalReplyContexts): LocalReplyContexts {
  const now = Date.now();
  const entries = Object.entries(contexts)
    .filter(([, context]) => (
      context &&
      typeof context.contextMessageId === "string" &&
      context.repliedTo &&
      typeof context.repliedTo.id === "string" &&
      now - context.createdAt < LOCAL_REPLY_CONTEXT_MAX_AGE_MS
    ))
    .sort(([, a], [, b]) => b.createdAt - a.createdAt)
    .slice(0, MAX_LOCAL_REPLY_CONTEXTS);

  return Object.fromEntries(entries);
}

type Props = {
  conversationId?: string;
  conversations?: Conversation[];
  phoneNumber?: string;
  /** Funcionalidad "Contactos con username (BSUID)": alternativa a
   * `phoneNumber` para un contacto que le oculta su número al negocio (solo
   * tiene username de WhatsApp — Kapso entrega `phone_number: null` para
   * esos casos). Confirmado con soporte de Kapso: sí se les puede escribir,
   * pero el envío debe usar este ID en vez del número — ver su uso en
   * handleSendMessage más abajo y en las rutas /api/messages/send y
   * /api/templates/send. */
  businessScopedUserId?: string;
  phoneNumberId?: string;
  inboxPhoneNumber?: string;
  inboxDisplayName?: string;
  contactName?: string;
  lastActiveAt?: string;
  onTemplateSent?: (phoneNumber: string, phoneNumberId?: string) => Promise<void>;
  onBack?: () => void;
  isVisible?: boolean;
  /** Funcionalidad "Mensajes destacados": lista completa (de todos los
   * chats), para saber qué mensajes de este chat mostrar con la estrella
   * llena. Vive en src/app/page.tsx porque el panel que los lista a todos
   * (en ConversationList) también la necesita. */
  starredMessages?: StarredMessage[];
  /** Activa/desactiva la estrella de un mensaje — el padre (page.tsx) es
   * quien guarda la lista en localStorage. */
  onToggleStarredMessage?: (message: StarredMessage) => void;
  /** Funcionalidad "Mensajes destacados": id del mensaje al que hay que
   * saltar apenas los mensajes de este chat terminen de cargar (se llega
   * aquí al hacer clic en un mensaje del panel de destacados). */
  jumpToMessageId?: string;
  /** Se llama una vez que ya se intentó el salto de arriba, para que el
   * padre limpie `jumpToMessageId` y no se repita si se reabre el mismo chat. */
  onJumpToMessageHandled?: () => void;
  /** Funcionalidad "Perfil": nombre del perfil activo (Administrador,
   * Secretaria, etc. — ver el menú de perfiles en conversation-list.tsx),
   * mostrado en cada burbuja saliente como el "remitente". Es un adelanto de
   * cuando varias personas puedan mandar mensajes desde el mismo número: por
   * ahora no hay sesiones reales, así que es el mismo nombre para todos los
   * mensajes que se envían desde este navegador. */
  activeSenderName?: string;
};

export function MessageView({
  conversationId,
  conversations = [],
  phoneNumber,
  businessScopedUserId,
  phoneNumberId,
  inboxPhoneNumber,
  inboxDisplayName,
  contactName,
  lastActiveAt,
  onTemplateSent,
  onBack,
  isVisible = false,
  starredMessages = [],
  onToggleStarredMessage,
  jumpToMessageId,
  onJumpToMessageHandled,
  activeSenderName,
}: Props) {

  const [refreshing, setRefreshing] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [canSendRegularMessage, setCanSendRegularMessage] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [phoneNumberRevealed, setPhoneNumberRevealed] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // Funcionalidad "Selector de plantillas en el chat": a pedido del usuario,
  // el selector dejó de estar siempre visible debajo del aviso de "no podés
  // escribir libre" — ahora se abre como un panel flotante desde el botón
  // de plantilla en el header (ver templatePickerRef más abajo), igual que
  // ya hace el selector de emojis.
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const templatePickerRef = useRef<HTMLDivElement>(null);
  // --- Funcionalidad "Reaccionar a un mensaje": id del mensaje cuyo
  // selector de emoji está abierto, y en qué posición de pantalla dibujarlo
  // (se calcula al hacer clic en el botón de carita — ver más abajo, y
  // handleSendReaction).
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [reactionPickerPosition, setReactionPickerPosition] = useState<{ top: number; left: number } | null>(null);
  // Funcionalidad "Quién está escribiendo": quién tiene texto sin mandar en
  // este chat ahora mismo (ver src/lib/chat-collab.ts), y quién mandó cada
  // mensaje saliente — ambos llegan de un GET inicial al abrir el chat y se
  // mantienen al día en vivo por SSE (ver el useInboxLiveUpdates de más
  // abajo). Puramente informativo, no restringe quién puede escribir.
  const [presence, setPresence] = useState<ChatPresenceState>({ typingBy: null, typingUntil: null });
  const [attributionMap, setAttributionMap] = useState<Record<string, string>>({});
  const [showTyping, setShowTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const lastInitialScrollKeyRef = useRef("");
  const highlightTimeoutRef = useRef<number | null>(null);
  const localReplyContextsRef = useRef<LocalReplyContexts>({});
  const [localReplyContextVersion, setLocalReplyContextVersion] = useState(0);
  // Mensajes salientes que mostramos de forma optimista pero que el servidor
  // aún no nos ha confirmado (con clave por el id optimista original, que se
  // mantiene estable incluso una vez que sabemos el id real del mensaje).
  // Cada lugar que reemplaza el array de mensajes por completo con un fetch
  // fresco del servidor primero mezcla estos de vuelta — de lo contrario un
  // mensaje puede desaparecer un momento y volver a aparecer si el refetch
  // llega antes de que la propia API de Kapso refleje el envío.
  const pendingOutboundRef = useRef<Map<string, Message>>(new Map());
  // Ids de mensajes para los que ya se intentó el fallback de "responder al
  // abrir el chat" (ver el efecto más abajo), para que reabrir el mismo chat
  // aún sin responder no dispare una segunda respuesta de IA para el mismo
  // mensaje del cliente.
  const triggeredAutoReplyMessageIdsRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const lastSeenText = formatLastSeen(lastActiveAt);
  const displayInboxPhoneNumber = formatDisplayPhoneNumber(inboxPhoneNumber);
  const revealablePhoneNumber = formatDisplayPhoneNumber(phoneNumber);
  const threadConversationIds = useMemo(() => {
    const conversationIds = conversations.map(
      (conversation) => conversation.id,
    );
    return conversationIds.length > 0
      ? conversationIds
      : conversationId
        ? [conversationId]
        : [];
  }, [conversationId, conversations]);
  const threadMessagesQueryKey = useMemo(
    () => phoneThreadMessagesQueryKey(phoneNumberId, phoneNumber, threadConversationIds),
    [phoneNumberId, phoneNumber, threadConversationIds],
  );
  const threadKey = threadConversationIds.join(":");
  const initialScrollKey = `${conversationId ?? ""}:${threadKey}`;
  // Funcionalidad "Candado de chat": clave estable de este contacto (no
  // cambia si se cargan más conversationIds viejos, a diferencia de
  // `threadKey` de arriba) — misma que ya usa "Mensajes destacados" en
  // handleToggleStar más abajo.
  const collabThreadKey = useMemo(
    () => (phoneNumberId && (phoneNumber || businessScopedUserId)
      ? threadKeyFor(phoneNumberId, phoneNumber ?? "", undefined, businessScopedUserId)
      : null),
    [phoneNumberId, phoneNumber, businessScopedUserId],
  );

  const getScrollViewport = useCallback(() => {
    return (
      messagesContainerRef.current?.querySelector<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      ) ?? null
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = getScrollViewport();

    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [getScrollViewport]);

  const scrollToSelectedConversation = useCallback(() => {
    const viewport = getScrollViewport();

    if (!viewport || !conversationId) {
      scrollToBottom();
      return;
    }

    const selectedConversationMessages = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-conversation-id]"),
    ).filter((element) => element.dataset.conversationId === conversationId);
    const targetMessage =
      selectedConversationMessages[selectedConversationMessages.length - 1];

    if (targetMessage) {
      targetMessage.scrollIntoView({ behavior: "auto", block: "center" });
      return;
    }

    scrollToBottom();
  }, [conversationId, getScrollViewport, scrollToBottom]);

  const scrollToMessage = useCallback((messageId: string) => {
    const viewport = getScrollViewport();
    if (!viewport) return;

    const targetMessage = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find((element) => element.dataset.messageId === messageId);

    if (!targetMessage) return;

    targetMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);

    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimeoutRef.current = null;
    }, 2_000);
  }, [getScrollViewport]);

  const handleReplyToMessage = useCallback((message: Message) => {
    setReplyingToMessage(message);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }, []);

  /** Funcionalidad "Mensajes destacados": botón de estrella de una burbuja. */
  const handleToggleStar = useCallback((message: Message) => {
    if (!onToggleStarredMessage || !phoneNumberId || (!phoneNumber && !businessScopedUserId)) return;

    onToggleStarredMessage({
      id: message.id,
      threadKey: threadKeyFor(phoneNumberId, phoneNumber ?? "", undefined, businessScopedUserId),
      contactName,
      phoneNumber,
      content: getDisplayMessageContent(message) || message.caption || "",
      direction: message.direction,
      createdAt: message.createdAt,
    });
  }, [onToggleStarredMessage, phoneNumberId, phoneNumber, businessScopedUserId, contactName]);

  /** Funcionalidad "Reaccionar a un mensaje": clic en un emoji del selector. */
  const handleSendReaction = useCallback(async (message: Message, emoji: string) => {
    setReactionPickerMessageId(null);
    if (!phoneNumberId || !phoneNumber) return;

    // Optimista: muestra la reacción de inmediato, sin esperar la respuesta
    // del servidor ni el próximo sondeo — se reconcilia con el servidor
    // (por si la API la rechaza) en el finally de abajo.
    queryClient.setQueryData<Message[]>(threadMessagesQueryKey, (current = []) =>
      current.map((m) => (m.id === message.id ? { ...m, reactionEmoji: emoji } : m)),
    );

    try {
      await fetch("/api/messages/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId, to: phoneNumber, messageId: message.id, emoji }),
      });
    } catch (error) {
      console.error("Failed to send reaction:", error);
    } finally {
      // invalidateQueries (no refetchThreadMessages, que se declara más
      // abajo) para reconciliar con el servidor sin depender del orden de
      // declaración de hooks en el archivo.
      queryClient.invalidateQueries({ queryKey: threadMessagesQueryKey });
    }
  }, [phoneNumberId, phoneNumber, queryClient, threadMessagesQueryKey]);

  const handleCancelReply = useCallback(() => {
    setReplyingToMessage(null);
  }, []);

  const persistLocalReplyContexts = useCallback((contexts: LocalReplyContexts) => {
    const prunedContexts = pruneLocalReplyContexts(contexts);
    localReplyContextsRef.current = prunedContexts;
    setLocalReplyContextVersion((version) => version + 1);

    try {
      window.localStorage.setItem(
        LOCAL_REPLY_CONTEXT_STORAGE_KEY,
        JSON.stringify(prunedContexts),
      );
    } catch {
      // Con mantener el mapa en memoria alcanza para la sesión actual.
    }
  }, []);

  const rememberLocalReplyContext = useCallback((sentMessageId: string, replyTarget: Message) => {
    persistLocalReplyContexts({
      ...localReplyContextsRef.current,
      [sentMessageId]: {
        contextMessageId: replyTarget.id,
        repliedTo: {
          id: replyTarget.id,
          conversationId: replyTarget.conversationId,
          content: getReplyPreviewContent(replyTarget),
          direction: replyTarget.direction,
          messageType: replyTarget.messageType,
          senderName: getMessageSenderLabel(replyTarget, contactName, phoneNumber),
        },
        createdAt: Date.now(),
      },
    });
  }, [contactName, persistLocalReplyContexts, phoneNumber]);

  const applyLocalReplyContexts = useCallback((inputMessages: Message[]) => {
    const localReplyContexts = localReplyContextsRef.current;
    if (Object.keys(localReplyContexts).length === 0) return inputMessages;

    return inputMessages.map((message) => {
      if (message.contextMessageId || message.repliedTo) return message;

      const localReplyContext = localReplyContexts[message.id];
      if (!localReplyContext) return message;

      return {
        ...message,
        contextMessageId: localReplyContext.contextMessageId,
        repliedTo: localReplyContext.repliedTo,
      };
    });
  }, []);

  const mergePendingOutbound = useCallback((serverMessages: Message[]): Message[] => {
    if (pendingOutboundRef.current.size === 0) return serverMessages;

    const confirmedIds = new Set(serverMessages.map((message) => message.id));
    const stillPending: Message[] = [];

    pendingOutboundRef.current.forEach((message, key) => {
      if (confirmedIds.has(message.id)) {
        pendingOutboundRef.current.delete(key);
      } else {
        stillPending.push(message);
      }
    });

    return stillPending.length > 0 ? [...serverMessages, ...stillPending] : serverMessages;
  }, []);

  const fetchThreadMessages = useCallback(async () => {
    if (threadConversationIds.length === 0) return [];

    const latestConversationId = threadConversationIds[0];
    const messageBatches = await Promise.all(
      threadConversationIds.map((threadConversationId) => {
        const queryKey = conversationMessagesQueryKey(phoneNumberId, threadConversationId);
        const cachedMessages = queryClient.getQueryData<Message[]>(queryKey);

        if (cachedMessages && threadConversationId !== latestConversationId) {
          return cachedMessages;
        }

        return queryClient.fetchQuery({
          queryKey,
          queryFn: () => fetchConversationMessages(threadConversationId, phoneNumberId),
          staleTime: 0,
        });
      }),
    );

    return applyLocalReplyContexts(normalizeMessages(mergePendingOutbound(messageBatches.flat())));
  }, [applyLocalReplyContexts, mergePendingOutbound, phoneNumberId, queryClient, threadConversationIds]);

  const { data: messages = [], isPending: messagesQueryPending, refetch: refetchThreadMessages } = useQuery({
    queryKey: threadMessagesQueryKey,
    queryFn: fetchThreadMessages,
    enabled: threadConversationIds.length > 0,
    // El SSE (ver useInboxLiveUpdates más abajo) ya entrega mensajes nuevos
    // y actualizaciones de estado en el instante en que se dispara el
    // webhook — este intervalo es solo un respaldo por si esa conexión se
    // cae. Sondear tan seguido terminó compitiendo con acciones reales
    // (como enviar) por el presupuesto limitado de conexiones concurrentes
    // por origen del navegador, que era lo que hacía que los envíos se
    // encolaran y tardaran varios segundos en vez de ~1-2s. La excepción es
    // el check doble ("delivered") recién después de mandar un mensaje — ver
    // OUTBOUND_STATUS_FAST_POLL_INTERVAL_MS más arriba: ahí sí vale la pena
    // sondear más seguido un rato, para que no dependa únicamente del webhook.
    refetchInterval: (query) => {
      const currentMessages = query.state.data ?? [];
      const hasRecentUnconfirmedOutboundMessage = currentMessages.some((message) => {
        if (message.direction !== "outbound" || message.status !== "sent") return false;
        const ageMs = Date.now() - parseTimestamp(message.createdAt);
        return ageMs >= 0 && ageMs < OUTBOUND_STATUS_FAST_POLL_WINDOW_MS;
      });

      return hasRecentUnconfirmedOutboundMessage
        ? OUTBOUND_STATUS_FAST_POLL_INTERVAL_MS
        : OUTBOUND_STATUS_NORMAL_POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: true,
    refetchOnMount: false,
  });

  // Funcionalidad "Nuevo chat": la query de arriba queda deshabilitada
  // (`enabled: false`) cuando todavía no hay ningún conversationId real
  // (número recién ingresado, sin mensajes) — React Query la deja en estado
  // "pending" para siempre en ese caso, así que sin este ajuste la pantalla
  // se quedaría en el esqueleto de carga eternamente en vez de mostrar el
  // compositor de plantillas.
  const loading = messagesQueryPending && threadConversationIds.length > 0;

  // Ya no hay "Limpiar chat" ni "Eliminar mensaje" (que eran los que
  // filtraban esto) — se dejó el nombre `visibleMessages` porque se usa en
  // muchos lugares más abajo. Lo único que sigue filtrando es la exclusión
  // puntual de HARDCODED_HIDDEN_MESSAGE_IDS (ver el comentario junto a esa
  // constante).
  const visibleMessages = useMemo(
    () => messages.filter((message) => !HARDCODED_HIDDEN_MESSAGE_IDS.has(message.id)),
    [messages],
  );

  // En el instante en que el webhook registra un mensaje de texto entrante
  // nuevo para este chat, se mete en la caché de inmediato para que la
  // burbuja aparezca sin esperar un round-trip fresco a la API de Kapso, y
  // luego se reconcilia con un refetch real justo después (que también
  // cubre mensajes/estados que no son de texto).
  useInboxLiveUpdates((payload) => {
    if (threadConversationIds.length === 0) return;

    const liveMessage = payload.message;
    if (liveMessage && threadConversationIds.includes(liveMessage.conversationId)) {
      queryClient.setQueryData<Message[]>(threadMessagesQueryKey, (current = []) =>
        normalizeMessages([...current, { ...liveMessage, hasMedia: false }]),
      );
    }
    refetchThreadMessages();
  }, (payload: ChatCollabPayload) => {
    // Funcionalidad "Quién está escribiendo": mismo stream SSE de arriba,
    // evento aparte — ver src/lib/chat-collab.ts. Se filtra por threadKey
    // porque esta misma conexión recibe los avisos de TODOS los chats, no
    // solo el que está abierto acá.
    if (!collabThreadKey || payload.threadKey !== collabThreadKey) return;
    if (payload.presence) setPresence(payload.presence);
    if (payload.attribution) {
      const { messageId, profile } = payload.attribution;
      setAttributionMap((current) => ({ ...current, [messageId]: profile }));
    }
  });

  // Funcionalidad "Quién está escribiendo": estado inicial al abrir el chat
  // (el SSE de arriba solo avisa de cambios DESDE que la conexión está
  // abierta, no el estado que ya tenía antes). No aplica al flujo de
  // "Nuevo chat"/plantillas (canSendRegularMessage en false), que no lo
  // necesita.
  useEffect(() => {
    if (!collabThreadKey || !canSendRegularMessage) return;
    let cancelled = false;

    const outboundIds = messages
      .filter((message) => message.direction === "outbound" && !message.id.startsWith("optimistic-"))
      .map((message) => message.id);
    const params = new URLSearchParams({ threadKey: collabThreadKey });
    if (outboundIds.length > 0) params.set("messageIds", outboundIds.join(","));

    fetch(`/api/conversations/collab?${params.toString()}`)
      .then((response) => response.json())
      .then((data: { presence?: ChatPresenceState; attribution?: Record<string, string> }) => {
        if (cancelled) return;
        if (data.presence) setPresence(data.presence);
        if (data.attribution) setAttributionMap((current) => ({ ...current, ...data.attribution }));
      })
      .catch(() => {
        // Sin esto no se sabe quién está escribiendo por ahora, pero el
        // chat sigue siendo usable — no vale la pena mostrar un error.
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabThreadKey, canSendRegularMessage]);

  // Funcionalidad "Quién está escribiendo": mientras alguien siga
  // escribiendo, presence.typingUntil se sigue empujando hacia adelante
  // (ver el onChange del input más abajo) — este efecto solo se encarga de
  // que el aviso "escribiendo…" desaparezca solo pasado ese momento, sin
  // esperar un nuevo evento SSE (que no llega hasta el próximo tecleo).
  useEffect(() => {
    if (!presence.typingUntil) {
      setShowTyping(false);
      return;
    }
    const msLeft = presence.typingUntil - Date.now();
    if (msLeft <= 0) {
      setShowTyping(false);
      return;
    }
    setShowTyping(true);
    const timer = window.setTimeout(() => setShowTyping(false), msLeft);
    return () => window.clearTimeout(timer);
  }, [presence.typingUntil]);

  // Funcionalidad "Responder solo al abrir el chat": esta es la ÚNICA forma
  // en que la IA responde — a pedido del usuario, el webhook (ver
  // src/app/api/webhooks/whatsapp/route.ts) ya NO contesta apenas llega un
  // mensaje nuevo. En el instante en que un agente abre un chat cuyo último
  // mensaje sigue siendo un inbound sin responder, le pide a la IA una
  // respuesta ahí mismo. No hace nada si la IA (o un humano) ya respondió,
  // ya que el último mensaje sería outbound para entonces.
  //
  // Desactivada a pedido del usuario (respuestas automáticas de IA apagadas
  // por ahora) — para volver a activarla, cambiar esta constante a `true`.
  const AI_AUTO_REPLY_ENABLED = false;
  useEffect(() => {
    if (!AI_AUTO_REPLY_ENABLED) return;
    if (!isVisible || !phoneNumberId || !phoneNumber) return;
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.direction !== "inbound" || !lastMessage.content) return;
    if (triggeredAutoReplyMessageIdsRef.current.has(lastMessage.id)) return;

    triggeredAutoReplyMessageIdsRef.current.add(lastMessage.id);

    fetch("/api/messages/trigger-ai-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumberId,
        to: phoneNumber,
        incomingText: lastMessage.content,
        messageId: lastMessage.id,
        conversationId: lastMessage.conversationId,
      }),
    })
      .then(() => refetchThreadMessages())
      .catch((error) => {
        console.error("Failed to trigger AI auto-reply on chat open:", error);
        // Permite reintentar la próxima vez que se abra este chat.
        triggeredAutoReplyMessageIdsRef.current.delete(lastMessage.id);
      });
  }, [isVisible, messages, phoneNumber, phoneNumberId, refetchThreadMessages]);

  useEffect(() => {
    try {
      const storedContexts = window.localStorage.getItem(LOCAL_REPLY_CONTEXT_STORAGE_KEY);
      if (!storedContexts) return;

      const parsedContexts = JSON.parse(storedContexts);
      if (parsedContexts && typeof parsedContexts === "object" && !Array.isArray(parsedContexts)) {
        persistLocalReplyContexts(parsedContexts as LocalReplyContexts);
      }
    } catch {
      localReplyContextsRef.current = {};
    }
  }, [persistLocalReplyContexts]);

  useEffect(() => {
    const currentMessages = queryClient.getQueryData<Message[]>(threadMessagesQueryKey);
    if (!currentMessages) return;

    queryClient.setQueryData(
      threadMessagesQueryKey,
      applyLocalReplyContexts(currentMessages),
    );
  }, [applyLocalReplyContexts, localReplyContextVersion, queryClient, threadMessagesQueryKey]);

  const refreshCurrentThread = useCallback(async () => {
    if (threadConversationIds.length === 0) return;

    const messageBatches = await Promise.all(
      threadConversationIds.map((threadConversationId) =>
        queryClient.fetchQuery({
          queryKey: conversationMessagesQueryKey(phoneNumberId, threadConversationId),
          queryFn: () => fetchConversationMessages(threadConversationId, phoneNumberId),
          staleTime: 0,
        }),
      ),
    );

    queryClient.setQueryData(
      threadMessagesQueryKey,
      applyLocalReplyContexts(normalizeMessages(mergePendingOutbound(messageBatches.flat()))),
    );
  }, [applyLocalReplyContexts, mergePendingOutbound, phoneNumberId, queryClient, threadConversationIds, threadMessagesQueryKey]);

  useEffect(() => {
    if (isNearBottom) {
      scrollToBottom();
    }
  }, [visibleMessages, isNearBottom, scrollToBottom]);

  // Vuelve a ocultar el número de teléfono cada vez que se abre una conversación distinta.
  useEffect(() => {
    setPhoneNumberRevealed(false);
  }, [conversationId]);

  useEffect(() => {
    if (!showEmojiPicker) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!emojiPickerRef.current?.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowEmojiPicker(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showEmojiPicker]);

  // Funcionalidad "Selector de plantillas en el chat": mismo patrón de
  // cerrar-al-hacer-clic-afuera / Escape que el selector de emojis de arriba.
  useEffect(() => {
    if (!showTemplatePicker) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!templatePickerRef.current?.contains(event.target as Node)) {
        setShowTemplatePicker(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowTemplatePicker(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showTemplatePicker]);

  // Funcionalidad "Reaccionar a un mensaje": cierra el selector de emoji si
  // se hace clic afuera (el selector se dibuja con un portal — ver
  // data-reaction-picker más abajo — así que no alcanza con un solo ref).
  useEffect(() => {
    if (!reactionPickerMessageId) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-reaction-picker]")) {
        setReactionPickerMessageId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReactionPickerMessageId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [reactionPickerMessageId]);

  const insertEmoji = (emoji: string) => {
    const input = messageInputRef.current;
    const selectionStart = input?.selectionStart ?? messageInput.length;
    const selectionEnd = input?.selectionEnd ?? messageInput.length;

    setMessageInput(
      (current) => current.slice(0, selectionStart) + emoji + current.slice(selectionEnd),
    );

    // Restaura el foco y coloca el cursor justo después del emoji insertado.
    requestAnimationFrame(() => {
      const nextPosition = selectionStart + emoji.length;
      input?.focus();
      input?.setSelectionRange(nextPosition, nextPosition);
    });
  };

  useEffect(() => {
    if (loading || visibleMessages.length === 0 || !threadKey) return;
    if (lastInitialScrollKeyRef.current === initialScrollKey) return;

    lastInitialScrollKeyRef.current = initialScrollKey;
    setIsNearBottom(true);

    const viewport = getScrollViewport();
    const content = viewport?.firstElementChild;
    let animationFrameId = 0;
    let secondAnimationFrameId = 0;
    let timeoutId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let stopped = false;

    const stopInitialScrollSync = () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrameId);
      window.cancelAnimationFrame(secondAnimationFrameId);
      window.clearTimeout(timeoutId);
      resizeObserver?.disconnect();
      viewport?.removeEventListener("wheel", stopInitialScrollSync);
      viewport?.removeEventListener("touchstart", stopInitialScrollSync);
    };

    const syncSelectedConversationScroll = () => {
      if (stopped) return;

      scrollToSelectedConversation();
    };

    if (viewport) {
      viewport.addEventListener("wheel", stopInitialScrollSync, {
        passive: true,
      });
      viewport.addEventListener("touchstart", stopInitialScrollSync, {
        passive: true,
      });
    }

    if (typeof ResizeObserver !== "undefined" && content) {
      resizeObserver = new ResizeObserver(syncSelectedConversationScroll);
      resizeObserver.observe(content);
    }

    syncSelectedConversationScroll();
    animationFrameId = window.requestAnimationFrame(() => {
      syncSelectedConversationScroll();
      secondAnimationFrameId = window.requestAnimationFrame(
        syncSelectedConversationScroll,
      );
    });
    timeoutId = window.setTimeout(stopInitialScrollSync, 1_000);

    return stopInitialScrollSync;
  }, [
    getScrollViewport,
    initialScrollKey,
    loading,
    visibleMessages.length,
    scrollToSelectedConversation,
    threadKey,
  ]);

  // Funcionalidad "Mensajes destacados": si se llegó a este chat desde el
  // panel de destacados (clic en un mensaje puntual), intenta hacer scroll
  // hasta ese mensaje una vez que ya cargó — se espera un momento para que
  // gane sobre el scroll inicial (al fondo / a la conversación seleccionada)
  // de arriba. Si el mensaje es muy viejo y no está entre los ya cargados,
  // simplemente no pasa nada (el chat igual queda abierto).
  useEffect(() => {
    if (!jumpToMessageId || loading || visibleMessages.length === 0) return;

    const timeoutId = window.setTimeout(() => {
      scrollToMessage(jumpToMessageId);
      onJumpToMessageHandled?.();
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [jumpToMessageId, loading, visibleMessages.length, scrollToMessage, onJumpToMessageHandled]);

  useEffect(() => {
    setCanSendRegularMessage(isWithin24HourWindow(messages));
  }, [messages]);

  useEffect(() => {
    setReplyingToMessage(null);
    setShowTemplatePicker(false);
  }, [threadKey]);

  useEffect(() => {
    if (!canSendRegularMessage) {
      setReplyingToMessage(null);
    } else {
      // Funcionalidad "Selector de plantillas en el chat": si el contacto
      // te vuelve a escribir mientras tenías el panel de plantillas
      // abierto, ya no hace falta — se cierra solo.
      setShowTemplatePicker(false);
    }
  }, [canSendRegularMessage]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  // Rastrea si el usuario está cerca del final del scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const viewport = container.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (!viewport) return;

      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setIsNearBottom(distanceFromBottom < 100);
    };

    const viewport = container.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll);
      return () => viewport.removeEventListener("scroll", handleScroll);
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCurrentThread();
    } finally {
      setRefreshing(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const originalFile = e.target.files?.[0];
    if (!originalFile) return;

    // Funcionalidad "Convertir imagen no soportada": WhatsApp solo acepta
    // JPEG/PNG para mensajes de tipo "image" (ni WebP ni GIF ni otros
    // formatos, aunque el navegador los abra sin problema) — antes esto
    // hacía que la imagen se subiera "bien" (Kapso la guarda igual) pero
    // WhatsApp rechazara la entrega en silencio, quedando como "Not
    // delivered" sin ninguna pista de por qué. Si el archivo elegido es una
    // imagen en un formato no soportado, se convierte a JPEG acá mismo,
    // antes de subirla.
    const file = await convertImageToSupportedFormatIfNeeded(originalFile);

    setSelectedFile(file);

    // Crea la vista previa para imágenes
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    // Solo se serializa sobre `sending` cuando ya hay una subida de archivo
    // en vuelo — un envío de texto plano siempre recibe una burbuja
    // optimista instantánea más abajo, así que no hay razón para bloquear al
    // usuario de disparar el siguiente mensaje (escribir + Enter, uno tras
    // otro) mientras el anterior sigue en camino a la red.
    if ((!messageInput.trim() && !selectedFile) || (!phoneNumber && !businessScopedUserId) || (sending && selectedFile))
      return;

    const replyTarget = replyingToMessage;
    const trimmedBody = messageInput.trim();
    const fileToSend = selectedFile;
    const targetConversationId = threadConversationIds[0] ?? conversationId;

    // Muestra una burbuja de inmediato y limpia el compositor al instante —
    // no espera al request de envío ni a los refrescos de abajo. Antes esos
    // round-trips de red corrían antes de que el input se limpiara o algo
    // apareciera, que era lo que hacía sentir lento el envío aunque el
    // mensaje en sí saliera rápido.
    let optimisticMessageId: string | null = null;
    if (trimmedBody && !fileToSend && targetConversationId && phoneNumberId) {
      optimisticMessageId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticMessage: Message = {
        id: optimisticMessageId,
        conversationId: targetConversationId,
        phoneNumberId,
        direction: "outbound",
        content: trimmedBody,
        createdAt: new Date().toISOString(),
        status: "pending",
        phoneNumber: phoneNumber ?? "",
        hasMedia: false,
        ...(replyTarget && {
          contextMessageId: replyTarget.id,
          repliedTo: {
            id: replyTarget.id,
            conversationId: replyTarget.conversationId,
            content: replyTarget.content,
            direction: replyTarget.direction,
            messageType: replyTarget.messageType,
            senderName: replyTarget.direction === "outbound" ? "You" : (contactName || "Contact"),
          },
        }),
      };

      pendingOutboundRef.current.set(optimisticMessageId, optimisticMessage);
      queryClient.setQueryData<Message[]>(threadMessagesQueryKey, (current = []) =>
        normalizeMessages([...current, optimisticMessage]),
      );

      setMessageInput("");
      setReplyingToMessage(null);
      // Por si acaso: asegura que el foco se quede (o vuelva de inmediato)
      // para que escribir el siguiente mensaje y darle Enter otra vez
      // funcione al instante, sin necesidad de hacer clic de nuevo en el campo.
      window.requestAnimationFrame(() => {
        messageInputRef.current?.focus();
      });
    }

    setSending(true);
    try {
      const formData = new FormData();
      if (phoneNumber) {
        formData.append("to", phoneNumber);
      } else if (businessScopedUserId) {
        // Funcionalidad "Contactos con username (BSUID)": ver el comentario
        // junto a la prop businessScopedUserId más arriba.
        formData.append("businessScopedUserId", businessScopedUserId);
      }
      if (phoneNumberId) {
        formData.append("phoneNumberId", phoneNumberId);
      }
      if (replyTarget?.id) {
        formData.append("contextMessageId", replyTarget.id);
      }
      if (trimmedBody) {
        // Nota: se probó anteponer el perfil activo al mensaje real de
        // WhatsApp (para que el cliente también viera quién le escribía),
        // pero el usuario lo vio duplicado con la etiqueta de color de
        // arriba de la burbuja (ver messageSenderLabel) y pidió dejar solo
        // esa — quedó revertido, el mensaje que sale por WhatsApp es el
        // texto tal cual se escribió, sin ningún agregado.
        formData.append("body", trimmedBody);
      }
      if (fileToSend) {
        formData.append("file", fileToSend);
      }

      const response = await fetch("/api/messages/send", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to send message");
      }

      // Funcionalidad "Sonido de mensajes": solo para el envío manual desde
      // este compositor (ver conversation-list.tsx para el sonido de
      // "recibido", y el de "enviado" para respuestas automáticas de la IA).
      playSentMessageSound();

      const sentMessageId = extractSentMessageId(data);

      // Funcionalidad "Quién mandó cada mensaje": queda registrado quién lo
      // mandó de verdad, para la etiqueta sobre la burbuja (ver
      // messageSenderLabel más arriba) — se actualiza local al toque, sin
      // esperar el eco del propio SSE de vuelta.
      if (sentMessageId && collabThreadKey && activeSenderName) {
        setAttributionMap((current) => ({ ...current, [sentMessageId]: activeSenderName }));
        postCollabAction(collabThreadKey, "attribute", { profile: activeSenderName, messageId: sentMessageId });
      }

      if (sentMessageId && replyTarget) {
        rememberLocalReplyContext(sentMessageId, replyTarget);
      }

      if (optimisticMessageId) {
        // Reemplaza por el id real del mensaje (en cuanto se sepa) de
        // inmediato, en vez de esperar a que el refresco en segundo plano de
        // abajo lo haga. Así, si el fetch del servidor de ese refresco
        // todavía no alcanzó al envío, la mezcla igual reconoce este mensaje
        // como "el mismo" la siguiente vez en vez de quitarlo y volverlo a
        // agregar (que era lo que causaba el parpadeo).
        const pendingMessage = pendingOutboundRef.current.get(optimisticMessageId);
        if (pendingMessage) {
          const confirmedMessage: Message = {
            ...pendingMessage,
            id: sentMessageId ?? pendingMessage.id,
            status: "sent",
          };
          pendingOutboundRef.current.set(optimisticMessageId, confirmedMessage);
          queryClient.setQueryData<Message[]>(threadMessagesQueryKey, (current = []) =>
            current.map((message) => (message.id === optimisticMessageId ? confirmedMessage : message)),
          );
        }
      }

      if (!optimisticMessageId) {
        // No hay burbuja optimista para envíos de media — solo se limpia
        // ahora que la subida realmente tuvo éxito.
        setMessageInput("");
        setReplyingToMessage(null);
      }
      handleRemoveFile();

      // Los envíos de texto ya tienen su burbuja + un estado "sent"
      // aplicado arriba — no hace falta forzar además un fetch completo
      // extra del chat ahora mismo. Ese round-trip extra por envío se iba
      // acumulando contra Kapso/Meta junto con el sondeo normal y hacía que
      // los requests de envío reales se encolaran uno tras otro (el chequeo
      // de estado tardaba varios segundos en aparecer al enviar varios
      // mensajes seguidos). Las actualizaciones de entrega/lectura igual
      // llegan por su cuenta vía el webhook (SSE) y el intervalo de sondeo
      // normal, así que no se pierde nada por no forzarlo aquí.
      if (optimisticMessageId) {
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY }).catch((refreshError) => {
          console.error("Error refreshing conversation list after send:", refreshError);
        });
        setSending(false);
      } else {
        // No hay burbuja optimista para envíos de media — hace el refresco
        // completo y lo espera, para que el usuario vea el adjunto enviado
        // antes de que el compositor limpie su estado de "enviando".
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY }),
          refreshCurrentThread(),
        ]);
        setSending(false);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      if (optimisticMessageId) {
        const failedOptimisticId = optimisticMessageId;
        pendingOutboundRef.current.delete(failedOptimisticId);
        queryClient.setQueryData<Message[]>(threadMessagesQueryKey, (current = []) =>
          current.filter((message) => message.id !== failedOptimisticId),
        );
        // Devuelve el texto — el compositor se limpió de forma optimista,
        // pero el envío realmente falló, así que no hacer que el usuario lo
        // vuelva a escribir.
        setMessageInput(trimmedBody);
        setReplyingToMessage(replyTarget);
      }
      setSending(false);
    }
  };

  const handleTemplateSent = async () => {
    await refreshCurrentThread();

    if (phoneNumber && onTemplateSent) {
      await onTemplateSent(phoneNumber, phoneNumberId);
    }
  };

  // Funcionalidad "Nuevo chat": para un número recién ingresado (sin ningún
  // mensaje todavía) no existe conversationId de verdad — pero sí hay
  // phoneNumber/businessScopedUserId, así que igual se abre la vista de chat
  // (con el compositor de plantillas más abajo) en vez del placeholder.
  if (!conversationId && !phoneNumber && !businessScopedUserId) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 items-center justify-center bg-muted/50 p-6 text-center",
          !isVisible && "hidden md:flex",
        )}
      >
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          Selecciona una conversación para ver los mensajes
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col chat-canvas-doodle",
          !isVisible && "hidden md:flex",
        )}
      >
        <div className="chat-header-on-brand border-b border-[var(--chat-border-strong)] bg-[var(--chat-header)] p-2.5 safe-area-top sm:p-3">
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 flex-1">
              {onBack && (
                <Button
                  onClick={onBack}
                  variant="ghost"
                  size="icon"
                  className="size-11 text-muted-foreground hover:bg-[var(--chat-hover)] md:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div className="flex-1">
                <Skeleton className="h-5 w-40 mb-1" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle className="size-11 md:hidden" />
              <Skeleton className="size-10 rounded-lg" />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 lg:p-6">
          <div className="mx-auto w-full max-w-[900px] space-y-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className={cn(
                  "flex mb-2",
                  i % 2 === 0 ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[min(88%,34rem)] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[min(78%,38rem)] lg:max-w-[min(70%,42rem)]",
                  )}
                >
                  <Skeleton
                    className="h-4 max-w-full mb-2"
                    style={{ width: `${MESSAGE_SKELETON_WIDTHS[i - 1]}px` }}
                  />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Funcionalidad "Quién está escribiendo": solo se muestra si de verdad
  // hay clave (no aplica al flujo de plantillas/"Nuevo chat"), y solo
  // mientras sea OTRO perfil el que está escribiendo — verte a vos mismo
  // "escribiendo" no aporta nada.
  const presenceEnabled = canSendRegularMessage && !!collabThreadKey;
  const otherPersonTyping = presenceEnabled && showTyping && !!presence.typingBy && presence.typingBy !== activeSenderName;
  const typingStyle = getProfileStyle(presence.typingBy ?? "");

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col chat-canvas-doodle",
        !isVisible && "hidden md:flex",
      )}
    >
      <div className="chat-header-on-brand border-b border-[var(--chat-border-strong)] bg-[var(--chat-header)] p-2.5 safe-area-top sm:p-3">
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {onBack && (
              <Button
                onClick={onBack}
                variant="ghost"
                size="icon"
                className="size-11 flex-shrink-0 text-muted-foreground hover:bg-[var(--chat-hover)] md:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="truncate text-sm font-medium text-foreground sm:text-base">
                {contactName || phoneNumber || "Conversation"}
              </h2>
              {(lastSeenText || revealablePhoneNumber) && (
                <button
                  type="button"
                  onClick={() => setPhoneNumberRevealed((revealed) => !revealed)}
                  className={cn(
                    "flex max-w-full items-center gap-1 truncate text-xs hover:text-foreground",
                    lastSeenText ? "text-[var(--chat-presence)]" : "text-muted-foreground",
                  )}
                  title={phoneNumberRevealed ? "Hide phone number" : "Show phone number"}
                >
                  <span className="truncate">
                    {lastSeenText ? `Active · ${lastSeenText}` : "Tap to show phone number"}
                    {phoneNumberRevealed && revealablePhoneNumber && ` · ${revealablePhoneNumber}`}
                  </span>
                  {revealablePhoneNumber && (
                    phoneNumberRevealed ? (
                      <EyeOff className="size-3 shrink-0" />
                    ) : (
                      <Eye className="size-3 shrink-0" />
                    )
                  )}
                </button>
              )}
              {(inboxDisplayName || displayInboxPhoneNumber) && (
                <p className="truncate text-[11px] text-muted-foreground/80">
                  via {inboxDisplayName || displayInboxPhoneNumber}
                  {inboxDisplayName && displayInboxPhoneNumber ? ` · ${displayInboxPhoneNumber}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle className="size-11 md:hidden" />
            {/* Funcionalidad "Selector de plantillas en el chat": solo
                aparece cuando hace falta (no se puede mandar texto libre) —
                a pedido del usuario, dejó de estar siempre visible debajo
                del chat y ahora se abre como panel flotante desde acá,
                mismo patrón que el selector de emoji del compositor. */}
            {!canSendRegularMessage && (
              <div className="relative" ref={templatePickerRef}>
                <Button
                  type="button"
                  onClick={() => setShowTemplatePicker((open) => !open)}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-11 text-muted-foreground hover:bg-[var(--chat-hover)] md:size-10",
                    showTemplatePicker && "bg-[var(--chat-hover)] text-foreground",
                  )}
                  aria-haspopup="menu"
                  aria-expanded={showTemplatePicker}
                  aria-label="Elegir plantilla"
                  title="Elegir plantilla"
                >
                  <LayoutTemplate className="h-4 w-4" />
                </Button>

                {showTemplatePicker && (
                  <div
                    role="menu"
                    aria-label="Selector de plantillas"
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-[min(70vh,32rem)] w-[min(92vw,26rem)] overflow-y-auto rounded-xl border border-[var(--chat-border-strong)] bg-popover p-1 shadow-lg"
                  >
                    <TemplateComposer
                      phoneNumber={phoneNumber}
                      businessScopedUserId={businessScopedUserId}
                      phoneNumberId={phoneNumberId}
                      onSent={async () => {
                        setShowTemplatePicker(false);
                        await handleTemplateSent();
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="ghost"
              size="icon"
              className="size-11 text-muted-foreground hover:bg-[var(--chat-hover)] md:size-10"
              aria-label="Refresh messages"
              title="Refresh messages"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea
        ref={messagesContainerRef}
        className="h-0 flex-1 overscroll-contain p-3 sm:p-4 lg:p-6"
      >
        <div className="mx-auto w-full max-w-[900px]">
          {visibleMessages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No messages yet
            </p>
          ) : (
            visibleMessages.map((message, index) => {
              const prevMessage = index > 0 ? visibleMessages[index - 1] : null;
              const showDateDivider = shouldShowDateDivider(
                message,
                prevMessage,
              );
              const displayMessageContent = getDisplayMessageContent(message);
              // Burbuja "transparente" para fotos/videos sin texto propio (ni
              // caption ni contenido) — en vez de la burbuja de color de
              // siempre con la imagen adentro (que se ve como un marco
              // grueso raro alrededor de la foto), se le quita el
              // fondo/padding y la imagen queda pegada a los bordes
              // redondeados, como en WhatsApp real. Si el mensaje sí tiene
              // caption o texto, se queda con la burbuja de color normal. No
              // aplica a stickers — esos ya son pequeños e independientes,
              // envolverlos en esta burbuja se vería raro.
              const isMediaOnlyBubble =
                (message.messageType === "image" || message.messageType === "video") &&
                !message.caption &&
                !displayMessageContent;
              const isHighlighted = highlightedMessageId === message.id;
              // Funcionalidad "Mensajes destacados": si esta burbuja tiene la estrella activada.
              const isStarred = isMessageStarred(message.id, starredMessages);
              // Funcionalidad "Candado de chat": quién mandó este mensaje de
              // verdad (registrado al momento de enviarlo — ver
              // handleSendMessage), no "el perfil activo ahora mismo" como
              // antes. La burbuja optimista (todavía sin id real confirmado)
              // usa el perfil activo como mejor estimación mientras tanto;
              // un mensaje viejo de antes de esta funcionalidad, sin
              // atribución registrada, se queda sin etiqueta — no se sabe
              // de verdad quién lo mandó, así que no vale mostrar cualquiera.
              const messageSenderLabel = message.direction === "outbound"
                ? attributionMap[message.id] ?? (message.id.startsWith("optimistic-") ? activeSenderName : undefined)
                : undefined;

              return (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  data-conversation-id={message.conversationId}
                >
                  {showDateDivider && (
                    <div className="flex justify-center mt-4 mb-6">
                      <Badge variant="secondary" className="shadow-sm">
                        {formatDateDivider(message.createdAt)}
                      </Badge>
                    </div>
                  )}

                  <div
                    className={cn(
                      "group flex mb-2 items-start gap-1.5 rounded-lg px-1 py-0.5 transition-colors",
                      message.direction === "outbound"
                        ? "justify-end"
                        : "justify-start",
                      isHighlighted && "bg-primary/10",
                      // Funcionalidad "Perfil": la etiqueta de nombre flota
                      // encima de la burbuja con posición absoluta (no
                      // ocupa espacio real en el flujo) — sin este margen
                      // extra, cuando el mensaje de arriba queda muy pegado
                      // (solo el mb-2 normal entre mensajes), la etiqueta se
                      // monta sobre él y se ve todo apretado/saturado.
                      (message.direction === "outbound" ? messageSenderLabel : (contactName || phoneNumber)) && "mt-4",
                    )}
                  >
                    {message.direction === "outbound" && (
                      <div className="mt-1 flex flex-shrink-0 items-center gap-0.5">
                        {onToggleStarredMessage && (
                          <Button
                            type="button"
                            onClick={() => handleToggleStar(message)}
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "size-7 text-muted-foreground hover:bg-[var(--chat-hover)]",
                              isStarred ? "text-amber-400" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
                            )}
                            aria-label={isStarred ? "Unstar message" : "Star message"}
                            title={isStarred ? "Unstar message" : "Star message"}
                          >
                            <Star className={cn("h-3.5 w-3.5", isStarred && "fill-current")} />
                          </Button>
                        )}
                        {/* Funcionalidad "Reaccionar a un mensaje": a pedido
                            del usuario, solo se puede reaccionar a los
                            mensajes del cliente (entrantes) — no a los
                            propios. Por eso el botón de carita no aparece en
                            este bloque (saliente), solo en el de abajo
                            (entrante). */}
                        {canSendRegularMessage && (
                          <Button
                            type="button"
                            onClick={() => handleReplyToMessage(message)}
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground opacity-100 hover:bg-[var(--chat-hover)] sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="Reply to message"
                            title="Reply"
                          >
                            <Reply className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                    {/* Funcionalidad "Perfil": mismo tratamiento que en las
                        burbujas salientes, pero con el nombre del contacto —
                        avatar afuera a la izquierda de la burbuja (hermano
                        suyo en la fila, no adentro), a distancia fija del
                        borde de la fila igual que el de arriba. */}
                    {message.direction === "inbound" && (
                      <span
                        className="mb-0.5 flex size-8 flex-shrink-0 items-center justify-center self-end rounded-full bg-[var(--chat-avatar)] text-[var(--chat-avatar-foreground)]"
                        aria-hidden="true"
                        title={contactName || phoneNumber}
                      >
                        <User className="size-4" />
                      </span>
                    )}
                    <div
                      className={cn(
                        "relative max-w-[min(88%,34rem)] rounded-2xl shadow-sm transition-shadow sm:max-w-[min(78%,38rem)] lg:max-w-[min(70%,42rem)]",
                        isMediaOnlyBubble
                          ? "bg-transparent p-0"
                          : "px-3 py-2",
                        message.direction === "outbound"
                          ? cn("chat-bubble-on-accent text-foreground", !isMediaOnlyBubble && "rounded-br-none bg-[var(--chat-bubble-outgoing)]")
                          : cn("text-foreground", !isMediaOnlyBubble && "rounded-bl-none bg-[var(--chat-bubble-incoming)]"),
                        isHighlighted && "ring-2 ring-primary/35",
                      )}
                    >
                      {/* Colita de la burbuja (como WhatsApp real) — un
                          triángulo pegado a su esquina inferior, del lado en
                          que está alineada (derecha para lo que enviamos,
                          izquierda para lo que nos mandan). Solo en burbujas
                          de texto — las de foto/video van sin colita, a
                          pedido del usuario, con las 4 esquinas parejas. */}
                      {!isMediaOnlyBubble && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute bottom-0 h-3 w-3",
                            message.direction === "outbound" ? "-right-[7px]" : "-left-[7px]",
                          )}
                          style={{
                            backgroundColor: message.direction === "outbound"
                              ? "var(--chat-bubble-outgoing)"
                              : "var(--chat-bubble-incoming)",
                            clipPath: message.direction === "outbound"
                              ? "polygon(0 0, 0 100%, 100% 100%)"
                              : "polygon(100% 0, 0 100%, 100% 100%)",
                          }}
                        />
                      )}
                      {/* Funcionalidad "Perfil": nombre (rol) flotando arriba
                          de la burbuja — posición absoluta (relativa a la
                          burbuja misma, ya "relative" de por sí) para que NO
                          afecte el ancho de la burbuja. Envolver la burbuja
                          en otro contenedor flex para esto (como se hizo
                          antes) rompía el cálculo del `max-w` porcentual y
                          dejaba un hueco vacío variable a la derecha de cada
                          burbuja — por eso va así, sin tocar la estructura
                          original de la burbuja. */}
                      {message.direction === "outbound" && messageSenderLabel && (
                        <p
                          className="absolute -top-4 left-0 h-4 overflow-hidden whitespace-nowrap text-xs font-semibold leading-4"
                          style={{ color: getProfileStyle(messageSenderLabel).color }}
                        >
                          {messageSenderLabel}
                        </p>
                      )}
                      {message.direction === "inbound" && (contactName || phoneNumber) && (
                        <p className="absolute -top-4 left-0 h-4 overflow-hidden whitespace-nowrap text-xs font-semibold leading-4 text-muted-foreground">
                          {contactName || phoneNumber}
                        </p>
                      )}
                      {message.repliedTo && (
                        <button
                          type="button"
                          onClick={() => scrollToMessage(message.repliedTo!.id)}
                          className="mb-2 block w-full rounded border-l-2 border-primary/60 bg-background/45 px-2 py-1.5 text-left hover:bg-background/70"
                        >
                          <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-primary">
                            <Reply className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">
                              {message.repliedTo.senderName ||
                                getMessageSenderLabel(message.repliedTo, contactName, phoneNumber)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {formatWhatsAppText(message.repliedTo.content)}
                          </span>
                        </button>
                      )}

                      {message.hasMedia && message.mediaData?.url ? (
                        <div className={cn(!isMediaOnlyBubble && "mb-2")}>
                          {message.messageType === "sticker" ? (
                            <img
                              src={message.mediaData.url}
                              alt="Sticker"
                              className="h-auto max-h-[150px] max-w-[150px]"
                            />
                          ) : message.mediaData.contentType?.startsWith(
                              "image/",
                            ) || message.messageType === "image" ? (
                            <img
                              src={message.mediaData.url}
                              alt="Media"
                              className={cn(
                                "h-auto max-h-96 max-w-full",
                                // Funcionalidad "Burbuja transparente": sin
                                // colita, la imagen queda con las 4 esquinas
                                // parejas (a pedido del usuario, las fotos no
                                // llevan colita, solo los mensajes de texto).
                                // El min-w/min-h + fondo es un resguardo: si
                                // la URL de la media (que WhatsApp vence
                                // pasadas unas horas) ya no carga, la burbuja
                                // no colapsa a 0×0 y arrastra con ella la
                                // hora/nombre flotantes (que quedarían
                                // "flotando" sueltos sobre el mensaje de
                                // arriba) — se queda con un tamaño razonable
                                // aunque la imagen no cargue.
                                isMediaOnlyBubble
                                  ? "block min-h-[140px] min-w-[200px] w-full rounded-2xl bg-[var(--chat-hover)]"
                                  : "rounded outline outline-1 [outline-color:var(--chat-media-outline)]",
                              )}
                            />
                          ) : message.mediaData.contentType?.startsWith(
                              "video/",
                            ) || message.messageType === "video" ? (
                            <video
                              src={message.mediaData.url}
                              controls
                              className={cn(
                                "h-auto max-h-96 max-w-full",
                                // Funcionalidad "Burbuja transparente": sin
                                // colita, la imagen queda con las 4 esquinas
                                // parejas (a pedido del usuario, las fotos no
                                // llevan colita, solo los mensajes de texto).
                                // El min-w/min-h + fondo es un resguardo: si
                                // la URL de la media (que WhatsApp vence
                                // pasadas unas horas) ya no carga, la burbuja
                                // no colapsa a 0×0 y arrastra con ella la
                                // hora/nombre flotantes (que quedarían
                                // "flotando" sueltos sobre el mensaje de
                                // arriba) — se queda con un tamaño razonable
                                // aunque la imagen no cargue.
                                isMediaOnlyBubble
                                  ? "block min-h-[140px] min-w-[200px] w-full rounded-2xl bg-[var(--chat-hover)]"
                                  : "rounded outline outline-1 [outline-color:var(--chat-media-outline)]",
                              )}
                            />
                          ) : message.mediaData.contentType?.startsWith(
                              "audio/",
                            ) || message.messageType === "audio" ? (
                            <audio
                              src={message.mediaData.url}
                              controls
                              className="w-full"
                            />
                          ) : (
                            <a
                              href={message.mediaData.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                "flex min-w-0 items-center gap-2 text-sm underline hover:opacity-80",
                                message.direction === "outbound"
                                  ? "text-primary"
                                  : "text-primary",
                              )}
                            >
                              <Paperclip className="h-4 w-4 flex-shrink-0" />
                              <span className="truncate">
                                {message.mediaData.filename ||
                                  message.filename ||
                                  "Download file"}
                              </span>
                            </a>
                          )}
                        </div>
                      ) : message.metadata?.mediaId && message.messageType ? (
                        <div className={cn(!isMediaOnlyBubble && "mb-2")}>
                          <MediaMessage
                            mediaId={message.metadata.mediaId}
                            phoneNumberId={message.phoneNumberId || phoneNumberId}
                            messageType={message.messageType}
                            caption={message.caption}
                            filename={message.filename}
                            isOutbound={message.direction === "outbound"}
                          />
                        </div>
                      ) : null}

                      {message.caption && (
                        <p className="text-sm break-words whitespace-pre-wrap mb-1">
                          {formatWhatsAppText(message.caption)}
                        </p>
                      )}

                      {displayMessageContent && (
                        <p className="text-sm break-words whitespace-pre-wrap">
                          {formatWhatsAppText(displayMessageContent)}
                        </p>
                      )}

                      {/* Funcionalidad "Burbuja transparente" de fotos/video:
                          sin fondo de color debajo, la hora/checks flotan
                          como una pastillita semitransparente encima de la
                          esquina de la imagen (como WhatsApp real), en vez de
                          quedar como texto suelto sobre el fondo del chat. */}
                      <div
                        className={cn(
                          "flex flex-wrap items-center justify-end gap-1.5",
                          isMediaOnlyBubble
                            ? "absolute bottom-1.5 right-1.5 rounded-full bg-black/45 px-1.5 py-0.5"
                            : "mt-1",
                        )}
                      >
                        <span className={cn(
                          "text-[11px] tabular-nums",
                          isMediaOnlyBubble ? "text-white" : "text-muted-foreground",
                        )}>
                          {formatMessageTime(message.createdAt)}
                        </span>

                        {message.direction === "outbound" && message.status && (
                          <>
                            {message.status === "failed" ? (
                              <XCircle className="h-3.5 w-3.5 text-red-500" />
                            ) : (
                              <MessageStatusChecks status={message.status} onMedia={isMediaOnlyBubble} />
                            )}
                          </>
                        )}
                      </div>

                      {message.direction === "outbound" &&
                        message.status === "failed" && (
                          <div className="mt-1">
                            <span className="text-[11px] text-red-500 flex items-center gap-1">
                              Not delivered
                            </span>
                          </div>
                        )}

                      {message.reactionEmoji && (
                        <div className="absolute -bottom-2 -right-2 bg-background rounded-full px-1.5 py-0.5 text-sm shadow-sm border">
                          {message.reactionEmoji}
                        </div>
                      )}
                    </div>
                    {/* Funcionalidad "Perfil": avatar afuera de la burbuja,
                        como hermano suyo en la misma fila, a una distancia
                        fija del borde de la fila (no del ancho de la
                        burbuja) — así queda alineado igual en todos los
                        mensajes, cortos o largos. `self-end` lo baja al
                        borde inferior de la fila aunque esta use
                        `items-start` para los demás elementos. */}
                    {message.direction === "outbound" && messageSenderLabel && (
                      <span
                        className="mb-0.5 flex size-8 flex-shrink-0 items-center justify-center self-end rounded-full text-xs font-bold text-white"
                        aria-hidden="true"
                        title={messageSenderLabel}
                        style={{ backgroundColor: getProfileStyle(messageSenderLabel).color }}
                      >
                        {getProfileStyle(messageSenderLabel).initial}
                      </span>
                    )}
                    {message.direction === "inbound" && (
                      <div className="mt-1 flex flex-shrink-0 items-center gap-0.5">
                        {canSendRegularMessage && (
                          <Button
                            type="button"
                            onClick={() => handleReplyToMessage(message)}
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground opacity-100 hover:bg-[var(--chat-hover)] sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="Reply to message"
                            title="Reply"
                          >
                            <Reply className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setReactionPickerPosition({
                              top: rect.bottom + 6,
                              left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)),
                            });
                            setReactionPickerMessageId(message.id);
                          }}
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground opacity-100 hover:bg-[var(--chat-hover)] sm:opacity-0 sm:group-hover:opacity-100"
                          aria-label="React to message"
                          title="React"
                        >
                          <Smile className="h-3.5 w-3.5" />
                        </Button>
                        {onToggleStarredMessage && (
                          <Button
                            type="button"
                            onClick={() => handleToggleStar(message)}
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "size-7 text-muted-foreground hover:bg-[var(--chat-hover)]",
                              isStarred ? "text-amber-400" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
                            )}
                            aria-label={isStarred ? "Unstar message" : "Star message"}
                            title={isStarred ? "Unstar message" : "Star message"}
                          >
                            <Star className={cn("h-3.5 w-3.5", isStarred && "fill-current")} />
                          </Button>
                        )}
                      </div>
                    )}

                    {reactionPickerMessageId === message.id && reactionPickerPosition && createPortal(
                      // Funcionalidad "Reaccionar a un mensaje": selector de
                      // emojis rápidos, dibujado con un portal (igual que el
                      // menú de clic derecho de cada chat en ConversationList)
                      // para que no lo recorte el scroll del historial.
                      <div
                        data-reaction-picker
                        role="menu"
                        aria-label="React to message"
                        style={{ position: "fixed", top: reactionPickerPosition.top, left: reactionPickerPosition.left }}
                        className="z-50 flex items-center gap-1 rounded-full border border-[var(--chat-border-strong)] bg-popover px-2 py-1.5 shadow-lg"
                      >
                        {QUICK_REACTION_EMOJIS.map((emoji) => {
                          // Tocar el mismo emoji que ya está puesto la quita
                          // (igual que mantener presionado y volver a tocar
                          // tu propia reacción en WhatsApp), en vez de
                          // reenviarla sin hacer nada.
                          const isActive = message.reactionEmoji === emoji;

                          return (
                            <button
                              key={emoji}
                              type="button"
                              role="menuitem"
                              onClick={() => handleSendReaction(message, isActive ? "" : emoji)}
                              className={cn(
                                "flex size-8 items-center justify-center rounded-full text-lg leading-none hover:bg-[var(--chat-hover)]",
                                isActive && "bg-primary/15 ring-1 ring-primary/50",
                              )}
                              aria-label={isActive ? `Remove ${emoji} reaction` : `React with ${emoji}`}
                              title={isActive ? "Remove reaction" : undefined}
                            >
                              {emoji}
                            </button>
                          );
                        })}
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-[var(--chat-border-strong)] bg-[var(--chat-toolbar)] safe-area-bottom">
        {canSendRegularMessage ? (
          <>
            {/* Funcionalidad "Quién está escribiendo": aviso informativo,
                solo mientras otro perfil tiene texto sin mandar en este
                chat — no restringe nada, cualquiera puede escribir igual. */}
            {otherPersonTyping && (
              <div className="flex items-center gap-2 border-b border-[var(--chat-border-strong)] bg-[var(--chat-header)] px-3 py-1.5 text-xs text-muted-foreground">
                <span
                  className="flex size-[18px] flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
                  style={{ backgroundColor: typingStyle.color }}
                >
                  {typingStyle.initial}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-semibold text-foreground">{presence.typingBy}</b>{" "}
                  <span className="font-semibold text-[var(--chat-presence)]">está escribiendo…</span>
                </span>
              </div>
            )}

            {replyingToMessage && (
              <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-3 py-2">
                <div className="mx-auto flex w-full max-w-[900px] items-center gap-2">
                  <Reply className="h-4 w-4 flex-shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-primary">
                      Replying to {getMessageSenderLabel(replyingToMessage, contactName, phoneNumber)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatWhatsAppText(getReplyPreviewContent(replyingToMessage))}
                    </p>
                  </div>
                  <Button
                    onClick={handleCancelReply}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 flex-shrink-0 text-muted-foreground"
                    aria-label="Cancel reply"
                    title="Cancel reply"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {selectedFile && (
              <div className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-3">
                <div className="mx-auto flex w-full max-w-[900px] items-start gap-3">
                  {filePreview ? (
                    <img
                      src={filePreview}
                      alt="Preview"
                      className="size-16 rounded object-cover outline outline-1 [outline-color:var(--chat-media-outline)]"
                    />
                  ) : (
                    <div className="flex size-16 items-center justify-center rounded bg-[var(--chat-hover)]">
                      <Paperclip className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <Button
                    onClick={handleRemoveFile}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 text-muted-foreground md:size-10"
                    aria-label="Remove selected file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <form
              onSubmit={handleSendMessage}
              className="mx-auto flex w-full max-w-[900px] items-end gap-1.5 px-2.5 py-2 sm:gap-2 sm:p-3"
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                variant="ghost"
                size="icon"
                className="size-11 text-muted-foreground hover:bg-[var(--chat-icon-hover)] md:size-10"
                aria-label="Upload file"
                title="Upload file"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
              <div className="relative" ref={emojiPickerRef}>
                <Button
                  type="button"
                  onClick={() => setShowEmojiPicker((open) => !open)}
                  disabled={sending}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-11 text-muted-foreground hover:bg-[var(--chat-icon-hover)] md:size-10",
                    showEmojiPicker && "bg-[var(--chat-icon-hover)] text-foreground",
                  )}
                  aria-haspopup="menu"
                  aria-expanded={showEmojiPicker}
                  aria-label="Insert emoji"
                  title="Insert emoji"
                >
                  <Smile className="h-5 w-5" />
                </Button>

                {showEmojiPicker && (
                  <div
                    role="menu"
                    aria-label="Emoji picker"
                    className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 max-h-72 w-72 overflow-y-auto rounded-lg border border-[var(--chat-border-strong)] bg-popover p-2 shadow-lg"
                  >
                    {EMOJI_CATEGORIES.map((category) => (
                      <div key={category.label} className="mb-2 last:mb-0">
                        <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {category.label}
                        </p>
                        <div className="grid grid-cols-8 gap-0.5">
                          {category.emojis.map((emoji, index) => (
                            <button
                              key={`${category.label}-${index}`}
                              type="button"
                              onClick={() => insertEmoji(emoji)}
                              className="flex size-8 items-center justify-center rounded text-lg hover:bg-[var(--chat-hover)]"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Input
                ref={messageInputRef}
                type="text"
                value={messageInput}
                onChange={(e) => {
                  const value = e.target.value;
                  setMessageInput(value);
                  // Funcionalidad "Quién está escribiendo": cada tecleo
                  // empuja el aviso para que lo vean los demás — puramente
                  // informativo, no hace falta pedir nada para escribir.
                  if (presenceEnabled && collabThreadKey && activeSenderName && value.trim()) {
                    postCollabAction(collabThreadKey, "typing", { profile: activeSenderName });
                  }
                }}
                placeholder="Type a message"
                // Nunca se deshabilita a propósito mientras se envía: los
                // envíos de texto son optimistas (burbuja instantánea,
                // compositor limpio), así que el usuario debería poder
                // seguir escribiendo y dándole Enter uno tras otro sin que
                // el campo se congele/pierda el foco a mitad del envío.
                disabled={false}
                aria-label="Message"
                className="h-11 min-w-0 flex-1 rounded-lg border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base focus-visible:ring-primary md:h-10 md:text-sm"
              />
              <Button
                type="submit"
                // Solo se condiciona a `sending` para subidas de archivo. Si
                // esto se quedara deshabilitado durante un envío de texto
                // plano, darle Enter para el siguiente mensaje no haría nada
                // en silencio — los navegadores rechazan el envío implícito
                // del formulario (Enter) cuando el único botón de envío está
                // deshabilitado, aunque hacer clic no sea la única forma en
                // que este formulario se envía.
                disabled={(sending && !!selectedFile) || (!messageInput.trim() && !selectedFile)}
                size="icon"
                className="size-11 rounded-full bg-primary hover:bg-[var(--primary-hover)] md:size-10"
                aria-label="Send message"
              >
                <Send className="h-5 w-5" />
              </Button>
            </form>
          </>
        ) : (
          // Funcionalidad "Selector de plantillas en el chat": a pedido del
          // usuario, acá solo queda el aviso — elegir la plantilla se
          // mudó al panel flotante que abre el botón nuevo en el header
          // (ver LayoutTemplate más arriba), en vez de ocupar todo este
          // espacio con el carrusel siempre visible.
          <div className="mx-auto w-full max-w-[900px] p-3">
            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--chat-warning-border)] bg-[var(--chat-warning-background)] px-3.5 py-3">
              <Clock className="mt-0.5 size-4 flex-shrink-0 text-[var(--chat-warning-foreground)]" />
              <p className="text-sm leading-relaxed text-[var(--chat-warning-foreground)]">
                {getDisabledInputMessage(messages)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
