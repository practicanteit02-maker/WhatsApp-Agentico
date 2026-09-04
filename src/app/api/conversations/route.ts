import { NextResponse } from 'next/server';
import {
  buildKapsoFields,
  type ConversationKapsoExtensions,
  type ConversationRecord
} from '@kapso/whatsapp-cloud-api';
import { configurationErrorResponse, getTrackedPhoneNumbers } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';
import type { KapsoPhoneNumber } from '@/types/settings';

// Funcionalidad "Reaccionar a un mensaje": Kapso reporta el evento de
// reacción (poner o quitar una) como si fuera el "último mensaje" de la
// conversación — con este mismo texto generado por Kapso ("Reacted with 👍
// to message ..." / "Reaction removed from message ..."). En la vista previa
// de la lista de chats (la fila de cada contacto en ConversationList, una
// ruta de datos totalmente aparte del chat abierto — ver normalizeMessages
// en src/lib/inbox-data.ts), "poner" una reacción sí se deja ver tal cual
// (a pedido del usuario), pero "quitarla" se oculta y cae al último mensaje
// de verdad anterior (ver findFallbackLastMessage más abajo).
const REACTION_EVENT_TEXT_PATTERN = /^(Reacted with .+ to message |Reaction removed from message )/;
const REACTION_ADD_TEXT_PATTERN = /^Reacted with .+ to message /;

/** true si hay que ocultar este "último mensaje" y buscar el real anterior — o sea, es una reacción y NO es del tipo "poner" (que sí se deja ver). */
function shouldHideLastMessage(lastMessageType?: string, lastMessageText?: string): boolean {
  if (typeof lastMessageText === 'string' && REACTION_ADD_TEXT_PATTERN.test(lastMessageText)) return false;

  if (lastMessageType === 'reaction') return true;
  return typeof lastMessageText === 'string' && REACTION_EVENT_TEXT_PATTERN.test(lastMessageText);
}

function extractMessageContent(msg: { text?: { body?: unknown }; kapso?: unknown }): string | undefined {
  const kapso = msg.kapso as { content?: unknown } | undefined;
  const rawContent = kapso?.content;

  if (typeof rawContent === 'string') return rawContent;
  if (rawContent && typeof rawContent === 'object' && 'text' in rawContent) {
    const maybeText = (rawContent as { text?: unknown }).text;
    if (typeof maybeText === 'string') return maybeText;
  }

  return typeof msg.text?.body === 'string' ? msg.text.body : undefined;
}

/**
 * Funcionalidad "Reaccionar a un mensaje": cuando el último evento real de
 * la conversación es una reacción (que ya se oculta arriba), no queremos
 * dejar la vista previa de la lista de chats vacía — el usuario pidió que en
 * ese caso se muestre el último mensaje de verdad (recibido o contestado)
 * en su lugar. Como la API de Kapso solo entrega "el último mensaje" tal
 * cual (sin poder saltarse reacciones), esto hace una consulta aparte al
 * historial de esa conversación puntual y busca hacia atrás el primero que
 * no sea una reacción. Solo se llama para las conversaciones que de verdad
 * lo necesitan, no en cada carga.
 */
async function findFallbackLastMessage(
  phoneNumberId: string,
  conversationId: string,
): Promise<{ content: string; direction: 'inbound' | 'outbound'; type?: string } | undefined> {
  try {
    const response = await whatsappClient.messages.listByConversation({
      phoneNumberId,
      conversationId,
      limit: 25,
      fields: buildKapsoFields(['direction', 'content'])
    });

    const candidates = response.data
      .map((msg) => {
        const kapso = msg.kapso as { direction?: string } | undefined;
        const content = extractMessageContent(msg);
        return { content, direction: kapso?.direction, type: msg.type, timestamp: msg.timestamp };
      })
      .filter((item): item is typeof item & { content: string } =>
        Boolean(item.content) && item.type !== 'reaction' && !REACTION_EVENT_TEXT_PATTERN.test(item.content as string)
      )
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

    const match = candidates[0];
    if (!match) return undefined;

    return {
      content: match.content,
      direction: match.direction === 'outbound' ? 'outbound' : 'inbound',
      type: match.type
    };
  } catch (error) {
    console.error('Failed to look up fallback last message for conversation', conversationId, error);
    return undefined;
  }
}

