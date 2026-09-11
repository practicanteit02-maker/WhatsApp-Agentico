import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { diaBogota, restarDias } from '@/lib/auditoria';
import { agregarRespuestas } from '@/lib/respuestas-metrics';
import { esCoordinadora } from '@/lib/permissions';

/**
 * Panel personal "Mis estadísticas" (ver src/components/mis-estadisticas-view.tsx):
 * cada persona ve sus propios números — chats atendidos, su tiempo de
 * respuesta promedio, su matriz de actividad. Exclusivo del rol Coordinadora
 * (ver esCoordinadora() en permissions.ts) — Administrador queda afuera a
 * propósito porque ya ve esos mismos números, incluidos los suyos, dentro
 * del dashboard general de /api/metrics.
 *
 * El actor SIEMPRE es el correo de la sesión real (`session.user.email`) —
 * este endpoint no acepta ningún `actor` por query string. Es justamente lo
 * que garantiza que cada persona vea exclusivamente lo suyo: ni siquiera
 * manipulando el request se puede pedir los datos de otra persona, porque el
 * filtro no depende de nada que mande el cliente.
 *
 * Mismos params que /api/metrics para el rango: desde/hasta o dias
 * (default 7).
 */
export async function GET(request: Request) {
  const session = await auth();
  const correo = session?.user?.email;
  const perfil = session?.user?.perfil ?? '';

  if (!correo || !esCoordinadora(perfil)) {
    return NextResponse.json(
      { error: 'Esta sección es exclusiva del rol Coordinadora' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);

  const hasta = searchParams.get('hasta')?.trim() || diaBogota();
  let desde = searchParams.get('desde')?.trim() || '';
  if (!desde) {
    const diasRaw = Number(searchParams.get('dias'));
    const dias = Number.isFinite(diasRaw) && diasRaw > 0 ? Math.min(Math.floor(diasRaw), 92) : 7;
    desde = restarDias(hasta, dias - 1);
  }
  if (desde > hasta) {
    return NextResponse.json({ error: 'El rango de fechas es inválido' }, { status: 400 });
  }

  try {
    const datos = await agregarRespuestas(desde, hasta, correo);
    return NextResponse.json(datos);
  } catch (error) {
    console.error('GET /api/mis-estadisticas falló:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron cargar tus estadísticas' },
      { status: 500 }
    );
  }
}
