import { NextResponse } from 'next/server';
import { sendAutoReply } from '@/lib/auto-reply';
import { checkZoneAccess } from '@/lib/conversation-zones';
import { getAiEnabled } from '@/lib/chat-ai-config';
import { threadKeyFor } from '@/lib/inbox-data';
import { requierePermiso } from '@/lib/require-permission';

type TriggerAIReplyBody = {
  phoneNumberId?: string;
  to?: string;
  // Funcionalidad "Contactos con username (BSUID)": necesario para calcular
  // el mismo threadKey que usa el resto de la app (ver el comentario junto
  // a threadKeyFor en src/lib/inbox-data.ts) — sin esto, un chat con
  // teléfono Y business_scoped_user_id calculaba acá un threadKey distinto
  // al que arma el botón de src/components/message-view.tsx, que sí lo
  // manda (message-view.tsx prioriza el BSUID sobre el teléfono cuando
  // ambos existen).
  businessScopedUserId?: string;
  incomingText?: string;
  messageId?: string;
  conversationId?: string;
};

/**
 * Disparador de respaldo que la bandeja llama cuando un agente abre un chat
 * cuyo último mensaje sigue siendo un inbound sin responder (ver
 * message-view.tsx). El webhook (src/app/api/webhooks/whatsapp) ya responde
 * automáticamente en el instante en que Kapso nos notifica un mensaje nuevo
 * — esto existe solo para atrapar el caso en que ese camino lo dejó pasar
 * (un túnel caído, un request perdido, etc.), para que el cliente no se
 * quede esperando solo porque el webhook no se disparó.
 */
export async function POST(request: Request) {
  try {
    const denegado = await requierePermiso('escribir');
    if (denegado) return denegado;

    const body = (await request.json()) as TriggerAIReplyBody;
    const { phoneNumberId, to, businessScopedUserId, incomingText, messageId, conversationId } = body;

    if (!phoneNumberId || !to || !incomingText) {
      return NextResponse.json(
        { error: 'phoneNumberId, to and incomingText are required' },
        { status: 400 }
      );
    }

    const threadKey = threadKeyFor(phoneNumberId, to, undefined, businessScopedUserId);
    const access = await checkZoneAccess(threadKey);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Funcionalidad "IA por chat": interruptor por conversación (ver
    // src/lib/chat-ai-config.ts) — apagado por defecto, hay que prenderlo a
    // mano desde el chat. Sin esto, este disparador respondía siempre que
    // se abría un chat con un inbound sin responder.
    if (!(await getAiEnabled(threadKey))) {
      return NextResponse.json({ sent: false, reason: 'ai-disabled' });
    }

    // messageId permite compartir el registro anti-duplicados del webhook
    // (ver src/lib/auto-reply.ts) para que abrir el chat justo cuando la
    // respuesta del webhook sigue en vuelo no produzca dos respuestas.
    // conversationId permite empujar la respuesta directo a este chat vía
    // SSE en vez de esperar a que el webhook de estado de Kapso vuelva a
    // llegarnos.
    await sendAutoReply(phoneNumberId, to, incomingText, messageId, conversationId);

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error('Failed to trigger AI auto-reply on chat open:', error);
    return NextResponse.json({ error: 'Failed to trigger AI auto-reply' }, { status: 500 });
  }
}
