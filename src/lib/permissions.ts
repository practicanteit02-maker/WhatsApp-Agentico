/**
 * Sistema centralizado de permisos por rol (RBAC) para Conversaciones y
 * Plantillas. Reemplaza cualquier comparación suelta de `perfil ===
 * 'Administrador'` que hubiera repartida por el proyecto — de acá en
 * adelante, cualquier chequeo de "¿puede este rol hacer tal cosa?" pasa por
 * puedeSePuede() (server o cliente), y el único lugar donde vive el nombre
 * literal de cada rol y qué puede hacer es esta matriz.
 *
 * La sección Usuarios (src/app/usuarios, src/app/api/usuarios/route.ts)
 * queda fuera a propósito: sigue siendo exclusiva de Administrador con su
 * propio chequeo, sin pasar por esta matriz.
 */

export type Accion = 'leer' | 'escribir' | 'editar' | 'eliminar';

const ACCIONES: readonly Accion[] = ['leer', 'escribir', 'editar', 'eliminar'];

/**
 * Roles válidos del panel. Reemplaza a los perfiles de ejemplo que tenía
 * mock-profiles.ts (Administrador/Secretaria/Ventas/Soporte) — de acá en
 * adelante, un perfil asignado en la sección Usuarios que no sea uno de
 * estos tres no tiene ningún permiso (ver puedeSePuede: un rol desconocido
 * cae al valor más restrictivo, todo en false).
 */
export const ROLES = ['Administrador', 'Coordinadora', 'QA'] as const;
export type Rol = (typeof ROLES)[number];

/**
 * Matriz de permisos — la tabla que define el proyecto:
 *
 * | Rol           | Leer | Escribir (responder/crear) | Editar (estado/reasignar) | Eliminar |
 * |---------------|------|------------------------------|----------------------------|----------|
 * | Administrador | Sí   | Sí                           | Sí                         | Sí       |
 * | Coordinadora  | Sí   | Sí                           | No                         | No       |
 * | QA            | Sí   | No                           | No                         | No       |
 */
const MATRIZ_PERMISOS: Record<Rol, Record<Accion, boolean>> = {
  Administrador: { leer: true, escribir: true, editar: true, eliminar: true },
  Coordinadora: { leer: true, escribir: true, editar: false, eliminar: false },
  QA: { leer: true, escribir: false, editar: false, eliminar: false },
};

function esRolValido(perfil: string): perfil is Rol {
  return (ROLES as readonly string[]).includes(perfil);
}

/** ¿Este rol puede hacer esta acción? Un perfil que no sea uno de ROLES
 * (sin asignar, o un perfil viejo que ya no existe) no tiene ningún
 * permiso — el valor por defecto es siempre el más restrictivo, nunca el
 * más permisivo. */
export function puedeSePuede(perfil: string, accion: Accion): boolean {
  if (!esRolValido(perfil)) return false;
  return MATRIZ_PERMISOS[perfil][accion];
}

/** Todo lo que este rol puede hacer de una — útil para la UI cuando
 * necesita el conjunto completo en vez de preguntar acción por acción. */
export function accionesPermitidas(perfil: string): Accion[] {
  return ACCIONES.filter((accion) => puedeSePuede(perfil, accion));
}

/**
 * Único lugar del proyecto donde se compara un perfil contra el literal
 * 'Administrador'. Se usa para el puñado de comportamientos que no son
 * exactamente una Accion de la matriz de arriba, pero que hoy dependen de
 * "es Administrador" — el filtro de zona que le muestra todas las
 * conversaciones sin importar su zona asignada (ver checkZoneAccess en
 * conversation-zones.ts, /api/events, /api/conversations) y el selector de
 * "ver todos los números" del header (conversation-list.tsx). No reemplaza
 * a puedeSePuede(): esas pantallas no están preguntando "¿puede escribir?"
 * sino "¿tiene acceso sin restricción de zona?", una pregunta distinta.
 */
export function esAdministrador(perfil: string | undefined | null): boolean {
  return perfil === 'Administrador';
}
