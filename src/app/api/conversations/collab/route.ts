import { NextResponse } from 'next/server';
import * as chatCollab from '@/lib/chat-collab';

type CollabAction = 'typing' | 'attribute';

/**
 * Funcionalidad "Quién está escribiendo": quién tiene texto sin mandar en
 * este chat ahora mismo + quién mandó cada mensaje (ver
 * src/lib/chat-collab.ts). GET trae el estado inicial al abrir un chat;
 * POST avisa "estoy escribiendo" o registra el remitente real de un
 * mensaje ya mandado, y lo transmite en vivo a quien esté escuchando por
 * SSE (ver src/app/api/events/route.ts). Puramente informativo — no
 * restringe quién puede mandar mensajes.
 */
export async function GET(request: Request) {
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
  const body = await request.json().catch(() => null) as {
    threadKey?: string;
    action?: CollabAction;
    profile?: string;
    messageId?: string;
  } | null;

  if (!body?.threadKey || !body.action) {
    return NextResponse.json({ error: 'Missing threadKey or action' }, { status: 400 });
  }

  const { threadKey, action, profile, messageId } = body;

  switch (action) {
    case 'typing':
      if (!profile) return NextResponse.json({ error: 'Missing profile' }, { status: 400 });
      chatCollab.setTyping(threadKey, profile);
      break;
    case 'attribute':
      if (!profile || !messageId) {
        return NextResponse.json({ error: 'Missing profile or messageId' }, { status: 400 });
      }
      chatCollab.recordAttribution(threadKey, messageId, profile);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({ presence: chatCollab.getState(threadKey) });
}
