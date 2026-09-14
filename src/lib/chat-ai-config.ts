import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Funcionalidad "IA por chat": si la IA debe responder automáticamente al
 * abrir ESE chat en particular (ver el useEffect "Responder solo al abrir
 * el chat" en message-view.tsx) — tabla "conversaciones-ai-config" en
 * DynamoDB, partición `threadKey` (mismo identificador que threadKeyFor en
 * inbox-data.ts, y que ya usa "conversaciones-zonas"), atributo
 * `aiEnabled` (boolean). Mismo patrón de cliente que
 * src/lib/conversation-zones.ts: sin credenciales explícitas (cadena de
 * credenciales por defecto de AWS), misma región.
 *
 * Un chat sin fila todavía en la tabla se trata como apagado — a pedido
 * del usuario, la IA no responde por defecto en un chat nuevo, hay que
 * prenderla a mano desde la interfaz.
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const AI_CONFIG_TABLE = 'conversaciones-ai-config';

export async function getAiEnabled(threadKey: string): Promise<boolean> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: AI_CONFIG_TABLE, Key: { threadKey } })
    );
    return result.Item?.aiEnabled === true;
  } catch (error) {
    console.error('No se pudo consultar "conversaciones-ai-config" en DynamoDB:', error);
    // Falla cerrado: si no se puede confirmar que está prendida, se trata
    // como apagada (mismo criterio conservador que el default sin fila).
    return false;
  }
}

/**
 * Trae toda la tabla de una, para pintar el estado del interruptor de
 * cualquier chat sin pedirlo uno por uno — la usa /api/chat-ai-config. Ver
 * el mismo comentario sobre `scan` completo en conversation-zones.ts:
 * razonable mientras la tabla sea chica (una fila por chat con la IA
 * tocada alguna vez, no por mensaje).
 */
export async function getAllAiEnabled(): Promise<Record<string, boolean>> {
  const config: Record<string, boolean> = {};
  try {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new ScanCommand({ TableName: AI_CONFIG_TABLE, ExclusiveStartKey: lastEvaluatedKey })
      );
      for (const item of result.Items ?? []) {
        if (typeof item.threadKey === 'string') {
          config[item.threadKey] = item.aiEnabled === true;
        }
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (error) {
    console.error('No se pudo escanear "conversaciones-ai-config" en DynamoDB:', error);
  }
  return config;
}

export async function setAiEnabled(threadKey: string, aiEnabled: boolean): Promise<void> {
  await dynamoClient.send(
    new PutCommand({ TableName: AI_CONFIG_TABLE, Item: { threadKey, aiEnabled } })
  );
}

// Lock compartido entre esta app (Groq, ver sendAutoReply en auto-reply.ts,
// llamado desde /api/messages/trigger-ai-reply) y whatsapp-agente-lambda
// (Gemini, ver adquirirLockRespuestaIA en index.mjs de ese repo) para que un
// mismo threadKey nunca reciba dos respuestas de IA independientes: hoy el
// webhook "kapso" de Kapso le pega directo a esa Lambda en CADA mensaje
// entrante (sin pasar por este panel — confirmado listando los webhooks
// registrados: no hay ninguno apuntando a este dominio en producción),
// mientras que este panel dispara su propia respuesta cuando un agente abre
// ese mismo chat con el último mensaje sin responder. Ninguno de los dos
// sabía del otro — claimMessageId (auto-reply.ts) solo protege contra
// reintentos DENTRO de este mismo repo, no contra la Lambda.
//
// Vive en la MISMA tabla "conversaciones-ai-config" (fila aparte, prefijo
// "lock#" sobre el threadKey, para no chocar con la fila {threadKey,
// aiEnabled} de ese chat) a pedido explícito — ambos lados ya comparten esa
// tabla y calculan el threadKey con el mismo formato (ver threadKeyFor() en
// inbox-data.ts y construirThreadKey() en index.mjs del otro repo: bsuid con
// prioridad si existe, si no el teléfono con solo dígitos, seguido de ":" +
// phoneNumberId) — confirmado carácter por carácter antes de implementar esto.
//
// El TTL nativo de DynamoDB (atributo `ttl`, si la tabla lo tiene habilitado)
// se agrega solo como limpieza de fondo, NO como el mecanismo real de
// expiración: ese TTL nativo puede tardar minutos u horas en barrer una fila
// vencida, nada garantiza que lo haga a los 30s exactos. La expiración real
// la hace la propia ConditionExpression de abajo, comparando `expiresAt`
// (epoch en milisegundos) contra la hora actual — así que aunque la fila del
// lock quede viva más tiempo del esperado, deja de bloquear a nadie apenas
// pasan los 30s.
const AI_REPLY_LOCK_TTL_MS = 30_000;
const AI_REPLY_LOCK_PREFIX = 'lock#';

/**
 * Intenta tomar el lock de respuesta de IA para este threadKey. Devuelve
 * `true` si se obtuvo (nadie más lo tenía, o el que había ya expiró) — en
 * ese caso hay que liberarlo con releaseAiReplyLock() apenas se termine de
 * responder (o de fallar al intentarlo). Devuelve `false` si el otro sistema
 * (la Lambda, vía Gemini) ya lo tiene tomado — en ese caso hay que abortar
 * sin llamar a Groq ni mandar nada.
 */
export async function acquireAiReplyLock(threadKey: string): Promise<boolean> {
  const now = Date.now();
  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: AI_CONFIG_TABLE,
        Item: {
          threadKey: `${AI_REPLY_LOCK_PREFIX}${threadKey}`,
          expiresAt: now + AI_REPLY_LOCK_TTL_MS,
          ttl: Math.floor((now + AI_REPLY_LOCK_TTL_MS) / 1000),
        },
        ConditionExpression: 'attribute_not_exists(threadKey) OR expiresAt < :now',
        ExpressionAttributeValues: { ':now': now },
      })
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return false;
    }
    // Falla de Dynamo en sí (no del lock): no le negamos la respuesta al
    // cliente por un problema de infraestructura ajeno al lock — mismo
    // criterio conservador que getAiEnabled más arriba, pero acá el lado
    // seguro es DEJAR pasar (en el peor caso, si el otro lado también falla
    // igual, se duplica una respuesta en vez de no responder ninguna).
    console.error('No se pudo adquirir el lock de respuesta de IA en DynamoDB:', error);
    return true;
  }
}

export async function releaseAiReplyLock(threadKey: string): Promise<void> {
  try {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: AI_CONFIG_TABLE,
        Key: { threadKey: `${AI_REPLY_LOCK_PREFIX}${threadKey}` },
      })
    );
  } catch (error) {
    console.error('No se pudo liberar el lock de respuesta de IA en DynamoDB:', error);
  }
}
