// Funcionalidad "Perfil": lista de perfiles para el menú de cuenta — sigue
// sin haber una sesión real por detrás (cualquiera puede elegir cualquiera,
// no hay contraseña ni verificación), pero desde la funcionalidad "Candado
// de chat" (ver src/lib/chat-collab.ts) dejó de ser puramente cosmético:
// ahora sí determina quién puede escribir en cada chat y qué nombre queda
// registrado como remitente de cada mensaje que se manda. El color/inicial
// de cada uno se usa en esas mismas pantallas (barra de "quién atiende este
// chat", etiqueta de remitente sobre cada burbuja).
//
// Los tres perfiles son exactamente los roles del sistema de permisos (ver
// src/lib/permissions.ts) — se reexportan como MOCK_ACCOUNT_PROFILES en vez
// de definirse de nuevo acá para que no haya dos listas de roles que puedan
// desincronizarse.
import { normalizarRol, ROLES, type Rol } from '@/lib/permissions';

export const MOCK_ACCOUNT_PROFILES = ROLES;

export type MockAccountProfile = Rol;

type ProfileStyle = { initial: string; color: string };

const PROFILE_STYLES: Record<MockAccountProfile, ProfileStyle> = {
  Administrador: { initial: 'A', color: 'rgb(220, 38, 38)' },
  Coordinadora: { initial: 'C', color: 'rgb(34, 160, 107)' },
  QA: { initial: 'QA', color: '#2f8fd8' },
};

const FALLBACK_STYLE: ProfileStyle = { initial: '?', color: 'var(--muted-foreground)' };

// Pasa por normalizarRol() (en vez de indexar PROFILE_STYLES directo) para
// que una variante como "Coordinador" (ver ALIAS_ROLES en permissions.ts)
// reciba exactamente el mismo color/inicial que "Coordinadora" — no una
// entrada aparte ni el estilo gris de "rol desconocido".
export function getProfileStyle(profile: string): ProfileStyle {
  const rol = normalizarRol(profile);
  return rol ? PROFILE_STYLES[rol] : FALLBACK_STYLE;
}
