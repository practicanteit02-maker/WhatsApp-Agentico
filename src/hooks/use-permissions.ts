import { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { accionesPermitidas, puedeSePuede, type Accion } from '@/lib/permissions';

/**
 * Envuelve useSession() para que los componentes de UI consulten permisos
 * (ver src/lib/permissions.ts) sin reimplementar la lógica ni comparar
 * perfil === 'Administrador' a mano. perfil cae a 'Sin asignar' mientras la
 * sesión todavía está resolviendo o si el correo no tiene perfil asignado
 * — en ambos casos puede() da false para todo, el default más seguro.
 *
 * Nota: componentes que ya reciben sessionPerfil como prop desde arriba
 * (ver conversation-list.tsx, que además maneja con cuidado el estado de
 * carga de useSession() para evitar una carrera ya arreglada una vez) deben
 * seguir usando ese prop en vez de este hook, para no reintroducir esa
 * carrera con una segunda lectura independiente de la sesión. Este hook es
 * para componentes que hoy no reciben el perfil por props, como
 * message-view.tsx.
 */
export function usePermissions() {
  const { data: session } = useSession();
  const perfil = session?.user?.perfil ?? 'Sin asignar';

  const puede = useMemo(() => (accion: Accion) => puedeSePuede(perfil, accion), [perfil]);
  const acciones = useMemo(() => accionesPermitidas(perfil), [perfil]);

  return { perfil, puede, acciones };
}
