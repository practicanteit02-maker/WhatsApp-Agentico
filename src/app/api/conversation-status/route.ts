import { NextResponse } from 'next/server';
import { getAllStatuses, isValidStatus, setStatus } from '@/lib/chat-status';
import { checkZoneAccess, getZone } from '@/lib/conversation-zones';
import { emitChatCollabUpdate } from '@/lib/event-bus';
import { requierePermiso } from '@/lib/require-permission';

/**
 * Estado de atención de cada chat (ver src/lib/chat-status.ts). GET
 * requiere estar logueado con un rol válido (permiso "leer" — ver
 * src/lib/permissions.ts). POST es "reasignar/estado", parte del permiso
 * "editar" de la matriz de roles — antes lo podía cambiar cualquier perfil
 * logueado, ahora (a pedido explícito) queda igual de restringido que
 * reasignar zona: solo Administrador. Sigue pasando también por
 * checkZoneAccess: un Administrador que además no fuera dueño de la zona
 * de ese chat de todas formas la ve completa, así que en la práctica el
 * único filtro real hoy es el de permiso.
 */
export async function GET() {
  const denegado = await requierePermiso('leer');
  if (denegado) return denegado;

  const statuses = await getAllStatuses();
  return NextResponse.json({ statuses });
}

export async function POST(request: Request) {
  const denegado = await requierePermiso('editar');
  if (denegado) return denegado;

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

  // Funcionalidad "Estado del chat en vivo": avisa por el mismo canal SSE
  // que ya usan typing/atribución (ver ChatCollabPayload.estado en
  // event-bus.ts) para que cualquier otra pestaña abierta actualice la
  // etiqueta al instante, sin esperar su refetch periódico. La zona se
  // resuelve acá (no reusa el resultado de checkZoneAccess, que para un
  // Administrador nunca llega a consultarla) para que el evento viaje ya
  // filtrado por zona igual que el resto.
  const zona = await getZone(body.threadKey);
  emitChatCollabUpdate({ threadKey: body.threadKey, estado: body.estado, zona });

  return NextResponse.json({ ok: true });
}
