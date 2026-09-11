import { NextResponse } from 'next/server';
import { checkZoneAccess } from '@/lib/conversation-zones';
import { listarEdiciones } from '@/lib/message-edits';
import { requierePermiso } from '@/lib/require-permission';

/**
 * Funcionalidad "Mostrar cuando un cliente edita un mensaje" — devuelve el
 * mapa { messageId: { texto, editadoEn } } de todas las ediciones guardadas
 * para un chat puntual, para que message-view.tsx las cruce con los
 * mensajes ya cargados sin tener que tocar cómo se guardan/leen los
 * mensajes normales (ver getDisplayMessageContent en message-view.tsx).
 *
 * Mismo gate que /api/messages/[conversationId] (el otro endpoint que
 * expone contenido de mensajes de un chat puntual): permiso "leer" +
 * checkZoneAccess sobre el threadKey — un chat con zona ajena no debe
 * filtrar ni su texto editado.
 */
export async function GET(request: Request) {
  try {
    const denegado = await requierePermiso('leer');
    if (denegado) return denegado;

    const { searchParams } = new URL(request.url);
    const threadKey = searchParams.get('threadKey')?.trim();
    if (!threadKey) {
      return NextResponse.json({ error: 'Falta el parámetro threadKey' }, { status: 400 });
    }

    const access = await checkZoneAccess(threadKey);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const ediciones = await listarEdiciones(threadKey);
    return NextResponse.json(ediciones);
  } catch (error) {
    console.error('GET /api/message-edits falló:', error);
    return NextResponse.json({ error: 'No se pudieron cargar las ediciones' }, { status: 500 });
  }
}
