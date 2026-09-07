import { NextResponse } from 'next/server';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';

type ReactBody = {
  phoneNumberId?: string;
  to?: string;
  messageId?: string;
  /** Emoji a mandar (p. ej. "👍"). Vacío/omitido = quitar la reacción actual. */
  emoji?: string;
};

/**
 * Funcionalidad "Reaccionar a un mensaje": le pide a la API de WhatsApp que
 * ponga (o quite, si `emoji` viene vacío) una reacción sobre un mensaje
 * puntual — el botón de emoji junto a Responder/Estrella en cada burbuja
 * (ver src/components/message-view.tsx) llama aquí.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReactBody;
    const { to, messageId, emoji } = body;
    const configuredPhoneNumber = await resolvePhoneNumberContext(body.phoneNumberId);
    const phoneNumberId = configuredPhoneNumber.phone_number_id;

    if (!to || !messageId) {
      return NextResponse.json(
        { error: 'to and messageId are required' },
        { status: 400 }
      );
    }

    // Importante: el campo `emoji` siempre se manda, incluso vacío — así es
    // como la API de WhatsApp reconoce "quitar la reacción" (omitir el
    // campo por completo, en vez de mandarlo vacío, hace que la API lo
    // rechace con un error de esquema).
    const result = await whatsappClient.messages.sendReaction({
      phoneNumberId,
      to,
      reaction: {
        messageId,
        emoji: emoji ?? '',
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending reaction:', error);
    return configurationErrorResponse(error);
  }
}
