import { NextResponse } from 'next/server';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { checkZoneAccess } from '@/lib/conversation-zones';
import { threadKeyFor } from '@/lib/inbox-data';
import { whatsappClient } from '@/lib/whatsapp-client';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const configuredPhoneNumber = await resolvePhoneNumberContext(searchParams.get('phoneNumberId') ?? undefined);
    const phoneNumberId = configuredPhoneNumber.phone_number_id;

    // Control de acceso por zona: a diferencia de los demás endpoints, este
    // no tenía forma de identificar a qué conversación pertenece el media
    // (solo recibía mediaId + phoneNumberId) — message-view.tsx ahora manda
    // también el contacto (phoneNumber o businessScopedUserId) para poder
    // calcular el threadKey acá.
    const threadKey = threadKeyFor(
      phoneNumberId,
      searchParams.get('phoneNumber') ?? '',
      undefined,
      searchParams.get('businessScopedUserId') ?? undefined
    );
    const access = await checkZoneAccess(threadKey);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Get metadata for mime type
    const metadata = await whatsappClient.media.get({
      mediaId,
      phoneNumberId
    });

    const buffer = await whatsappClient.media.download({
      mediaId,
      phoneNumberId,
      auth: 'never' // Force no auth headers for CDN
    });

    // If buffer is a Response, return it directly
    if (buffer instanceof Response) {
      return buffer;
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': metadata.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    console.error('Error fetching media:', error);
    return configurationErrorResponse(error);
  }
}
