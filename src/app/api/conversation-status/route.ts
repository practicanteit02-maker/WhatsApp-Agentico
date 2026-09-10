import { NextResponse } from 'next/server';
import { registrarAuditoria } from '@/lib/auditoria';
import { getAllStatuses, getStatus, isValidStatus, setStatus } from '@/lib/chat-status';
import { checkZoneAccess, getZone } from '@/lib/conversation-zones';
import { emitChatCollabUpdate } from '@/lib/event-bus';
import { requierePermiso } from '@/lib/require-permission';

/**
 * Estado de atención de cada chat (ver src/lib/chat-status.ts). GET
 * requiere estar logueado con un rol válido (permiso "leer" — ver
 * src/lib/permissions.ts). POST ("cambiar estado") requiere "escribir" —
 * a pedido explícito, Administrador Y Coordinador pueden cambiarlo (QA no,
 * porque tampoco tiene "escribir"). A diferencia de reasignar zona (que
 * sigue exclusiva de Administrador vía "editar"), acá se relajó el
 * permiso sin tocar checkZoneAccess: un no-Administrador con "escribir"
 * solo puede cambiar el estado de un chat de su propia zona, igual que ya
 * pasa con el resto de las acciones sobre un chat puntual.
 */
export async function GET() {
  const denegado = await requierePermiso('leer');
  if (denegado) return denegado;

  const statuses = await getAllStatuses();
  return NextResponse.json({ statuses });
}

export async function POST(request: Request) {
  const denegado = await requierePermiso('escribir');
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

  const estadoAnterior = await getStatus(body.threadKey);
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

  await registrarAuditoria({
    accion: 'cambio_estado',
    objetoTipo: 'chat',
    objetoId: body.threadKey,
    valorAnterior: estadoAnterior,
    valorNuevo: body.estado,
  });

  return NextResponse.json({ ok: true });
}
