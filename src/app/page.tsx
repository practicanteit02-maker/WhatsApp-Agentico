'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationList } from '@/components/conversation-list';
import { MOCK_ACCOUNT_PROFILES } from '@/lib/mock-profiles';
import { MessageView } from '@/components/message-view';
import {
  CONVERSATIONS_QUERY_KEY,
  type ConversationThread,
  fetchConversations,
  groupConversationsByPhoneNumber,
} from '@/lib/inbox-data';
import { loadStarredMessages, toggleStarredMessage, type StarredMessage } from '@/lib/starred-messages';

const ACTIVE_PROFILE_STORAGE_KEY = 'whatsapp-cloud-inbox-active-profile';

export default function Home() {
  const [selectedThreadKey, setSelectedThreadKey] = useState<string>();
  // Funcionalidad "Mensajes destacados": lista de mensajes con estrella, de
  // cualquier chat. Vive aquí (y no solo en MessageView) porque tanto el
  // botón de estrella de una burbuja (MessageView) como el panel que los
  // lista a todos (menú "⋮" en ConversationList) necesitan leer/escribir la
  // misma lista.
  const [starredMessages, setStarredMessages] = useState<StarredMessage[]>([]);
  // Funcionalidad "Mensajes destacados": mensaje al que hay que saltar la
  // próxima vez que MessageView termine de cargar, cuando se abre un chat
  // desde el panel de destacados haciendo clic en un mensaje puntual.
  const [jumpToMessageId, setJumpToMessageId] = useState<string>();
  // Funcionalidad "Perfil": vive aquí (y no solo en ConversationList) porque
  // MessageView también lo necesita, para mostrar el nombre del "remitente"
  // en los mensajes que se envían — ver activeSenderName en message-view.tsx
  // y el menú de perfiles en conversation-list.tsx. Se persiste en
  // localStorage (a diferencia de antes, que siempre arrancaba en
  // MOCK_ACCOUNT_PROFILES[0]) porque desde la funcionalidad "Candado de
  // chat" esto pasó a ser una identidad real de verdad que tiene que
  // sobrevivir a un refresh — si se reseteara solo, dos pestañas de la
  // misma persona podrían terminar "peleándose" el mismo chat entre ellas.
  const [activeMockProfile, setActiveMockProfileState] = useState<string>(MOCK_ACCOUNT_PROFILES[0]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
      if (stored && (MOCK_ACCOUNT_PROFILES as readonly string[]).includes(stored)) {
        setActiveMockProfileState(stored);
      }
    } catch {
      // Sin localStorage disponible: se sigue con el perfil por defecto.
    }
  }, []);

  const setActiveMockProfile = (profile: string) => {
    setActiveMockProfileState(profile);
    try {
      window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, profile);
    } catch {
      // Se queda solo en memoria para esta sesión si no se puede persistir.
    }
  };
  // Funcionalidad "Nuevo chat": número recién ingresado en NewChatDialog,
  // todavía sin ninguna conversación real (ver handleOpenNewChat) — mientras
  // esto esté puesto, MessageView se abre con este número como destinatario
  // aunque no exista un ConversationThread de verdad para él todavía.
  const [pendingNewChatRecipient, setPendingNewChatRecipient] = useState<{
    phoneNumber: string;
    phoneNumberId: string;
  }>();
  const queryClient = useQueryClient();

  useEffect(() => {
    setStarredMessages(loadStarredMessages());
  }, []);

  const { data: conversations = [] } = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: fetchConversations,
  });

  const threads = useMemo(
    () => groupConversationsByPhoneNumber(conversations),
    [conversations],
  );

  const selectedThread = selectedThreadKey
    ? threads.find(thread => thread.key === selectedThreadKey)
    : undefined;

  const handleSelectThread = (thread: ConversationThread) => {
    setSelectedThreadKey(thread.key);
    setPendingNewChatRecipient(undefined);
  };

  /** Funcionalidad "Mensajes destacados": clic en un mensaje del panel — abre su chat y, si el mensaje sigue cargado ahí, hace scroll hasta él. */
  const handleOpenStarredMessage = (thread: ConversationThread, messageId: string) => {
    setSelectedThreadKey(thread.key);
    setPendingNewChatRecipient(undefined);
    setJumpToMessageId(messageId);
  };

  /** Funcionalidad "Nuevo chat": "Continuar" en NewChatDialog llega hasta
   * acá — abre la vista de chat con este número como destinatario, todavía
   * sin ninguna conversación real (el compositor de plantillas de
   * MessageView se encarga de mandar el primer mensaje). */
  const handleOpenNewChat = (phoneNumber: string, phoneNumberId: string) => {
    setSelectedThreadKey(undefined);
    setPendingNewChatRecipient({ phoneNumber, phoneNumberId });
  };

  const handleTemplateSent = async (phoneNumber: string, phoneNumberId?: string) => {
    const refreshedConversations = await queryClient.fetchQuery({
      queryKey: CONVERSATIONS_QUERY_KEY,
      queryFn: fetchConversations,
      staleTime: 0,
    });
    const phoneNumberKey = phoneNumber.replace(/\D/g, '') || phoneNumber;
    const refreshedThread = groupConversationsByPhoneNumber(refreshedConversations)
      .find(thread =>
        (!phoneNumberId || thread.phoneNumberId === phoneNumberId) &&
        (thread.key.endsWith(`:${phoneNumberKey}`) || thread.phoneNumber === phoneNumber)
      );

    setSelectedThreadKey(refreshedThread?.key ?? (phoneNumberId ? `${phoneNumberId}:${phoneNumberKey}` : phoneNumberKey));
    setPendingNewChatRecipient(undefined);
  };

  const handleBackToList = () => {
    setSelectedThreadKey(undefined);
    setPendingNewChatRecipient(undefined);
  };

  return (
    // A pedido del usuario ("quiero que todas las esquinas se vean
    // redondeadas"), en escritorio (md+) los dos paneles flotan como
    // tarjetas separadas con esquinas redondeadas, en vez de ir pegados
    // borde a borde contra la ventana — en mobile se dejan a pantalla
    // completa (sin el margen/gap), que es lo esperable ahí.
    <div className="flex h-dvh min-h-dvh w-full overflow-hidden bg-background text-foreground md:gap-3 md:p-3">
      <ConversationList
        onSelectThread={handleSelectThread}
        selectedThreadKey={selectedThreadKey}
        isHidden={!!selectedThread}
        starredMessages={starredMessages}
        onOpenStarredMessage={handleOpenStarredMessage}
        activeMockProfile={activeMockProfile}
        onChangeActiveMockProfile={setActiveMockProfile}
        onOpenNewChat={handleOpenNewChat}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 md:overflow-hidden md:rounded-2xl md:border md:border-[var(--chat-border-strong)]">
        <MessageView
          conversationId={selectedThread?.latestConversation.id}
          conversations={selectedThread?.conversations || []}
          phoneNumber={selectedThread?.phoneNumber ?? pendingNewChatRecipient?.phoneNumber}
          businessScopedUserId={selectedThread?.businessScopedUserId}
          phoneNumberId={selectedThread?.phoneNumberId ?? pendingNewChatRecipient?.phoneNumberId}
          inboxPhoneNumber={selectedThread?.inboxPhoneNumber}
          inboxDisplayName={selectedThread?.inboxDisplayName}
          contactName={selectedThread?.contactName}
          lastActiveAt={selectedThread?.lastActiveAt}
          onTemplateSent={handleTemplateSent}
          onBack={handleBackToList}
          isVisible={!!selectedThread || !!pendingNewChatRecipient}
          starredMessages={starredMessages}
          onToggleStarredMessage={(message) => {
            setStarredMessages((current) => toggleStarredMessage(message, current));
          }}
          jumpToMessageId={jumpToMessageId}
          onJumpToMessageHandled={() => setJumpToMessageId(undefined)}
          activeSenderName={activeMockProfile}
        />
      </div>
    </div>
  );
}
