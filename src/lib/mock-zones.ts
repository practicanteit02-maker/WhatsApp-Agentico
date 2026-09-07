// Lista de zonas asignables (Números/Zonas) — la zona real de cada
// conversación ahora vive en DynamoDB (ver src/lib/conversation-zones.ts),
// pero esta sigue siendo la lista de nombres válidos: la usan el selector de
// vista del header (ver activeZone en conversation-list.tsx), el selector de
// asignación por chat (solo Administrador), y la validación del endpoint
// /api/conversation-zones.
export const MOCK_ZONE_OPTIONS = [
  'Todos mis números',
  'Medellín',
  'Pereira',
  'Bogotá',
  'Cali',
  'Externos',
  'Global',
] as const;

export type MockZoneOption = (typeof MOCK_ZONE_OPTIONS)[number];

// Zonas asignables a un chat — todo MOCK_ZONE_OPTIONS menos "Todos mis
// números", que es el filtro especial para verlos todos, no una zona en sí.
const ASSIGNABLE_ZONES = MOCK_ZONE_OPTIONS.filter((zone) => zone !== 'Todos mis números');

export type AssignableZone = (typeof ASSIGNABLE_ZONES)[number];

export function isAssignableZone(value: string): value is AssignableZone {
  return (ASSIGNABLE_ZONES as readonly string[]).includes(value);
}

export function getAssignableZones(): readonly AssignableZone[] {
  return ASSIGNABLE_ZONES;
}
