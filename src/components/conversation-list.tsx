'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { format, isToday, isValid, isYesterday } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowLeft, Bell, BellOff, Check, CheckCheck, CheckSquare, ChevronDown, FileText, Image as ImageIcon, LayoutTemplate, ListChecks, LogOut, Mail, MailOpen, MapPin, Mic, MoreVertical, RefreshCw, Search, Settings, Square, SquarePen, Star, User, UserCog, Video, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInboxLiveUpdates } from '@/hooks/use-inbox-live-updates';
import { playReceivedMessageSound, playSentMessageSound } from '@/lib/notification-sounds';
import {
  CONVERSATIONS_QUERY_KEY,
  type Conversation,
  type ConversationThread,
  fetchConversations,
  filterConversationThreads,
  groupConversationsByPhoneNumber,
  loadStoredStringSet,
  parseTimestamp,
  saveStoredStringSet,
} from '@/lib/inbox-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { NewChatDialog } from '@/components/new-chat-dialog';
import { type StarredMessage } from '@/lib/starred-messages';
import { MOCK_ACCOUNT_PROFILES } from '@/lib/mock-profiles';
import { getMockZoneForThreadKey, MOCK_ZONE_OPTIONS } from '@/lib/mock-zones';

// Funcionalidad "Vista previa de media": en vez del texto feo que genera
// Kapso para el último mensaje cuando es una foto/video/audio/documento sin
// texto propio (ej. "Image attached (image_67e4dc70f560.jpeg) [Size: ...]
// URL: https://..."), la fila del chat muestra un ícono + una palabra corta
// ("Imagen", "Video", etc.) — igual que hace WhatsApp real. Si el mensaje sí
// tiene un caption/texto de verdad, ese se sigue mostrando tal cual (ver
// isGeneratedMediaPreviewText más abajo).
const MEDIA_PREVIEW_ICON: Partial<Record<string, typeof ImageIcon>> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
  sticker: ImageIcon,
};

const MEDIA_PREVIEW_LABEL: Partial<Record<string, string>> = {
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
  sticker: 'Sticker',
};

function isGeneratedMediaPreviewText(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/\bURL:\s*https?:\/\//i.test(trimmed)) return true;
  return /^(image|video|audio|document|sticker)\s+attached\b/i.test(trimmed);
}

function getAvatarInitials(contactName?: string, phoneNumber?: string): string {
  if (contactName) {
    const words = contactName.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return contactName.slice(0, 2).toUpperCase();
  }

  if (phoneNumber) {
    const digits = phoneNumber.replace(/\D/g, '');
    return digits.slice(-2);
  }

  return '??';
}

const NOTIFICATIONS_STORAGE_KEY = 'whatsapp-cloud-inbox-notifications-enabled';
// --- Funcionalidad "Archivar/Desarchivar": clave de storage para los chats
// archivados. Ver toggleThreadArchived, archivedThreadKeys y viewingArchived
// más abajo en este archivo.
const ARCHIVED_THREADS_STORAGE_KEY = 'whatsapp-cloud-inbox-archived-threads';
const THREAD_SEEN_COUNTS_STORAGE_KEY = 'whatsapp-cloud-inbox-thread-seen-counts';
// --- Funcionalidad "Marcar como no leído": clave de storage para los chats
// que el usuario marcó manualmente como no leídos desde el menú de clic
// derecho. Ver isThreadMarkedUnread, toggleThreadUnread, clearManuallyUnread
// y handleOpenThread más abajo.
const MANUALLY_UNREAD_THREADS_STORAGE_KEY = 'whatsapp-cloud-inbox-manually-unread-threads';

type NotificationPermissionState = NotificationPermission | 'unsupported';

type ThreadNotificationSnapshot = {
  lastActiveAt?: string;
  messagesCount?: number;
  lastMessageContent?: string;
  lastMessageDirection?: string;
};

function getThreadNotificationSnapshot(thread: ConversationThread): ThreadNotificationSnapshot {
  return {
    lastActiveAt: thread.lastActiveAt,
    messagesCount: thread.latestConversation.messagesCount,
    lastMessageContent: thread.lastMessage?.content,
    lastMessageDirection: thread.lastMessage?.direction,
  };
}

function shouldNotifyForThread(
  thread: ConversationThread,
  previousSnapshot: ThreadNotificationSnapshot | undefined,
): boolean {
  if (thread.lastMessage?.direction !== 'inbound') return false;
  if (!previousSnapshot) return true;

  const currentSnapshot = getThreadNotificationSnapshot(thread);
  const currentCount = currentSnapshot.messagesCount;
  const previousCount = previousSnapshot.messagesCount;

  if (
    typeof currentCount === 'number' &&
    typeof previousCount === 'number' &&
    currentCount > previousCount
  ) {
    return true;
  }

  if (parseTimestamp(currentSnapshot.lastActiveAt) > parseTimestamp(previousSnapshot.lastActiveAt)) {
    return true;
  }

  return (
    currentSnapshot.lastMessageContent !== previousSnapshot.lastMessageContent ||
    currentSnapshot.lastMessageDirection !== previousSnapshot.lastMessageDirection
  );
}

/** Total de mensajes en todas las conversaciones de Kapso agrupadas en este chat. */
function getThreadMessagesCount(thread: ConversationThread): number {
  return thread.conversations.reduce((sum, conversation) => sum + (conversation.messagesCount ?? 0), 0);
}

