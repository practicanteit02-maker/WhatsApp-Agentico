import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Funcionalidad "System prompt centralizado": el prompt de sistema que usa
 * generateAIResponse (ver src/lib/ai-client.ts) vivía duplicado a mano en
 * este repo y en whatsapp-agente-lambda/index.mjs (constante
 * INSTRUCCION_SISTEMA, repo aparte) — dos copias literales que había que
 * editar una por una y mantener idénticas de memoria, sin nada que avisara
 * si se desincronizaban. Ahora ambos leen el mismo ítem de la tabla
 * "configuracion-ia" en DynamoDB (clave `clave` = "system_prompt", atributo
 * `valor`) — mismo patrón de cliente que src/lib/chat-ai-config.ts: sin
 * credenciales explícitas (cadena de credenciales por defecto de AWS),
 * misma región.
 *
 * Todavía no hay ninguna UI para editarlo — por ahora esto solo centraliza
 * la LECTURA; cambiarlo sigue siendo manual (consola de DynamoDB o un
 * script) hasta que haga falta una pantalla de configuración.
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const CONFIG_TABLE = 'configuracion-ia';
const SYSTEM_PROMPT_KEY = 'system_prompt';

/**
 * Respaldo hardcodeado — el prompt tal como estaba en ai-client.ts antes de
 * centralizarlo. Se usa si la fila todavía no existe en DynamoDB, o si la
 * lectura falla por cualquier motivo (permisos, tabla inexistente, etc.) —
 * fallar "abierto" con el último prompt conocido tiene más sentido acá que
 * fallar cerrado: lo peor que puede pasar es que la IA responda con el
 * prompt de respaldo en vez de no responder nada.
 */
const SYSTEM_PROMPT_FALLBACK =
  'Eres un asistente de atención al cliente por WhatsApp. Responde en español, ' +
  'de forma amable, clara y breve. No inventes información que no conozcas. ' +
  'Solo debes responder preguntas relacionadas con la empresa: sus productos ' +
  'o servicios, pedidos, catálogo, precios, envíos, o soporte al cliente. Si ' +
  'el cliente pregunta algo que no tiene relación con la empresa (temas ' +
  'personales, opiniones generales u otros temas ajenos al negocio), ' +
  'respóndele con amabilidad que solo puedes ayudarlo con temas ' +
  'relacionados a la empresa, sin sonar cortante ni robótico. ' +
  'A continuación verás el historial reciente de esta conversación (mensajes ' +
  'del cliente y tus propias respuestas anteriores) — úsalo para entender el ' +
  'contexto. No vuelvas a saludar ("Hola", "Buenos días", etc.) si la ' +
  'conversación ya estaba en curso; solo saluda si de verdad es el primer ' +
  'mensaje del historial.';

// Caché en memoria — mismo patrón de Map/objeto + TTL que
// getConversationZonaCache en src/app/api/webhooks/whatsapp/route.ts: vive
// en globalThis para sobrevivir la recarga de módulos de Turbopack en
// desarrollo, no solo para ahorrar la consulta a Dynamo en cada mensaje. TTL
// un poco más largo que el de esa caché (8 min): el prompt cambia con mucha
// menos frecuencia que la zona de un chat.
const SYSTEM_PROMPT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

type CachedSystemPrompt = { valor: string; cachedAt: number };

function getSystemPromptCache(): { current?: CachedSystemPrompt } {
  const store = globalThis as unknown as { __systemPromptCache?: { current?: CachedSystemPrompt } };
  if (!store.__systemPromptCache) {
    store.__systemPromptCache = {};
  }
  return store.__systemPromptCache;
}

/**
 * Prompt de sistema vigente para generateAIResponse — de la caché si no
 * venció, si no de "configuracion-ia" en DynamoDB (y ahí se cachea), y si la
 * consulta falla o la fila no existe todavía, del respaldo hardcodeado de
 * arriba.
 */
export async function getSystemPrompt(): Promise<string> {
  const cache = getSystemPromptCache();
  const cached = cache.current;
  if (cached && Date.now() - cached.cachedAt < SYSTEM_PROMPT_CACHE_TTL_MS) {
    return cached.valor;
  }

  try {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: CONFIG_TABLE, Key: { clave: SYSTEM_PROMPT_KEY } })
    );
    const valor =
      typeof result.Item?.valor === 'string' && result.Item.valor.trim()
        ? result.Item.valor
        : SYSTEM_PROMPT_FALLBACK;
    cache.current = { valor, cachedAt: Date.now() };
    return valor;
  } catch (error) {
    console.error('No se pudo leer "configuracion-ia" en DynamoDB, usando el prompt de respaldo:', error);
    return SYSTEM_PROMPT_FALLBACK;
  }
}
