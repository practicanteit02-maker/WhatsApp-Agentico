import { NextResponse } from 'next/server';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { checkZoneAccess } from '@/lib/conversation-zones';
import { threadKeyFor } from '@/lib/inbox-data';
import { extractMensajeId, registrarRespuesta } from '@/lib/respuestas';
import { whatsappClient } from '@/lib/whatsapp-client';
import { requierePermiso } from '@/lib/require-permission';

export async function POST(request: Request) {
  try {
    const denegado = await requierePermiso('escribir');
    if (denegado) return denegado;

    const body = await request.json();
    const {
      phoneNumber,
      businessScopedUserId,
      header,
      body: bodyText,
      buttons,
      phoneNumberId: requestedPhoneNumberId,
      // Funcionalidad "Tiempo de respuesta por persona" (base): ver el
      // comentario junto a estos mismos campos en
      // src/app/api/messages/send/route.ts.
      ultimoInboundEn,
      segundosDesdeUltimoInbound,
    } = body;
    const configuredPhoneNumber = await resolvePhoneNumberContext(requestedPhoneNumberId);
    const phoneNumberId = configuredPhoneNumber.phone_number_id;

    if (!phoneNumber || !bodyText || !buttons || buttons.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: phoneNumber, body, buttons' },
        { status: 400 }
      );
    }

    // Funcionalidad "Contactos con username (BSUID)": ver el comentario
    // junto a ReactBody.businessScopedUserId en
    // src/app/api/messages/react/route.ts — mismo bug, mismo arreglo.
    const threadKey = threadKeyFor(phoneNumberId, phoneNumber, undefined, businessScopedUserId);
    const access = await checkZoneAccess(threadKey);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Validate buttons
    if (buttons.length > 3) {
      return NextResponse.json(
        { error: 'Maximum 3 buttons allowed' },
        { status: 400 }
      );
    }

    // Build interactive button message payload
    const payload: {
      phoneNumberId: string;
      to: string;
      bodyText: string;
      header?: { type: 'text'; text: string };
      buttons: Array<{ id: string; title: string }>;
    } = {
      phoneNumberId,
      to: phoneNumber,
      bodyText,
      buttons: buttons.map((btn: { id: string; title: string }) => ({
        id: btn.id,
        title: btn.title.substring(0, 20) // Ensure max 20 chars
      }))
    };

    // Add header if provided
    if (header) {
      payload.header = {
        type: 'text',
        text: header
      };
    }

    // Send interactive button message
    const result = await whatsappClient.messages.sendInteractiveButtons(payload);

    // Funcionalidad "Tiempo de respuesta por persona" (base): ver
    // src/lib/respuestas.ts.
    await registrarRespuesta({
      threadKey,
      canal: 'interactivo',
      mensajeId: extractMensajeId(result),
      segundosDesdeUltimoInbound: typeof segundosDesdeUltimoInbound === 'number' ? segundosDesdeUltimoInbound : undefined,
      ultimoInboundEn: typeof ultimoInboundEn === 'string' ? ultimoInboundEn : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending interactive message:', error);
    return configurationErrorResponse(error);
  }
}
