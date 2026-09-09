import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { puedeSePuede, type Accion } from '@/lib/permissions';

/**
 * Chequeo de permiso por acción (ver src/lib/permissions.ts), mismo patrón
 * que requireAdministrador() en src/app/api/usuarios/route.ts: lee la
 * sesión server-side con auth() (nunca confía en nada que mande el
 * cliente), y devuelve un NextResponse listo para retornar si el rol no
 * tiene permiso — o `null` si puede seguir. Reemplaza cualquier
 * `session.user.perfil === 'Administrador'` que hubiera en los endpoints de
 * conversaciones y plantillas.
 *
 * Uso típico en una ruta:
 *   const denegado = await requierePermiso('escribir');
 *   if (denegado) return denegado;
 */
export async function requierePermiso(accion: Accion): Promise<NextResponse | null> {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const perfil = session.user.perfil ?? 'Sin asignar';
  if (!puedeSePuede(perfil, accion)) {
    return NextResponse.json(
      { error: `Tu rol (${perfil}) no tiene permiso para ${accion}` },
      { status: 403 }
    );
  }

  return null;
}