function parseDirection(kapso?: ConversationKapsoExtensions): 'inbound' | 'outbound' {
  if (!kapso) {
    return 'inbound';
  }

  const inboundAt = typeof kapso.lastInboundAt === 'string' ? Date.parse(kapso.lastInboundAt) : Number.NaN;
  const outboundAt = typeof kapso.lastOutboundAt === 'string' ? Date.parse(kapso.lastOutboundAt) : Number.NaN;

  if (Number.isFinite(inboundAt) && Number.isFinite(outboundAt)) {
    return inboundAt >= outboundAt ? 'inbound' : 'outbound';
  }

  if (Number.isFinite(inboundAt)) return 'inbound';
  if (Number.isFinite(outboundAt)) return 'outbound';
  return 'inbound';
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 50;
    const { phoneNumbers, settings } = await getTrackedPhoneNumbers();
    const selectedPhoneNumbers = settings.selectedPhoneNumberIds
      .map(phoneNumberId => phoneNumbers.find(number => number.phone_number_id === phoneNumberId))
      .filter((number): number is KapsoPhoneNumber => Boolean(number));

    if (selectedPhoneNumbers.length === 0) {
      return NextResponse.json({
        data: [],
        paging: undefined
      });
    }

    const fields = buildKapsoFields([
      'contact_name',
      'messages_count',
      'last_message_type',
      'last_message_text',
      'last_inbound_at',
      'last_outbound_at'
    ]);

    const responses = await Promise.allSettled(
      selectedPhoneNumbers.map(async (sourcePhoneNumber) => {
        const response = await whatsappClient.conversations.list({
          phoneNumberId: sourcePhoneNumber.phone_number_id,
          ...(status && { status: status as 'active' | 'ended' }),
          limit,
          fields
        });

        return {
          sourcePhoneNumber,
          response
        };
      })
    );

    const successfulResponses = responses.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : []
    );

    if (successfulResponses.length === 0) {
      const failedResponse = responses.find(result => result.status === 'rejected');
      throw failedResponse?.reason ?? new Error('Failed to fetch conversations');
    }

    // Transform conversations to match frontend expectations
    const transformedData = (
      await Promise.all(
        successfulResponses.map(({ response, sourcePhoneNumber }) =>
          Promise.all(
            response.data.map(async (conversation: ConversationRecord) => {
              const kapso = conversation.kapso;
              const phoneNumberId = conversation.phoneNumberId ?? sourcePhoneNumber.phone_number_id;

              const lastMessageText = typeof kapso?.lastMessageText === 'string' ? kapso.lastMessageText : undefined;
              const lastMessageType = typeof kapso?.lastMessageType === 'string' ? kapso.lastMessageType : undefined;
              const shouldHide = shouldHideLastMessage(lastMessageType, lastMessageText);

              const lastMessage = lastMessageText && !shouldHide
                ? {
                    content: lastMessageText,
                    direction: parseDirection(kapso),
                    type: lastMessageType
                  }
                // El último evento real es una reacción quitada (o algo sin
                // texto reconocible) — se busca el mensaje de verdad
                // anterior en vez de dejar la vista previa vacía (ver
                // findFallbackLastMessage más arriba).
                : lastMessageText && shouldHide
                  ? await findFallbackLastMessage(phoneNumberId, conversation.id)
                  : undefined;

              return {
                id: conversation.id,
                phoneNumber: conversation.phoneNumber ?? '',
                status: conversation.status ?? 'unknown',
                lastActiveAt: typeof conversation.lastActiveAt === 'string' ? conversation.lastActiveAt : undefined,
                phoneNumberId,
                inboxPhoneNumber: sourcePhoneNumber.display_phone_number,
                inboxDisplayName: sourcePhoneNumber.display_name ?? sourcePhoneNumber.verified_name ?? sourcePhoneNumber.name,
                businessAccountId: sourcePhoneNumber.business_account_id,
                // Funcionalidad "Contactos con username (BSUID)": presente
                // cuando el contacto le oculta su número al negocio — ver el
                // comentario junto a Conversation['businessScopedUserId'] en
                // src/lib/inbox-data.ts.
                businessScopedUserId: typeof conversation.businessScopedUserId === 'string'
                  ? conversation.businessScopedUserId
                  : undefined,
                metadata: conversation.metadata ?? {},
                contactName: typeof kapso?.contactName === 'string' ? kapso.contactName : undefined,
                messagesCount: typeof kapso?.messagesCount === 'number' ? kapso.messagesCount : undefined,
                lastMessage
              };
            })
          )
        )
      )
    ).flat();

    return NextResponse.json({
      data: transformedData,
      partialErrors: responses
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason instanceof Error ? result.reason.message : 'Failed to fetch conversations')
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return configurationErrorResponse(error);
  }
}
