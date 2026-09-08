import { NextResponse } from 'next/server';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { checkZoneAccess } from '@/lib/conversation-zones';
import { threadKeyFor } from '@/lib/inbox-data';
import { whatsappClient } from '@/lib/whatsapp-client';

type ReactBody = {
  phoneNumberId?: string;
  to?: string;
  // Funcionalidad "Contactos con username (BSUID)": necesario para calcular
  // el mismo threadKey que usa el resto de la app (ver el comentario junto
  // a threadKeyFor en src/lib/inbox-data.ts) — sin esto, un chat con
  // teléfono Y business_scoped_user_id calculaba acá un threadKey distinto
  // al real, y checkZoneAccess negaba el acceso a un no-Administrador aunque
  // el chat fuera de su propia zona (mismo bug que se arregló en
  // trigger-ai-reply/route.ts).
  businessScopedUserId?: string;
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
    const { to, businessScopedUserId, messageId, emoji } = body;
    const configuredPhoneNumber = await resolvePhoneNumberContext(body.phoneNumberId);
    const phoneNumberId = configuredPhoneNumber.phone_number_id;

    if (!to || !messageId) {
      return NextResponse.json(
        { error: 'to and messageId are required' },
        { status: 400 }
      );
    }

    const threadKey = threadKeyFor(phoneNumberId, to, undefined, businessScopedUserId);
    const access = await checkZoneAccess(threadKey);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
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
