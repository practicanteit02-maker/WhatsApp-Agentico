import { NextResponse } from 'next/server';
import { getAllAiEnabled, setAiEnabled } from '@/lib/chat-ai-config';
import { checkZoneAccess } from '@/lib/conversation-zones';
import { requierePermiso } from '@/lib/require-permission';

/**
 * Si la IA responde automáticamente al abrir un chat en particular (ver
 * src/lib/chat-ai-config.ts). GET requiere estar logueado con un rol válido
 * (permiso "leer" — ver src/lib/permissions.ts). POST requiere sesión y, a
 * diferencia de /api/conversation-zones, no está restringido a
 * Administrador (cualquier perfil logueado puede prender/apagar la IA de un
 * chat) — esto no es "responder/crear" ni "estado/reasignar", así que
 * queda fuera de la matriz de roles de este cambio a propósito, sin
 * endurecer. Sigue pasando por checkZoneAccess, el mismo control que ya
 * protege el resto de los endpoints de un chat puntual: un no-Administrador
 * solo puede tocar el interruptor de un chat de su propia zona (la única
 * que puede ver de todas formas).
 */
export async function GET() {
  const denegado = await requierePermiso('leer');
  if (denegado) return denegado;

  const config = await getAllAiEnabled();
  return NextResponse.json({ config });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { threadKey?: string; enabled?: boolean } | null;
  if (!body?.threadKey || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Missing threadKey or enabled' }, { status: 400 });
  }

  const access = await checkZoneAccess(body.threadKey);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await setAiEnabled(body.threadKey, body.enabled);
  return NextResponse.json({ ok: true });
}
