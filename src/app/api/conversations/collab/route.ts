import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import * as chatCollab from '@/lib/chat-collab';
import { requierePermiso } from '@/lib/require-permission';

type CollabAction = 'typing' | 'attribute';

/**
 * Funcionalidad "Quién está escribiendo": quién tiene texto sin mandar en
 * este chat ahora mismo + quién mandó cada mensaje (ver
 * src/lib/chat-collab.ts). GET trae el estado inicial al abrir un chat;
 * POST avisa "estoy escribiendo" o registra el remitente real de un
 * mensaje ya mandado, y lo transmite en vivo a quien esté escuchando por
 * SSE (ver src/app/api/events/route.ts). Puramente informativo — no
 * restringe quién puede mandar mensajes, pero sigue exigiendo sesión (permiso
 * "leer"/"escribir") como el resto de los endpoints.
 */
export async function GET(request: Request) {
  const denegado = await requierePermiso('leer');
  if (denegado) return denegado;

  const { searchParams } = new URL(request.url);
  const threadKey = searchParams.get('threadKey');
  if (!threadKey) {
    return NextResponse.json({ error: 'Missing threadKey' }, { status: 400 });
  }

  const messageIdsParam = searchParams.get('messageIds');
  const messageIds = messageIdsParam ? messageIdsParam.split(',').filter(Boolean) : [];

  return NextResponse.json({
    presence: chatCollab.getState(threadKey),
    attribution: chatCollab.getAttribution(messageIds),
  });
}

export async function POST(request: Request) {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const body = await request.json().catch(() => null) as {
    threadKey?: string;
    action?: CollabAction;
    messageId?: string;
  } | null;

  if (!body?.threadKey || !body.action) {
    return NextResponse.json({ error: 'Missing threadKey or action' }, { status: 400 });
  }

  const { threadKey, action, messageId } = body;

  // Quién está escribiendo / quién mandó un mensaje sale SIEMPRE del rol de
  // la sesión autenticada (session.user.perfil), nunca de un campo `profile`
  // que mandara el cliente — antes ese campo viajaba libre en el body, así
  // que cualquiera podía atribuirse mensajes ajenos o hacerse pasar por otro
  // rol en el indicador de "está escribiendo". requierePermiso('escribir')
  // ya garantizó arriba que hay sesión con un rol válido.
  const session = await auth();
  const profile = session?.user?.perfil;
  if (!profile) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  switch (action) {
    case 'typing':
      await chatCollab.setTyping(threadKey, profile);
      break;
    case 'attribute':
      if (!messageId) {
        return NextResponse.json({ error: 'Missing messageId' }, { status: 400 });
      }
      await chatCollab.recordAttribution(threadKey, messageId, profile);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({ presence: chatCollab.getState(threadKey) });
}
