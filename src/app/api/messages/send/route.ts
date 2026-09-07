import { NextResponse } from 'next/server';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';

// Funcionalidad "Contactos con username (BSUID)": para un contacto que le
// oculta su número al negocio (solo tiene username de WhatsApp — Kapso
// entrega `phone_number: null` para esos casos, ver
// src/app/api/conversations/route.ts), soporte de Kapso confirmó que sí se
// le puede escribir, pero el mensaje debe llevar `recipient` (su
// business_scoped_user_id, ej. "CO.1748333106269951") en vez de `to`. El SDK
// (@kapso/whatsapp-cloud-api) no expone esto en sus helpers tipados
// (sendText/sendImage/... todos exigen `to`), así que para este caso se arma
// el payload crudo a mano y se manda con whatsappClient.request(), que sí
// deja pasar cualquier campo. Mantenemos el camino con `to` (el de siempre)
// intacto y sin tocar — este es un camino nuevo, aparte.
async function sendRawMessageToRecipient(options: {
  phoneNumberId: string;
  businessScopedUserId: string;
  contextMessageId?: string;
  type: string;
  payload: Record<string, unknown>;
}) {
  const { phoneNumberId, businessScopedUserId, contextMessageId, type, payload } = options;

  const body: Record<string, unknown> = {
    messagingProduct: 'whatsapp',
    recipientType: 'individual',
    recipient: businessScopedUserId,
    type,
    [type]: payload,
    ...(contextMessageId && { context: { messageId: contextMessageId } })
  };

  return whatsappClient.request(
    'POST',
    `${phoneNumberId}/messages`,
    { body, responseType: 'json' }
  );
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const to = formData.get('to') as string;
    // Funcionalidad "Contactos con username (BSUID)": alternativa a `to`
    // cuando el contacto no tiene número de teléfono (ver arriba).
    const businessScopedUserId = (formData.get('businessScopedUserId') as string | null)?.trim() || undefined;
    const body = formData.get('body') as string;
    const file = formData.get('file') as File | null;
    const contextMessageId = (formData.get('contextMessageId') as string | null)?.trim() || undefined;
    const configuredPhoneNumber = await resolvePhoneNumberContext(formData.get('phoneNumberId') as string | undefined);
    const phoneNumberId = configuredPhoneNumber.phone_number_id;

    if (!to && !businessScopedUserId) {
      return NextResponse.json(
        { error: 'Missing required field: to (or businessScopedUserId)' },
        { status: 400 }
      );
    }

    let result;

    // Send media message
    if (file) {
      const fileType = file.type.split('/')[0]; // image, video, audio, application
      const mediaType = fileType === 'application' ? 'document' : fileType;

      // Upload media first
      const uploadResult = await whatsappClient.media.upload({
        phoneNumberId,
        type: mediaType as 'image' | 'video' | 'audio' | 'document',
        file: file,
        fileName: file.name
      });

      const mediaPayload =
        mediaType === 'image' ? { id: uploadResult.id, caption: body || undefined }
        : mediaType === 'video' ? { id: uploadResult.id, caption: body || undefined }
        : mediaType === 'audio' ? { id: uploadResult.id }
        : { id: uploadResult.id, caption: body || undefined, filename: file.name };

      if (businessScopedUserId && !to) {
        result = await sendRawMessageToRecipient({
          phoneNumberId,
          businessScopedUserId,
          contextMessageId,
          type: mediaType,
          payload: mediaPayload
        });
      } else if (mediaType === 'image') {
        result = await whatsappClient.messages.sendImage({
          phoneNumberId,
          to,
          contextMessageId,
          image: mediaPayload
        });
      } else if (mediaType === 'video') {
        result = await whatsappClient.messages.sendVideo({
          phoneNumberId,
          to,
          contextMessageId,
          video: mediaPayload
        });
      } else if (mediaType === 'audio') {
        result = await whatsappClient.messages.sendAudio({
          phoneNumberId,
          to,
          contextMessageId,
          audio: mediaPayload
        });
      } else {
        result = await whatsappClient.messages.sendDocument({
          phoneNumberId,
          to,
          contextMessageId,
          document: mediaPayload
        });
      }
    } else if (body) {
      // Send text message
      if (businessScopedUserId && !to) {
        result = await sendRawMessageToRecipient({
          phoneNumberId,
          businessScopedUserId,
          contextMessageId,
          type: 'text',
          payload: { body }
        });
      } else {
        result = await whatsappClient.messages.sendText({
          phoneNumberId,
          to,
          contextMessageId,
          body
        });
      }
    } else {
      return NextResponse.json(
        { error: 'Either body or file is required' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      typeof result === 'object' && result !== null
        ? { ...result, contextMessageId }
        : { result, contextMessageId }
    );
  } catch (error) {
    console.error('Error sending message:', error);
    return configurationErrorResponse(error);
  }
}
