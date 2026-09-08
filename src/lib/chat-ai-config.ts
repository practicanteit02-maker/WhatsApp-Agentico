import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

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
