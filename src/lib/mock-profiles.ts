// Funcionalidad "Perfil": lista de perfiles para el menú de cuenta — sigue
// sin haber una sesión real por detrás (cualquiera puede elegir cualquiera,
// no hay contraseña ni verificación), pero desde la funcionalidad "Candado
// de chat" (ver src/lib/chat-collab.ts) dejó de ser puramente cosmético:
// ahora sí determina quién puede escribir en cada chat y qué nombre queda
// registrado como remitente de cada mensaje que se manda. El color/inicial
// de cada uno se usa en esas mismas pantallas (barra de "quién atiende este
// chat", etiqueta de remitente sobre cada burbuja).
export const MOCK_ACCOUNT_PROFILES = [
  'Administrador',
  'Secretaria',
  'Ventas',
  'Soporte',
] as const;

export type MockAccountProfile = (typeof MOCK_ACCOUNT_PROFILES)[number];

type ProfileStyle = { initial: string; color: string };

const PROFILE_STYLES: Record<MockAccountProfile, ProfileStyle> = {
  Administrador: { initial: 'A', color: 'rgb(111, 0, 255)' },
  Secretaria: { initial: 'S', color: 'rgb(34, 160, 107)' },
  Ventas: { initial: 'V', color: '#2f8fd8' },
  Soporte: { initial: 'So', color: 'rgb(200, 138, 13)' },
};

const FALLBACK_STYLE: ProfileStyle = { initial: '?', color: 'var(--muted-foreground)' };

export function getProfileStyle(profile: string): ProfileStyle {
  return PROFILE_STYLES[profile as MockAccountProfile] ?? FALLBACK_STYLE;
}
