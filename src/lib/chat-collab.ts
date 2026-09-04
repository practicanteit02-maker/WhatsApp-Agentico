import { emitChatCollabUpdate, type ChatPresenceState } from '@/lib/event-bus';

/**
 * Funcionalidad "Quién está escribiendo": quién tiene texto sin mandar en
 * cada chat ahora mismo, y quién mandó cada mensaje — server-only, en
 * memoria del proceso de Node (mismo patrón que inboxEventBus en
 * event-bus.ts: se guarda en globalThis para que el fast-refresh de Next en
 * desarrollo no cree una segunda instancia desconectada de la anterior). No
 * hay base de datos en este proyecto todavía, y esto no necesita sobrevivir
 * a un reinicio del servidor — es puramente informativo entre compañeros
 * que ya pueden ver todas las conversaciones.
 *
 * Antes esto era un "candado de chat" de verdad (un perfil "tomaba" el
 * chat y los demás tenían que pedir acceso y ser aceptados para poder
 * escribir) — se sacó esa parte a pedido explícito del usuario: ahora
 * cualquiera puede mandar un mensaje en cualquier momento, esto solo avisa
 * quién está escribiendo.
 */
const globalForChatCollab = globalThis as unknown as {
  chatPresence?: Map<string, ChatPresenceState>;
  chatAttribution?: Map<string, string>;
};

const presence: Map<string, ChatPresenceState> = globalForChatCollab.chatPresence ?? new Map();
const attribution: Map<string, string> = globalForChatCollab.chatAttribution ?? new Map();

if (!globalForChatCollab.chatPresence) globalForChatCollab.chatPresence = presence;
if (!globalForChatCollab.chatAttribution) globalForChatCollab.chatAttribution = attribution;

// Cuánto dura "está escribiendo" sin que el compositor mande otro aviso —
// tiene que aguantar una pausa normal (pensar qué escribir, revisar algo)
// sin desaparecer y volver a aparecer todo el tiempo. Cada tecla reinicia
// este plazo, así que mientras se siga escribiendo de verdad nunca llega a
// cumplirse — solo se cumple cuando alguien deja de escribir en serio.
const TYPING_TTL_MS = 8_000;

const EMPTY_PRESENCE: ChatPresenceState = { typingBy: null, typingUntil: null };

export function getState(threadKey: string): ChatPresenceState {
  return presence.get(threadKey) ?? EMPTY_PRESENCE;
}

export function setTyping(threadKey: string, profile: string) {
  const next: ChatPresenceState = { typingBy: profile, typingUntil: Date.now() + TYPING_TTL_MS };
  presence.set(threadKey, next);
  emitChatCollabUpdate({ threadKey, presence: next });
}

export function recordAttribution(threadKey: string, messageId: string, profile: string) {
  attribution.set(messageId, profile);
  emitChatCollabUpdate({ threadKey, attribution: { messageId, profile } });
}

export function getAttribution(messageIds: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const id of messageIds) {
    const profile = attribution.get(id);
    if (profile) result[id] = profile;
  }

  return result;
}
