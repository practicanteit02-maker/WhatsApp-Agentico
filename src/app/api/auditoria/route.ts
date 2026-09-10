import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { diaBogota, listarAuditoria, restarDias } from '@/lib/auditoria';
import { esAdministrador } from '@/lib/permissions';

/**
 * Historial de auditoría (ver src/lib/auditoria.ts). Solo lectura y solo
 * Administrador — igual que /api/usuarios, no pasa por la matriz de permisos
 * (requierePermiso): quién cambió qué en toda la operación es información de
 * nivel cuenta, no la lectura de un chat puntual, así que ni siquiera se
 * expone a Coordinadora/QA. La sesión se lee server-side con auth().
 *
 * Parámetros (todos opcionales salvo el rango, que tiene default de 7 días):
 *   - desde / hasta : `YYYY-MM-DD` en America/Bogota (inclusive).
 *   - actor         : correo exacto de la persona.
 *   - perfil        : rol (Administrador / Coordinadora / QA); matchea todas
 *                     sus ortografías guardadas (ver variantesDeRol).
 *   - accion        : tipo de acción; se puede repetir para varios.
 *   - limit         : tamaño de página (1-200, default 50).
 *   - cursor        : cursor opaco de la página anterior.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!esAdministrador(session?.user?.perfil)) {
    return NextResponse.json(
      { error: 'Solo un Administrador puede ver el historial de auditoría' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);

  const hasta = searchParams.get('hasta')?.trim() || diaBogota();
  const desde = searchParams.get('desde')?.trim() || restarDias(hasta, 6);
  if (desde > hasta) {
    return NextResponse.json({ error: 'El rango de fechas es inválido' }, { status: 400 });
  }

  const actor = searchParams.get('actor')?.trim().toLowerCase() || undefined;
  const perfil = searchParams.get('perfil')?.trim() || undefined;
  const acciones = searchParams.getAll('accion').map((a) => a.trim()).filter(Boolean);

  const limitRaw = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

  const cursor = searchParams.get('cursor')?.trim() || undefined;

  const resultado = await listarAuditoria({
    desde,
    hasta,
    actor,
    perfil,
    acciones: acciones.length > 0 ? acciones : undefined,
    limit,
    cursor,
  });

  return NextResponse.json({ ...resultado, desde, hasta });
}
