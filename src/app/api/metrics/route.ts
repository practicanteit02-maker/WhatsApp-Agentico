import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { agregarAuditoria, diaBogota, restarDias } from '@/lib/auditoria';
import { contarChatsVivos } from '@/lib/metrics';
import { agregarRespuestas } from '@/lib/respuestas-metrics';
import { esAdministrador } from '@/lib/permissions';

/**
 * Dashboard de métricas (ver src/components/metrics-dashboard.tsx). Solo
 * lectura y solo Administrador — mismo criterio que /api/auditoria y
 * /api/usuarios, no pasa por la matriz de permisos: son datos agregados de
 * toda la operación, no de un chat puntual.
 *
 * Params opcionales:
 *   - desde / hasta : `YYYY-MM-DD` en America/Bogota para las métricas de
 *                     auditoría (acciones por persona / por día). Default:
 *                     últimos 7 días si no viene ninguno.
 *   - dias          : atajo alternativo — "últimos N días" (7/14/30). Se
 *                     ignora si vienen `desde`/`hasta` explícitos.
 *
 * Las tres agregaciones (chats desde Kapso, auditoría y respuestas desde
 * DynamoDB) corren con Promise.allSettled: si una falla (ej. Kapso tarda),
 * esa clave viene null y el motivo queda en `errores`, pero las demás
 * igual se devuelven.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!esAdministrador(session?.user?.perfil)) {
    return NextResponse.json(
      { error: 'Solo un Administrador puede ver el dashboard de métricas' },
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

  const [chatsRes, auditoriaRes, respuestasRes] = await Promise.allSettled([
    contarChatsVivos(),
    agregarAuditoria(desde, hasta),
    agregarRespuestas(desde, hasta),
  ]);

  const errores: string[] = [];

  let chats = null;
  if (chatsRes.status === 'fulfilled') {
    chats = chatsRes.value;
  } else {
    console.error('GET /api/metrics — conteo de chats falló:', chatsRes.reason);
    errores.push('No se pudieron contar los chats (Kapso).');
  }

  let auditoria = null;
  if (auditoriaRes.status === 'fulfilled') {
    auditoria = auditoriaRes.value;
  } else {
    console.error('GET /api/metrics — agregación de auditoría falló:', auditoriaRes.reason);
    errores.push('No se pudieron calcular las métricas de auditoría.');
  }

  let respuestas = null;
  if (respuestasRes.status === 'fulfilled') {
    respuestas = respuestasRes.value;
  } else {
    console.error('GET /api/metrics — agregación de respuestas falló:', respuestasRes.reason);
    errores.push('No se pudieron calcular las métricas de tiempo de respuesta.');
  }

  return NextResponse.json({ chats, auditoria, respuestas, desde, hasta, errores });
}
