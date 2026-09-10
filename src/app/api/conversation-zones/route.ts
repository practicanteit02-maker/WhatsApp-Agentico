import { NextResponse } from 'next/server';
import { registrarAuditoria } from '@/lib/auditoria';
import { getAllZones, getZone, setZone } from '@/lib/conversation-zones';
import { isAssignableZone } from '@/lib/mock-zones';
import { requierePermiso } from '@/lib/require-permission';

/**
 * Zona real de cada conversación (ver src/lib/conversation-zones.ts). GET
 * requiere estar logueado con un rol válido (permiso "leer" — ver
 * src/lib/permissions.ts), pero no filtra por zona: solo expone qué zona
 * tiene cada chat (un nombre de ciudad), no el contenido de ningún mensaje.
 * POST es "reasignar", parte del permiso "editar" — hoy solo Administrador
 * lo tiene, igual que antes de este cambio, pero ahora pasa por la matriz
 * de permisos en vez de comparar perfil === 'Administrador' acá mismo.
 */
export async function GET() {
  const denegado = await requierePermiso('leer');
  if (denegado) return denegado;

  const zones = await getAllZones();
  return NextResponse.json({ zones });
}

export async function POST(request: Request) {
  const denegado = await requierePermiso('editar');
  if (denegado) return denegado;

  const body = await request.json().catch(() => null) as { threadKey?: string; zona?: string } | null;
  if (!body?.threadKey || !body.zona) {
    return NextResponse.json({ error: 'Missing threadKey or zona' }, { status: 400 });
  }

  if (!isAssignableZone(body.zona)) {
    return NextResponse.json({ error: `Zona inválida: ${body.zona}` }, { status: 400 });
  }

  const zonaAnterior = await getZone(body.threadKey);
  await setZone(body.threadKey, body.zona);

  await registrarAuditoria({
    accion: 'cambio_zona',
    objetoTipo: 'chat',
    objetoId: body.threadKey,
    valorAnterior: zonaAnterior ?? null,
    valorNuevo: body.zona,
  });

  return NextResponse.json({ ok: true });
}
