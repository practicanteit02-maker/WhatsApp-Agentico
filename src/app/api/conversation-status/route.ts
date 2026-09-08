import { NextResponse } from 'next/server';
import { getAllStatuses, isValidStatus, setStatus } from '@/lib/chat-status';
import { checkZoneAccess } from '@/lib/conversation-zones';

/**
 * Estado de atención de cada chat (ver src/lib/chat-status.ts). GET es de
 * lectura libre para cualquier sesión — solo expone en qué estado está cada
 * chat, no el contenido de ningún mensaje. POST requiere sesión y, a
 * diferencia de /api/conversation-zones, no está restringido a
 * Administrador (cualquier perfil logueado puede cambiar el estado de un
 * chat — es una marca operativa del día a día, no una decisión de acceso)
 * — pero sigue pasando por checkZoneAccess, el mismo control que ya
 * protege el resto de los endpoints de un chat puntual: un
 * no-Administrador solo puede tocar el estado de un chat de su propia
 * zona (la única que puede ver de todas formas).
 */
export async function GET() {
  const statuses = await getAllStatuses();
  return NextResponse.json({ statuses });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { threadKey?: string; estado?: string } | null;
  if (!body?.threadKey || !body.estado) {
    return NextResponse.json({ error: 'Missing threadKey or estado' }, { status: 400 });
  }

  if (!isValidStatus(body.estado)) {
    return NextResponse.json({ error: `Estado inválido: ${body.estado}` }, { status: 400 });
  }

  const access = await checkZoneAccess(body.threadKey);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await setStatus(body.threadKey, body.estado);
  return NextResponse.json({ ok: true });
}
