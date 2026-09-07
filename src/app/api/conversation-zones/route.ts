import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAllZones, setZone } from '@/lib/conversation-zones';
import { isAssignableZone } from '@/lib/mock-zones';

/**
 * Zona real de cada conversación (ver src/lib/conversation-zones.ts). GET
 * es de lectura libre para cualquier sesión — solo expone qué zona tiene
 * cada chat (un nombre de ciudad), no el contenido de ningún mensaje, así
 * que no hace falta restringirlo. POST sí requiere ser Administrador,
 * verificado server-side con auth() — nunca se confía en el perfil que
 * mande el cliente.
 */
export async function GET() {
  const zones = await getAllZones();
  return NextResponse.json({ zones });
}

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user?.perfil !== 'Administrador') {
    return NextResponse.json({ error: 'Solo un Administrador puede asignar zonas' }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { threadKey?: string; zona?: string } | null;
  if (!body?.threadKey || !body.zona) {
    return NextResponse.json({ error: 'Missing threadKey or zona' }, { status: 400 });
  }

  if (!isAssignableZone(body.zona)) {
    return NextResponse.json({ error: `Zona inválida: ${body.zona}` }, { status: 400 });
  }

  await setZone(body.threadKey, body.zona);
  return NextResponse.json({ ok: true });
}