function loadThreadSeenCounts(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(THREAD_SEEN_COUNTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveThreadSeenCounts(counts: Record<string, number>) {
  try {
    window.localStorage.setItem(THREAD_SEEN_COUNTS_STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // Los conteos de no leídos siguen funcionando para esta sesión aunque el storage no esté disponible.
  }
}

/** Cuántos mensajes han llegado desde que este chat se abrió por última vez (0 si no hay ninguno, o si el último es saliente). */
function getThreadUnreadCount(thread: ConversationThread, seenCounts: Record<string, number>): number {
  if (thread.lastMessage?.direction !== 'inbound') return 0;

  const seen = seenCounts[thread.key];
  if (seen === undefined) return 0;

  return Math.max(0, getThreadMessagesCount(thread) - seen);
}

/**
 * Funcionalidad "Marcar como no leído" — si la fila debe mostrar *algún*
 * indicador de no leído: ya sea mensajes realmente no leídos, o una marca
 * manual de "Marcar como no leído" desde el menú de clic derecho. Esto NO
 * inventa una cantidad de mensajes — ver `getThreadUnreadCount` para el
 * número real. Una marca manual sin mensajes no leídos reales se muestra
 * como un punto en vez de un "1" inventado (ver el loop de renderizado).
 */
function isThreadMarkedUnread(
  thread: ConversationThread,
  seenCounts: Record<string, number>,
  manuallyUnreadThreadKeys: Set<string>,
): boolean {
  return getThreadUnreadCount(thread, seenCounts) > 0 || manuallyUnreadThreadKeys.has(thread.key);
}

/** Hora compacta para la fila de un chat: "14:32" si es hoy, "Yesterday" si fue ayer, o "Aug 20" más atrás. */
function formatThreadTimestamp(timestamp?: string): string {
  if (!timestamp) return '';

  try {
    const date = new Date(timestamp);
    if (!isValid(date)) return '';

    if (isToday(date)) return format(date, 'HH:mm');
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'MMM d');
  } catch {
    return '';
  }
}

type Props = {
  onSelectThread: (thread: ConversationThread) => void;
  selectedThreadKey?: string;
  isHidden?: boolean;
  /** Funcionalidad "Mensajes destacados": todos los mensajes con estrella,
   * de cualquier chat (vive en src/app/page.tsx, ver también
   * src/components/message-view.tsx donde se activa la estrella). Se usa
   * aquí solo para pintar el panel que los lista todos. */
  starredMessages?: StarredMessage[];
  /** Clic en un mensaje del panel de destacados — abre ese chat y le pide a
   * MessageView que salte hasta ese mensaje puntual. */
  onOpenStarredMessage?: (thread: ConversationThread, messageId: string) => void;
  /** Funcionalidad "Perfil": cuál de los MOCK_ACCOUNT_PROFILES está activo
   * ahorita — vive en src/app/page.tsx (no acá) porque MessageView también
   * lo necesita, para mostrar el nombre del "remitente" en los mensajes que
   * se envían (ver activeSenderName en message-view.tsx). */
  activeMockProfile?: string;
  onChangeActiveMockProfile?: (profile: string) => void;
  /** Funcionalidad "Nuevo chat": se dispara al validar el número en
   * NewChatDialog — abre la vista de chat con ese número (ver
   * pendingNewChatRecipient en src/app/page.tsx). */
  onOpenNewChat?: (phoneNumber: string, phoneNumberId: string) => void;
};

const EMPTY_STARRED_MESSAGES: StarredMessage[] = [];

export function ConversationList({
  onSelectThread,
  selectedThreadKey,
  isHidden = false,
  starredMessages = EMPTY_STARRED_MESSAGES,
  onOpenStarredMessage,
  activeMockProfile = MOCK_ACCOUNT_PROFILES[0],
  onChangeActiveMockProfile,
  onOpenNewChat,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  // Funcionalidad "Nuevo chat": ver new-chat-dialog.tsx.
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  // Pestañas "Todos" / "No leídos" del header de la lista (ver los botones y
  // el filtro más abajo en este archivo).
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('default');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  // Funcionalidad "Archivar/Desarchivar" — qué chats están archivados.
  const [archivedThreadKeys, setArchivedThreadKeys] = useState<Set<string>>(new Set());
  // Estado de la funcionalidad "Marcar como no leído" — qué chats fueron marcados manualmente.
  const [manuallyUnreadThreadKeys, setManuallyUnreadThreadKeys] = useState<Set<string>>(new Set());
  const [threadSeenCounts, setThreadSeenCounts] = useState<Record<string, number>>({});
  // Funcionalidad "Archivar/Desarchivar" — si estás viendo la bandeja normal
  // o la vista de chats archivados (se cambia con el botón "Archived" del
  // menú "⋮" y la flecha para volver).
  const [viewingArchived, setViewingArchived] = useState(false);
  const [openRowMenuKey, setOpenRowMenuKey] = useState<string | null>(null);
  const [rowMenuPosition, setRowMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  // --- Funcionalidad "Seleccionar chats": modo de selección múltiple para
  // aplicar acciones (leído/no leído, archivar) a varios chats de una vez.
  // Ver toggleSelectMode, toggleThreadSelectedForBulk y los handlers
  // handleBulk* más abajo.
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedThreadKeysForBulk, setSelectedThreadKeysForBulk] = useState<Set<string>>(new Set());
  // Funcionalidad "Mensajes destacados": si el panel que lista todos los
  // mensajes con estrella está abierto (ver el menú "⋮" y el render más abajo).
  const [isStarredPanelOpen, setIsStarredPanelOpen] = useState(false);
  // Funcionalidad "Perfil": menú de cuenta junto al título "WhatsApp" — por
  // ahora es un adelanto visual de cómo se va a ver una vez que exista el
  // login (todavía no hay sistema de autenticación en la app), así que
  // muestra datos de ejemplo y sus acciones no hacen nada real todavía.
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  // Funcionalidad "Números/Zonas": menú desplegable junto al título
  // "WhatsApp" — también un adelanto visual (ver mock-zones.ts), elegir una
  // opción solo cambia cuál se ve marcada, no filtra nada todavía.
  const [activeZone, setActiveZone] = useState<string>(MOCK_ZONE_OPTIONS[0]);
  const [isZoneMenuOpen, setIsZoneMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const zoneMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previousThreadSnapshotsRef = useRef<Map<string, ThreadNotificationSnapshot>>(new Map());
  const hasInitializedNotificationSnapshotsRef = useRef(false);
  const hasInitializedSeenCountsRef = useRef(false);
  // Funcionalidad "Sonido de mensajes": snapshot aparte del de notificaciones
  // de escritorio de arriba — el sonido no depende de si esas notificaciones
  // están activadas/permitidas, y sí debe sonar aunque el chat que recibió el
  // mensaje sea justo el que se está viendo (a diferencia de una notificación
  // del sistema, que ahí sería redundante).
  const previousSoundSnapshotsRef = useRef<Map<string, ThreadNotificationSnapshot>>(new Map());
  const hasInitializedSoundSnapshotsRef = useRef(false);

  useEffect(() => {
    setArchivedThreadKeys(loadStoredStringSet(ARCHIVED_THREADS_STORAGE_KEY));
    setManuallyUnreadThreadKeys(loadStoredStringSet(MANUALLY_UNREAD_THREADS_STORAGE_KEY));
    setThreadSeenCounts(loadThreadSeenCounts());
  }, []);

  const queryClient = useQueryClient();

  const {
    data: conversations = [],
    error,
    isPending,
    refetch,
  } = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: fetchConversations,
    // El SSE ya entrega mensajes nuevos al instante; este intervalo es solo
    // un respaldo para cuando esa conexión se cae. Se mantiene lento a
    // propósito para que el sondeo rutinario no compita con acciones reales
    // (como enviar un mensaje) por el presupuesto limitado de conexiones por
    // origen del navegador.
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  // En el instante en que el webhook registra un mensaje nuevo, actualiza la
  // vista previa de este chat directamente para que se refleje al instante
  // (sin esperar un round-trip fresco a la API de Kapso), y luego reconcilia
  // con un refetch real justo después.
  //
  // Funcionalidad "Sonido de mensajes": el de "enviado" para las respuestas
  // automáticas de la IA se dispara acá mismo (ver src/lib/auto-reply.ts,
  // único otro emisor de 'message.sent'; el envío manual desde el compositor
  // -MessageView- reproduce ese mismo sonido de forma directa, no vía este
  // evento). El de "recibido" NO se dispara desde este evento SSE — depende
  // de que el webhook de Kapso le esté llegando a este servidor (requiere el
  // túnel de cloudflared activo, ver el comentario grande en
  // src/app/api/webhooks/whatsapp/route.ts), así que un mensaje que solo se
  // entera por el sondeo normal (cada 10s) nunca sonaría. En vez de eso, más
  // abajo hay un efecto aparte que compara los `threads` en cada actualización
  // (venga de SSE o de sondeo) y suena para cualquier mensaje entrante nuevo,
  // sin depender de esta conexión.
  useInboxLiveUpdates((payload) => {
    if (payload.message) {
      const liveMessage = payload.message;
      queryClient.setQueryData<Conversation[]>(CONVERSATIONS_QUERY_KEY, (current = []) =>
        current.map((conversation) =>
          conversation.id === liveMessage.conversationId
            ? {
              ...conversation,
              lastActiveAt: liveMessage.createdAt,
              messagesCount: (conversation.messagesCount ?? 0) + 1,
              lastMessage: {
                content: liveMessage.content,
                direction: liveMessage.direction,
                type: 'text',
              },
            }
            : conversation,
        ),
      );
    }
    if (payload.reason === 'message.sent') {
      playSentMessageSound();
    }
    refetch();
  });

  const threads = useMemo(
    () => groupConversationsByPhoneNumber(conversations),
    [conversations],
  );

  // Funcionalidad "Números/Zonas": si hay una zona específica elegida (no
  // "Todos mis números"), un chat solo cuenta para lo de abajo cuando es de
  // esa zona — así, archivar un chat de Medellín solo lo mete a "Archived"
  // cuando estás viendo Medellín (o "Todos mis números"), no cuando estás en
  // otra zona.
  const archivedCount = useMemo(
    () => threads.filter((thread) =>
      archivedThreadKeys.has(thread.key)
      && (activeZone === 'Todos mis números' || getMockZoneForThreadKey(thread.key) === activeZone)
    ).length,
    [threads, archivedThreadKeys, activeZone],
  );

  /** Cuántos chats archivados tienen algo sin leer — igual que en WhatsApp
   * real, el numerito junto a "Archived" solo cuenta esto (no el total de
   * chats archivados), así que solo aparece cuando de verdad llega/queda
   * algo pendiente ahí adentro. */
  const archivedUnreadCount = useMemo(
    () => threads.filter((thread) =>
      archivedThreadKeys.has(thread.key)
      && isThreadMarkedUnread(thread, threadSeenCounts, manuallyUnreadThreadKeys)
      && (activeZone === 'Todos mis números' || getMockZoneForThreadKey(thread.key) === activeZone)
    ).length,
    [threads, archivedThreadKeys, threadSeenCounts, manuallyUnreadThreadKeys, activeZone],
  );

  const filteredThreads = useMemo(() => {
    const searchMatched = filterConversationThreads(threads, 'all', searchQuery);

    return searchMatched.filter((thread) => {
      // Funcionalidad "Números/Zonas": si hay una zona específica elegida
      // (no "Todos mis números"), solo se muestran los chats de esa zona.
      if (activeZone !== 'Todos mis números' && getMockZoneForThreadKey(thread.key) !== activeZone) {
        return false;
      }
      if (viewingArchived) {
        return archivedThreadKeys.has(thread.key);
      }
      if (archivedThreadKeys.has(thread.key)) return false;
      if (unreadOnly && !isThreadMarkedUnread(thread, threadSeenCounts, manuallyUnreadThreadKeys)) return false;
      return true;
    });
  }, [threads, searchQuery, viewingArchived, archivedThreadKeys, unreadOnly, threadSeenCounts, manuallyUnreadThreadKeys, activeZone]);

  /** Funcionalidad "Números/Zonas": si la zona elegida tiene al menos un
   * número en la bandeja normal (sin contar archivados) — para distinguir
   * el mensaje vacío "no hay números en esta zona" del de "no leídos" (si la
   * zona sí tiene números pero ninguno sin leer, no tendría sentido decir
   * que la zona está vacía). */
  const activeZoneHasThreads = useMemo(
    () => activeZone === 'Todos mis números' || threads.some((thread) =>
      !archivedThreadKeys.has(thread.key) && getMockZoneForThreadKey(thread.key) === activeZone
    ),
    [threads, archivedThreadKeys, activeZone],
  );

  // Siembra la base de "visto": en la primerísima carga, trata cada chat que
  // ya está en Kapso como ya leído (para que el historial existente no
  // muestre de golpe insignias de no leído). Cualquier clave de chat que
  // aparezca por primera vez *después* de ese punto es una conversación
  // genuinamente nueva, así que empieza totalmente sin leer.
  useEffect(() => {
    if (threads.length === 0) return;

    const isFirstRun = !hasInitializedSeenCountsRef.current;
    hasInitializedSeenCountsRef.current = true;

    setThreadSeenCounts((current) => {
      const next = { ...current };
      let changed = false;
      threads.forEach((thread) => {
        if (thread.key in next) return;
        next[thread.key] = isFirstRun ? getThreadMessagesCount(thread) : 0;
        changed = true;
      });
      if (changed) saveThreadSeenCounts(next);
      return changed ? next : current;
    });
  }, [threads]);

  // Mantiene el conteo de "visto" del chat abierto actual sincronizado a
  // medida que llegan mensajes nuevos vía sondeo, para que su insignia nunca
  // se encienda mientras estás dentro.
  useEffect(() => {
    if (!selectedThreadKey) return;
    const activeThread = threads.find((thread) => thread.key === selectedThreadKey);
    if (!activeThread) return;

    const liveCount = getThreadMessagesCount(activeThread);
    setThreadSeenCounts((current) => {
      if (current[activeThread.key] === liveCount) return current;
      const next = { ...current, [activeThread.key]: liveCount };
      saveThreadSeenCounts(next);
      return next;
    });
  }, [threads, selectedThreadKey]);

  const markThreadSeen = (thread: ConversationThread) => {
    setThreadSeenCounts((current) => {
      const next = { ...current, [thread.key]: getThreadMessagesCount(thread) };
      saveThreadSeenCounts(next);
      return next;
    });
  };

  /** Funcionalidad "Archivar/Desarchivar" — activa/desactiva el archivado de un chat. */
  const toggleThreadArchived = (thread: ConversationThread) => {
    setArchivedThreadKeys((current) => {
      const next = new Set(current);
      if (next.has(thread.key)) {
        next.delete(thread.key);
      } else {
        next.add(thread.key);
      }
      saveStoredStringSet(ARCHIVED_THREADS_STORAGE_KEY, next);
      return next;
    });
  };

  // --- Funcionalidad "Marcar como no leído": las tres funciones de abajo
  // (clearManuallyUnread, toggleThreadUnread, handleOpenThread), más
  // isThreadMarkedUnread más arriba y la constante
  // MANUALLY_UNREAD_THREADS_STORAGE_KEY al inicio del archivo, son todas
  // parte de esta misma funcionalidad.
  const clearManuallyUnread = (thread: ConversationThread) => {
    setManuallyUnreadThreadKeys((current) => {
      if (!current.has(thread.key)) return current;
      const next = new Set(current);
      next.delete(thread.key);
      saveStoredStringSet(MANUALLY_UNREAD_THREADS_STORAGE_KEY, next);
      return next;
    });
  };

  /** Activa/desactiva la acción "Marcar como no leído/leído" del menú de la fila. */
  const toggleThreadUnread = (thread: ConversationThread) => {
    const isCurrentlyUnread = isThreadMarkedUnread(thread, threadSeenCounts, manuallyUnreadThreadKeys);

    if (isCurrentlyUnread) {
      clearManuallyUnread(thread);
      markThreadSeen(thread);
      return;
    }

    setManuallyUnreadThreadKeys((current) => {
      const next = new Set(current);
      next.add(thread.key);
      saveStoredStringSet(MANUALLY_UNREAD_THREADS_STORAGE_KEY, next);
      return next;
    });
  };

  /** Abrir un chat siempre cuenta como leerlo, aunque se haya marcado manualmente como no leído. */
  const handleOpenThread = (thread: ConversationThread) => {
    onSelectThread(thread);
    markThreadSeen(thread);
    clearManuallyUnread(thread);
  };

  /** Funcionalidad "Marcar todos como leídos" — botón del menú "⋮". */
  const handleMarkAllAsRead = () => {
    setThreadSeenCounts((current) => {
      const next = { ...current };
      threads.forEach((thread) => {
        next[thread.key] = getThreadMessagesCount(thread);
      });
      saveThreadSeenCounts(next);
      return next;
    });

    setManuallyUnreadThreadKeys((current) => {
      if (current.size === 0) return current;
      const next = new Set<string>();
      saveStoredStringSet(MANUALLY_UNREAD_THREADS_STORAGE_KEY, next);
      return next;
    });
  };

  // --- Funcionalidad "Seleccionar chats": las funciones de abajo, más el
  // estado isSelectMode/selectedThreadKeysForBulk más arriba, son todas
  // parte de esta misma funcionalidad. Se activa desde el menú "⋮".
  const toggleSelectMode = () => {
    setIsSelectMode((current) => !current);
    setSelectedThreadKeysForBulk(new Set());
  };

  const toggleThreadSelectedForBulk = (thread: ConversationThread) => {
    setSelectedThreadKeysForBulk((current) => {
      const next = new Set(current);
      if (next.has(thread.key)) {
        next.delete(thread.key);
      } else {
        next.add(thread.key);
      }
      return next;
    });
  };

  /** Marca como leídos todos los chats seleccionados y sale del modo selección. */
  const handleBulkMarkRead = () => {
    setThreadSeenCounts((current) => {
      const next = { ...current };
      threads.forEach((thread) => {
        if (selectedThreadKeysForBulk.has(thread.key)) {
          next[thread.key] = getThreadMessagesCount(thread);
        }
      });
      saveThreadSeenCounts(next);
      return next;
    });
    setManuallyUnreadThreadKeys((current) => {
      const next = new Set(current);
      selectedThreadKeysForBulk.forEach((key) => next.delete(key));
      saveStoredStringSet(MANUALLY_UNREAD_THREADS_STORAGE_KEY, next);
      return next;
    });
    toggleSelectMode();
  };

  /** Marca como no leídos todos los chats seleccionados y sale del modo selección. */
  const handleBulkMarkUnread = () => {
    setManuallyUnreadThreadKeys((current) => {
      const next = new Set(current);
      selectedThreadKeysForBulk.forEach((key) => next.add(key));
      saveStoredStringSet(MANUALLY_UNREAD_THREADS_STORAGE_KEY, next);
      return next;
    });
    toggleSelectMode();
  };

  /** Archiva (o desarchiva, si se está viendo la lista de archivados) todos los chats seleccionados y sale del modo selección. */
  const handleBulkToggleArchive = () => {
    setArchivedThreadKeys((current) => {
      const next = new Set(current);
      selectedThreadKeysForBulk.forEach((key) => {
        if (viewingArchived) {
          next.delete(key);
        } else {
          next.add(key);
        }
      });
      saveStoredStringSet(ARCHIVED_THREADS_STORAGE_KEY, next);
      return next;
    });
    toggleSelectMode();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const persistNotificationsEnabled = (enabled: boolean) => {
    setNotificationsEnabled(enabled);

    try {
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, String(enabled));
    } catch {
      // Las notificaciones siguen funcionando para esta sesión aunque el storage no esté disponible.
    }
  };

  const handleNotificationsClick = async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      persistNotificationsEnabled(false);
      return;
    }

    if (notificationPermission === 'unsupported') return;

    if (Notification.permission === 'granted') {
      persistNotificationsEnabled(!notificationsEnabled);
      setNotificationPermission('granted');
      return;
    }

    if (Notification.permission === 'denied') {
      setNotificationPermission('denied');
      persistNotificationsEnabled(false);
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    persistNotificationsEnabled(permission === 'granted');
  };

  useEffect(() => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      setNotificationsEnabled(false);
      return;
    }

    setNotificationPermission(Notification.permission);

    try {
      setNotificationsEnabled(
        window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) === 'true' &&
        Notification.permission === 'granted',
      );
    } catch {
      setNotificationsEnabled(false);
    }
  }, []);

  useEffect(() => {
    const currentSnapshots = new Map(
      threads.map((thread) => [thread.key, getThreadNotificationSnapshot(thread)]),
    );

    if (!hasInitializedNotificationSnapshotsRef.current) {
      previousThreadSnapshotsRef.current = currentSnapshots;
      hasInitializedNotificationSnapshotsRef.current = true;
      return;
    }

    if (notificationsEnabled && notificationPermission === 'granted') {
      threads.forEach((thread) => {
        if (
          document.visibilityState === 'visible' &&
          selectedThreadKey === thread.key
        ) {
          return;
        }

        if (!shouldNotifyForThread(thread, previousThreadSnapshotsRef.current.get(thread.key))) {
          return;
        }

        const title = thread.contactName || thread.phoneNumber || 'New WhatsApp message';
        const body = thread.lastMessage?.content || 'New message received';
        const notification = new Notification(title, {
          body,
          tag: `whatsapp-inbox:${thread.key}`,
        });

        notification.onclick = () => {
          window.focus();
          onSelectThread(thread);
          notification.close();
        };
      });
    }

    previousThreadSnapshotsRef.current = currentSnapshots;
  }, [notificationPermission, notificationsEnabled, onSelectThread, selectedThreadKey, threads]);

  // Funcionalidad "Sonido de mensajes": reusa la misma comparación de
  // snapshots que las notificaciones de escritorio (arriba) para detectar un
  // mensaje entrante nuevo en cualquier chat, pero en su propio efecto — así
  // suena tanto si el aviso llegó por SSE como si recién se enteró en el
  // siguiente sondeo normal (cada 10s), y sin las excepciones que sí tienen
  // sentido para una notificación del sistema (no depende de permisos/del
  // interruptor de notificaciones, y sí suena aunque el chat sea el que se
  // está viendo en este momento).
  useEffect(() => {
    const currentSnapshots = new Map(
      threads.map((thread) => [thread.key, getThreadNotificationSnapshot(thread)]),
    );

    if (!hasInitializedSoundSnapshotsRef.current) {
      previousSoundSnapshotsRef.current = currentSnapshots;
      hasInitializedSoundSnapshotsRef.current = true;
      return;
    }

    const hasNewInboundMessage = threads.some((thread) =>
      shouldNotifyForThread(thread, previousSoundSnapshotsRef.current.get(thread.key)),
    );

    previousSoundSnapshotsRef.current = currentSnapshots;

    if (hasNewInboundMessage) {
      playReceivedMessageSound();
    }
  }, [threads]);

  useEffect(() => {
    if (!openRowMenuKey) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('[data-row-menu]')) {
        setOpenRowMenuKey(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenRowMenuKey(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openRowMenuKey]);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsProfileMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!isZoneMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!zoneMenuRef.current?.contains(event.target as Node)) {
        setIsZoneMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsZoneMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isZoneMenuOpen]);

  useEffect(() => {
    if (!isOverflowMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!overflowMenuRef.current?.contains(event.target as Node)) {
        setIsOverflowMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOverflowMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOverflowMenuOpen]);

  const notificationsActive = notificationsEnabled && notificationPermission === 'granted';
  const notificationsButtonTitle =
    notificationPermission === 'unsupported'
      ? 'Notifications are not supported'
      : notificationPermission === 'denied'
        ? 'Notifications are blocked in browser settings'
        : notificationsActive
          ? 'Disable inbox notifications'
          : 'Enable inbox notifications';

  if (isPending) {
    return (
      <div className={cn(
        "flex min-h-0 w-full min-w-0 flex-col border-[var(--chat-border-strong)] bg-[var(--chat-surface)] md:w-[22rem] md:flex-none md:border-r lg:w-[24rem] xl:w-[26rem]",
        isHidden && "hidden md:flex"
      )}>
        <div className="chat-header-on-brand border-b border-[var(--chat-border-strong)] bg-[var(--chat-header)] px-3 py-3 safe-area-top">
          <div className="mb-3 flex items-center justify-between pt-1">
            <Skeleton className="h-6 w-20" />
            <div className="flex items-center gap-2">
              <Skeleton className="size-8" />
              <Skeleton className="size-8" />
              <Skeleton className="size-8" />
            </div>
          </div>
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="mt-2 flex gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
        <div className="flex-1 space-y-2 overflow-hidden p-3">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex gap-3 py-2">
              <Skeleton className="size-9 flex-shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      // A pedido del usuario ("todas las esquinas redondeadas"), en
      // escritorio este panel flota como tarjeta aparte (esquinas
      // redondeadas + borde propio, ver el gap/padding en src/app/page.tsx)
      // en vez de compartir un borde recto con el panel del chat.
      "flex min-h-0 w-full min-w-0 flex-col border-[var(--chat-border-strong)] bg-[var(--chat-surface)] md:w-[22rem] md:flex-none md:overflow-hidden md:rounded-2xl md:border lg:w-[24rem] xl:w-[26rem]",
      isHidden && "hidden md:flex"
    )}>
      <div className="chat-header-on-brand border-b border-[var(--chat-border-strong)] bg-[var(--chat-header)] px-3 py-3 safe-area-top">
        {isSelectMode ? (
          // Funcionalidad "Seleccionar chats": esta barra reemplaza solo el
          // título/iconos de arriba mientras dura la selección múltiple — el
          // buscador y las pestañas Todos/No leídos de más abajo se quedan
          // igual, para que no se sienta como si esto llevara a otra
          // pantalla distinta.
          <div className="mb-3 flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={toggleSelectMode}
                variant="ghost"
                size="icon"
                className="size-8 rounded-full text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground"
                aria-label="Cancel selection"
                title="Cancel selection"
              >
                <X className="size-4" />
              </Button>
              <span className="text-sm font-semibold text-foreground">
                {selectedThreadKeysForBulk.size} selected
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                onClick={handleBulkMarkRead}
                disabled={selectedThreadKeysForBulk.size === 0}
                variant="ghost"
                size="icon"
                className="size-8 rounded-md text-muted-foreground hover:bg-[var(--chat-icon-hover)] hover:text-foreground disabled:opacity-40"
                aria-label="Mark selected chats as read"
                title="Mark as read"
              >
                <MailOpen className="size-4" />
              </Button>
              <Button
                type="button"
                onClick={handleBulkMarkUnread}
                disabled={selectedThreadKeysForBulk.size === 0}
                variant="ghost"
                size="icon"
                className="size-8 rounded-md text-muted-foreground hover:bg-[var(--chat-icon-hover)] hover:text-foreground disabled:opacity-40"
                aria-label="Mark selected chats as unread"
                title="Mark as unread"
              >
                <Mail className="size-4" />
              </Button>
              <Button
                type="button"
                onClick={handleBulkToggleArchive}
                disabled={selectedThreadKeysForBulk.size === 0}
                variant="ghost"
                size="icon"
                className="size-8 rounded-md text-muted-foreground hover:bg-[var(--chat-icon-hover)] hover:text-foreground disabled:opacity-40"
                aria-label={viewingArchived ? "Unarchive selected chats" : "Archive selected chats"}
                title={viewingArchived ? "Unarchive" : "Archive"}
              >
                {viewingArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2 pt-1">
            {/* Funcionalidad "Números/Zonas": adelanto visual de un selector
                para agrupar los números conectados (por ciudad, externos,
                etc.) — igual que el menú de perfil, todavía no filtra ni
                cambia nada real, solo marca cuál opción quedó elegida. Ocupa
                el lugar donde antes iba el letrero fijo "WhatsApp". */}
            <div className="relative" ref={zoneMenuRef}>
              <button
                type="button"
                onClick={() => setIsZoneMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isZoneMenuOpen}
                className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-3 text-xs font-medium text-foreground hover:bg-[var(--chat-hover)]"
              >
                <span className="size-2 flex-shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                <span className="max-w-28 truncate">{activeZone}</span>
                <ChevronDown className="size-3.5 flex-shrink-0 text-muted-foreground" />
              </button>

              {isZoneMenuOpen && (
                <div
                  role="menu"
                  aria-label="Números y zonas"
                  className="absolute left-0 top-[calc(100%+0.25rem)] z-50 w-48 rounded-xl border border-[var(--chat-border-strong)] bg-popover p-1 text-sm text-popover-foreground shadow-lg"
                >
                  {MOCK_ZONE_OPTIONS.map((zone) => {
                    const isActive = zone === activeZone;

                    return (
                      <button
                        key={zone}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => {
                          setActiveZone(zone);
                          setIsZoneMenuOpen(false);
                        }}
                        className={cn(
                          "flex h-9 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs font-medium hover:bg-[var(--chat-hover)]",
                          isActive ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <span className="truncate">{zone}</span>
                        {isActive && <Check className="size-3.5 flex-shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="ml-auto flex items-center gap-1">
              {/* Funcionalidad "Nuevo chat": arrancar una conversación con un
                  número que todavía no está en la lista (ver
                  new-chat-dialog.tsx) — el primer mensaje siempre tiene que
                  ser una plantilla, WhatsApp lo exige así. */}
              <Button
                type="button"
                onClick={() => setIsNewChatOpen(true)}
                variant="ghost"
                size="icon"
                className="size-10 rounded-full text-muted-foreground hover:bg-[var(--chat-icon-hover)] hover:text-foreground"
                aria-label="Nuevo chat"
                title="Nuevo chat"
              >
                <SquarePen className="size-4" />
              </Button>

              {/* Funcionalidad "Perfil": adelanto visual de un menú de cuenta,
                  antes de que exista login de verdad — por ahora muestra datos
                  de ejemplo y "Cerrar sesión" no hace nada real todavía. */}
              <div className="relative" ref={profileMenuRef}>
              <Button
                type="button"
                onClick={() => setIsProfileMenuOpen((open) => !open)}
                variant="ghost"
                size="icon"
                className="size-10 rounded-full text-muted-foreground hover:bg-[var(--chat-icon-hover)] hover:text-foreground"
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
                aria-label="Account"
                title="Account"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-[var(--chat-avatar)] text-[var(--chat-avatar-foreground)]">
                  <User className="size-4" />
                </span>
              </Button>

              {isProfileMenuOpen && (
                <div
                  role="menu"
                  aria-label="Account"
                  className="absolute right-0 top-[calc(100%+0.25rem)] z-50 w-56 rounded-xl border border-[var(--chat-border-strong)] bg-popover p-1 text-sm text-popover-foreground shadow-lg"
                >
                  <div className="flex items-center gap-2.5 px-2 py-2.5">
                    <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--chat-avatar)] text-[var(--chat-avatar-foreground)]">
                      <User className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">Usuario</p>
                      <p className="truncate text-xs text-muted-foreground">Perfil: {activeMockProfile}</p>
                    </div>
                  </div>

                  <div className="my-1 h-px bg-[var(--chat-border-strong)]" />

                  {/* Funcionalidad "Perfil": estos "perfiles" (Administrador,
                      Secretaria, etc.) son solo un adelanto visual de los
                      roles que vendrán con el login real — elegir uno acá
                      solo cambia cuál se ve marcado, no hace nada más
                      todavía (no hay sesión ni permisos reales que cambiar). */}
                  <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Perfiles
                  </p>
                  {MOCK_ACCOUNT_PROFILES.map((role) => {
                    const isActive = role === activeMockProfile;

                    return (
                      <button
                        key={role}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => {
                          onChangeActiveMockProfile?.(role);
                          setIsProfileMenuOpen(false);
                        }}
                        className={cn(
                          "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium hover:bg-[var(--chat-hover)]",
                          isActive ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <UserCog className="size-3.5" />
                        <span className="flex-1 truncate">{role}</span>
                        {isActive && <Check className="size-3.5 text-primary" />}
                      </button>
                    );
                  })}

                  <div className="my-1 h-px bg-[var(--chat-border-strong)]" />

                  {/* Funcionalidad "Perfil": botón habilitado (ya no
                      deshabilitado/grisado), pero como todavía no existe una
                      sesión real que cerrar, por ahora solo cierra el menú —
                      no hace ningún cambio real de sesión. */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setIsProfileMenuOpen(false)}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium text-foreground hover:bg-[var(--chat-hover)]"
                  >
                    <LogOut className="size-3.5" />
                    Cerrar sesión
                  </button>
                </div>
              )}
              </div>
            </div>
          </div>
        )}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
          <Input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search phone numbers..."
            aria-label="Search phone numbers"
            // El fondo se queda como antes (oscuro, vía el dark:bg-input/30
            // del componente Input base) — solo el texto escrito/placeholder
            // reciben un color dark: explícito, ya que text-neutral-900 solo
            // era texto oscuro sobre ese fondo oscuro e ilegible.
            className="h-9 rounded-md border-transparent bg-white pl-9 text-sm text-neutral-900 shadow-none placeholder:text-neutral-500 focus-visible:ring-1 focus-visible:ring-[var(--chat-header)] dark:text-white dark:placeholder:text-white/50"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          {/* Pestañas "Todos" / "No leídos" — controlan el filtro `unreadOnly`
              (estado más arriba en este mismo archivo, y usado en el filtro
              `filteredThreads` unas líneas abajo del estado). */}
          {!viewingArchived && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUnreadOnly(false)}
                className={cn(
                  "h-8 rounded-full border px-3.5 text-xs font-semibold",
                  !unreadOnly
                    ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/25"
                    : "border-[var(--chat-border-strong)] bg-transparent font-medium text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground",
                )}
                aria-pressed={!unreadOnly}
              >
                Todos
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUnreadOnly(true)}
                className={cn(
                  "h-8 rounded-full border px-3.5 text-xs font-semibold",
                  unreadOnly
                    ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/25"
                    : "border-[var(--chat-border-strong)] bg-transparent font-medium text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground",
                )}
                aria-pressed={unreadOnly}
              >
                No leídos
              </Button>
            </>
          )}

          {/* Funcionalidad "Archivar/Desarchivar": flecha para volver a la
              bandeja normal (cuando viewingArchived es true) vs. el botón
              "Archived" del menú "⋮" para entrar a esa vista (cuando es false). */}
          {viewingArchived ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setViewingArchived(false)}
                className="size-8 rounded-full text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground"
                aria-label="Back to inbox"
                title="Back to inbox"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <span className="text-sm font-semibold text-foreground">Archived</span>
            </>
          ) : (
            <div className="relative ml-auto" ref={overflowMenuRef}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsOverflowMenuOpen((open) => !open)}
                className="size-8 rounded-full text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground"
                aria-haspopup="menu"
                aria-expanded={isOverflowMenuOpen}
                aria-label="More options"
              >
                <MoreVertical className="size-4" />
              </Button>

              {isOverflowMenuOpen && (
                <div
                  role="menu"
                  aria-label="More options"
                  className="absolute right-0 top-[calc(100%+0.25rem)] z-50 w-52 rounded-xl border border-[var(--chat-border-strong)] bg-popover p-1 text-sm text-popover-foreground shadow-lg"
                >
                  {/* Funcionalidad "Mensajes destacados": abre el panel con todos los mensajes con estrella */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsStarredPanelOpen(true);
                      setIsOverflowMenuOpen(false);
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium text-foreground hover:bg-[var(--chat-hover)]"
                  >
                    <Star className="size-3.5" />
                    Mensajes destacados
                  </button>

                  {/* Funcionalidad "Seleccionar chats": entra al modo de selección múltiple */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      toggleSelectMode();
                      setIsOverflowMenuOpen(false);
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium text-foreground hover:bg-[var(--chat-hover)]"
                  >
                    <ListChecks className="size-3.5" />
                    Seleccionar chats
                  </button>

                  {/* Funcionalidad "Marcar todos como leídos" */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleMarkAllAsRead();
                      setIsOverflowMenuOpen(false);
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium text-foreground hover:bg-[var(--chat-hover)]"
                  >
                    <CheckCheck className="size-3.5" />
                    Marcar todos como leídos
                  </button>

                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Funcionalidad "Archivar/Desarchivar": antes esto era una opción
          escondida en el menú "⋮" — ahora, como en la app real de WhatsApp,
          es una fila fija justo arriba de la lista de chats. Solo se muestra
          en la bandeja normal (no dentro de selección múltiple, destacados,
          o ya estando dentro de la vista de archivados) y, también igual que
          en WhatsApp real, solo si hay al menos un chat archivado — si no
          hay ninguno, la fila desaparece por completo. */}
      {!viewingArchived && !isSelectMode && !isStarredPanelOpen && archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setViewingArchived(true)}
          className="flex w-full flex-shrink-0 items-center gap-3 border-b border-[var(--chat-border)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--chat-hover)]"
        >
          <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--chat-avatar)] text-[var(--chat-avatar-foreground)]">
            <Archive className="size-4" />
          </span>
          <span className="flex-1 text-sm font-medium text-foreground">Archived</span>
          {archivedUnreadCount > 0 && (
            <span className="text-xs text-muted-foreground">{archivedUnreadCount}</span>
          )}
        </button>
      )}

      {isStarredPanelOpen && (
        // Funcionalidad "Mensajes destacados": mini-cabecera del panel, con
        // botón para volver a la bandeja normal.
        <div className="flex items-center gap-2 border-b border-[var(--chat-border-strong)] bg-[var(--chat-header)] px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsStarredPanelOpen(false)}
            className="size-8 rounded-full text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground"
            aria-label="Back to inbox"
            title="Back to inbox"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="text-sm font-semibold text-foreground">Mensajes destacados</span>
        </div>
      )}

      <ScrollArea className="h-0 flex-1 overflow-hidden overscroll-contain">
        {isStarredPanelOpen ? (
          // Funcionalidad "Mensajes destacados": lista de todos los mensajes
          // con estrella, de cualquier chat, ordenados del más reciente al
          // más viejo. Un clic abre ese chat (ver onOpenStarredMessage en
          // src/app/page.tsx) y le pide a MessageView que salte a ese mensaje.
          starredMessages.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">No starred messages yet</div>
          ) : (
            <div className="w-full overflow-hidden">
              {[...starredMessages]
                .sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt))
                .map((item) => {
                  const thread = threads.find((t) => t.key === item.threadKey);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!thread}
                      onClick={() => thread && onOpenStarredMessage?.(thread, item.id)}
                      className="flex w-full items-start gap-3 border-b border-[var(--chat-border)] px-3 py-2 text-left transition-colors hover:bg-[var(--chat-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Avatar className="mt-0.5 size-9 flex-shrink-0">
                        <AvatarFallback className="bg-[var(--chat-avatar)] text-xs font-semibold text-[var(--chat-avatar-foreground)]">
                          {getAvatarInitials(item.contactName, item.phoneNumber)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-semibold leading-5 text-foreground">
                          {item.contactName || item.phoneNumber || 'Unknown phone number'}
                        </p>
                        <p className="mt-1 truncate text-xs leading-4 text-muted-foreground">
                          {item.direction === 'outbound' ? 'You: ' : ''}
                          {item.content}
                        </p>
                      </div>
                      <span className="mt-0.5 flex-shrink-0 text-[11px] leading-4 text-muted-foreground">
                        {formatThreadTimestamp(item.createdAt)}
                      </span>
                    </button>
                  );
                })}
            </div>
          )
        ) : error ? (
          <div className="p-4 text-center text-sm text-destructive">
            Failed to load conversations
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {searchQuery
              ? 'No phone numbers found'
              : viewingArchived
                ? 'No archived chats'
                // Funcionalidad "Números/Zonas": si la zona elegida no tiene
                // ningún número (ni siquiera leídos), se avisa eso en vez de
                // "no leídos" — pero si sí tiene números y son solo los no
                // leídos los que faltan, se deja el mensaje de "No leídos".
                : !activeZoneHasThreads
                  ? `No hay números en ${activeZone}`
                  : unreadOnly
                    ? 'No unread chats'
                    : 'No conversations found'}
          </div>
        ) : (
          <div className="w-full overflow-hidden">
            {filteredThreads.map((thread) => {
              const isArchived = archivedThreadKeys.has(thread.key);
              const unreadCount = getThreadUnreadCount(thread, threadSeenCounts);
              const isMarkedUnread = isThreadMarkedUnread(thread, threadSeenCounts, manuallyUnreadThreadKeys);

              // Funcionalidad "Seleccionar chats": esta fila está marcada en el modo de selección múltiple.
              const isSelectedForBulk = selectedThreadKeysForBulk.has(thread.key);

              // Funcionalidad "Números/Zonas": de qué zona de ejemplo es este
              // número, para la píldora junto a la hora (ver mock-zones.ts).
              const zone = getMockZoneForThreadKey(thread.key);

              return (
                <div
                  key={thread.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => (isSelectMode ? toggleThreadSelectedForBulk(thread) : handleOpenThread(thread))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (isSelectMode) {
                      toggleThreadSelectedForBulk(thread);
                    } else {
                      handleOpenThread(thread);
                    }
                  }}
                  onContextMenu={(e) => {
                    if (isSelectMode) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setRowMenuPosition({ top: e.clientY, right: window.innerWidth - e.clientX });
                    setOpenRowMenuKey(thread.key);
                  }}
                  className={cn(
                    'relative min-h-[68px] w-full cursor-pointer touch-manipulation overflow-hidden border-b border-[var(--chat-border)] px-3 py-2 text-left transition-colors hover:bg-[var(--chat-hover)]',
                    selectedThreadKey === thread.key && 'bg-[var(--chat-hover)]',
                    isSelectedForBulk && 'bg-primary/10'
                  )}
                >
                  <div className="flex items-start gap-3 overflow-hidden">
                    {isSelectMode ? (
                      // Funcionalidad "Seleccionar chats": checkbox en vez del avatar mientras dura la selección.
                      <span
                        className={cn(
                          'mt-0.5 flex size-9 flex-shrink-0 items-center justify-center rounded-full border-2',
                          isSelectedForBulk
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-[var(--chat-border-strong)] text-transparent',
                        )}
                        aria-hidden="true"
                      >
                        {isSelectedForBulk ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                      </span>
                    ) : (
                      <Avatar className="mt-0.5 size-9 flex-shrink-0">
                        <AvatarFallback className="bg-[var(--chat-avatar)] text-xs font-semibold text-[var(--chat-avatar-foreground)]">
                          {getAvatarInitials(thread.contactName, thread.phoneNumber)}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-2 overflow-hidden">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-semibold leading-5 text-foreground">
                          {thread.contactName || thread.phoneNumber || 'Unknown phone number'}
                        </p>
                        {thread.lastMessage && (
                          <p className="mt-1 flex items-center gap-1 truncate text-xs leading-4 text-muted-foreground">
                            {thread.lastMessage.direction === 'outbound' && (
                              <span
                                aria-hidden="true"
                                className="relative inline-flex h-3 w-[0.95rem] shrink-0 items-center text-[var(--chat-check)]"
                              >
                                <Check className="absolute left-0 top-0 size-3" />
                                <Check className="absolute right-0 top-0 size-3" />
                              </span>
                            )}
                            {(() => {
                              const mediaType = thread.lastMessage.type;
                              const MediaIcon = mediaType ? MEDIA_PREVIEW_ICON[mediaType] : undefined;
                              const mediaLabel = mediaType ? MEDIA_PREVIEW_LABEL[mediaType] : undefined;

                              if (MediaIcon && mediaLabel && isGeneratedMediaPreviewText(thread.lastMessage.content)) {
                                return (
                                  <>
                                    <MediaIcon className="size-3.5 shrink-0" />
                                    <span className="truncate">{mediaLabel}</span>
                                  </>
                                );
                              }

                              return <span className="truncate">{thread.lastMessage.content}</span>;
                            })()}
                          </p>
                        )}
                      </div>
                      <div className="ml-2 flex flex-shrink-0 flex-col items-end gap-1 pt-0.5">
                        {/* Funcionalidad "Números/Zonas": píldora que muestra
                            de qué zona de ejemplo es este número (ver
                            getMockZoneForThreadKey en mock-zones.ts). */}
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary">
                          <MapPin className="size-2.5 flex-shrink-0" />
                          <span className="truncate">{zone}</span>
                        </span>

                        {thread.lastMessage && (
                          <span className="text-[11px] leading-4 text-muted-foreground">
                            {formatThreadTimestamp(thread.lastActiveAt)}
                          </span>
                        )}

                        {unreadCount > 0 ? (
                          <span
                            className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
                            aria-label={`${unreadCount} unread messages`}
                          >
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        ) : isMarkedUnread && (
                          // Marcado manualmente como no leído sin mensajes nuevos
                          // reales: solo un punto, nunca un número inventado.
                          <span
                            className="size-[10px] rounded-full bg-primary"
                            aria-label="Marked as unread"
                          />
                        )}

                        {openRowMenuKey === thread.key && rowMenuPosition && createPortal(
                          <div
                            role="menu"
                            aria-label="Conversation options"
                            data-row-menu
                            style={{ position: 'fixed', top: rowMenuPosition.top, right: rowMenuPosition.right }}
                            className="z-50 w-40 rounded-md border border-[var(--chat-border-strong)] bg-popover p-1 text-sm text-popover-foreground shadow-lg"
                          >
                            {/* Funcionalidad "Marcar como no leído": este botón. "Mark as
                                unread" solo se ofrece si el último mensaje es del cliente
                                (todavía sin responder) — si el último mensaje es tuyo, ya
                                respondiste, así que no tiene sentido marcarlo como no
                                leído. "Mark as read" (para deshacer una marca manual)
                                sigue disponible siempre que el chat esté marcado. */}
                            {(isMarkedUnread || thread.lastMessage?.direction === 'inbound') && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleThreadUnread(thread);
                                  setOpenRowMenuKey(null);
                                }}
                                className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs font-medium text-foreground hover:bg-[var(--chat-hover)]"
                              >
                                {isMarkedUnread ? (
                                  <MailOpen className="size-3.5" />
                                ) : (
                                  <Mail className="size-3.5" />
                                )}
                                {isMarkedUnread ? 'Mark as read' : 'Mark as unread'}
                              </button>
                            )}
                            {/* Funcionalidad "Archivar/Desarchivar": este botón */}
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleThreadArchived(thread);
                                setOpenRowMenuKey(null);
                              }}
                              className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs font-medium text-foreground hover:bg-[var(--chat-hover)]"
                            >
                              {isArchived ? (
                                <ArchiveRestore className="size-3.5" />
                              ) : (
                                <Archive className="size-3.5" />
                              )}
                              {isArchived ? 'Unarchive chat' : 'Archive chat'}
                            </button>
                          </div>,
                          document.body
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Íconos fijos abajo a la izquierda — antes vivían arriba a la derecha
          (ajustes, apariencia, notificaciones, refrescar); el usuario pidió
          moverlos todos aquí, al espacio que quedó vacío tras quitar el riel
          de navegación (Estados/Comunidades/Chats). El de apariencia
          (lunita) abre su menú hacia arriba (`menuPlacement="top"`) porque,
          pegado al borde de abajo, abrirlo hacia abajo lo cortaría contra el
          borde de la pantalla. */}
      {/* El padding vertical (py-2 sm:py-3) y el tamaño de los íconos
          (size-11 md:size-10) siguen exactamente la misma fórmula responsiva
          que la barra de "Type a message" del panel derecho (ver el <div>
          con "chat-toolbar" en message-view.tsx), para que las dos líneas
          divisorias de abajo queden a la misma altura y no se vean
          disparejas contra la línea vertical que separa ambos paneles. */}
      <div className="flex flex-shrink-0 items-center gap-2 border-t border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-3 py-2 sm:py-3">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-11 rounded-md border border-[var(--chat-border-strong)] text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground md:size-10"
          aria-label="Inbox settings"
          title="Inbox settings"
        >
          <Link href="/settings">
            <Settings className="size-5" />
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-11 rounded-md border border-[var(--chat-border-strong)] text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground md:size-10"
          aria-label="Plantillas"
          title="Plantillas"
        >
          <Link href="/plantillas">
            <LayoutTemplate className="size-5" />
          </Link>
        </Button>
        <ThemeToggle
          className="size-11 rounded-md border border-[var(--chat-border-strong)] text-muted-foreground md:size-10"
          align="left"
          menuPlacement="top"
        />
        <Button
          type="button"
          onClick={handleNotificationsClick}
          disabled={notificationPermission === 'unsupported' || notificationPermission === 'denied'}
          variant="ghost"
          size="icon"
          className={cn(
            "size-11 rounded-md border border-[var(--chat-border-strong)] text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground md:size-10",
            notificationsActive && "text-primary hover:text-primary",
          )}
          aria-label={notificationsButtonTitle}
          aria-pressed={notificationsActive}
          title={notificationsButtonTitle}
        >
          {notificationsActive ? (
            <Bell className="size-4" />
          ) : (
            <BellOff className="size-4" />
          )}
        </Button>
        <Button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          variant="ghost"
          size="icon"
          className="size-11 rounded-md border border-[var(--chat-border-strong)] text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground md:size-10"
          aria-label="Refresh conversations"
          title="Refresh conversations"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      <NewChatDialog
        open={isNewChatOpen}
        onOpenChange={setIsNewChatOpen}
        onOpenChat={onOpenNewChat}
      />
    </div>
  );
}
