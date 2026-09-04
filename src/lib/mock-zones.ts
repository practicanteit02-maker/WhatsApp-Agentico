// Funcionalidad "Números/Zonas": lista de ejemplo para el menú desplegable
// que aparece junto al título "WhatsApp" — igual que MOCK_ACCOUNT_PROFILES
// (ver mock-profiles.ts), es solo un adelanto visual de cómo se van a poder
// agrupar los números de WhatsApp conectados (por ciudad, externos, etc.)
// una vez que exista el sistema real de roles/zonas. Elegir una opción acá
// todavía no filtra ni cambia nada más en la app — ver activeZone en
// conversation-list.tsx.
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

// Zonas "reales" que un número puede tener (todo MOCK_ZONE_OPTIONS menos la
// opción especial "Todos mis números", que es solo el filtro para verlos
// todos, no una zona en sí).
const ASSIGNABLE_ZONES = MOCK_ZONE_OPTIONS.filter((zone) => zone !== 'Todos mis números');

function isAssignableZone(value: string): value is MockZoneOption {
  return (ASSIGNABLE_ZONES as readonly string[]).includes(value);
}

function computeHashZone(key: string): MockZoneOption {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return ASSIGNABLE_ZONES[hash % ASSIGNABLE_ZONES.length];
}

// Zonas ya conocidas para contactos puntuales, para que no les toque una
// zona al azar (por el hash) la primera vez que corra este código en un
// navegador nuevo (ver el comentario grande sobre ZONE_ASSIGNMENTS_STORAGE_KEY
// más abajo). La clave es la misma que arma threadKeyFor en inbox-data.ts:
// para contactos con business_scoped_user_id (BSUID) es
// "phoneNumberId:bsuid:<businessScopedUserId>"; para contactos con solo
// teléfono es "phoneNumberId:<telefono>".
const SEEDED_ZONE_ASSIGNMENTS: Record<string, MockZoneOption> = {
  // Diego F.
  '1293120233883656:bsuid:CO.1748333106269951': 'Medellín',
  // Mariana🌸
  '1293120233883656:bsuid:CO.997437180020408': 'Medellín',
};

// Funcionalidad "Números/Zonas": la zona de un chat se calculaba solo con
// `hash(key) % ASSIGNABLE_ZONES.length` — un cálculo puro, sin guardar nada.
// El problema: ese resultado depende de CUÁNTAS zonas asignables hay en este
// momento, así que agregar o quitar una zona de MOCK_ZONE_OPTIONS reordena el
// resto del módulo y hace que contactos que ya tenían una zona "salten" a
// otra distinta sin que nadie los haya tocado (así fue como "Mariana" pasó de
// Medellín a Bogotá solo por agregar Bogotá/Cali a la lista). Para que la
// píldora de un chat ya visto no cambie sola nunca más, la primera zona que
// le toca a cada clave de chat se guarda en este navegador (localStorage) y
// se reusa siempre después, sin volver a calcularla — editar
// MOCK_ZONE_OPTIONS de ahí en adelante solo afecta a contactos que todavía no
// tenían una zona asignada.
const ZONE_ASSIGNMENTS_STORAGE_KEY = 'whatsapp-cloud-inbox-mock-zone-assignments';
let cachedZoneAssignments: Record<string, string> | null = null;

function loadZoneAssignments(): Record<string, string> {
  if (cachedZoneAssignments) return cachedZoneAssignments;

  let loaded: Record<string, string> = {};
  try {
    const raw = window.localStorage.getItem(ZONE_ASSIGNMENTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    loaded = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Sin localStorage disponible (o durante el render en el servidor): se
    // sigue funcionando con el hash de siempre, solo que sin recordarlo.
    loaded = {};
  }

  cachedZoneAssignments = loaded;
  return loaded;
}

function rememberZoneAssignment(key: string, zone: MockZoneOption) {
  const next = { ...loadZoneAssignments(), [key]: zone };
  cachedZoneAssignments = next;

  try {
    window.localStorage.setItem(ZONE_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Se queda en memoria para esta sesión aunque no se pueda persistir.
  }
}

/**
 * Funcionalidad "Números/Zonas": a qué zona de ejemplo "pertenece" un chat,
 * para la píldora que se muestra en cada fila de la lista. Todavía no existe
 * una asignación real de números a zonas (eso vendrá con el sistema de
 * roles/zonas de verdad) — la primera vez que se ve un chat se le calcula una
 * zona (determinística, a partir de su clave) y desde ahí queda fija para
 * ese chat en este navegador (ver el comentario grande de
 * ZONE_ASSIGNMENTS_STORAGE_KEY arriba).
 */
export function getMockZoneForThreadKey(key: string): MockZoneOption {
  const stored = loadZoneAssignments();
  // SEEDED_ZONE_ASSIGNMENTS va primero: es una asignación fija a propósito
  // (puesta a mano en el código), así que debe ganarle a lo que ya haya
  // quedado guardado en este navegador de una asignación anterior (por
  // ejemplo, del hash automático que corrió antes de agregar el seed).
  const seeded = SEEDED_ZONE_ASSIGNMENTS[key];
  const alreadyAssigned = seeded ?? stored[key];

  if (alreadyAssigned && isAssignableZone(alreadyAssigned)) {
    if (stored[key] !== alreadyAssigned) {
      rememberZoneAssignment(key, alreadyAssigned);
    }
    return alreadyAssigned;
  }

  const zone = computeHashZone(key);
  rememberZoneAssignment(key, zone);
  return zone;
}
