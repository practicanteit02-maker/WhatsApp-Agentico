import { NextResponse } from 'next/server';
import { sendAutoReply } from '@/lib/auto-reply';

type TriggerAIReplyBody = {
  phoneNumberId?: string;
  to?: string;
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
    const body = (await request.json()) as TriggerAIReplyBody;
    const { phoneNumberId, to, incomingText, messageId, conversationId } = body;

    if (!phoneNumberId || !to || !incomingText) {
      return NextResponse.json(
        { error: 'phoneNumberId, to and incomingText are required' },
        { status: 400 }
      );
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
