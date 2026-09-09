import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Funcionalidad "Etiquetar Perfiles": una etiqueta de texto libre por
 * conversación (como una nota corta, ej. "Modelo X", "Sede Bogotá") para
 * clasificar/identificar chats — mismo concepto que Zona
 * (src/lib/conversation-zones.ts) en que es un único valor reasignable por
 * chat, pero sin catálogo predefinido: cualquiera con permiso "escribir"
 * escribe el texto que quiera directamente sobre el chat (ver
 * /api/conversation-tag/route.ts, que valida no-vacío y longitud máxima).
 *
 * Tabla "conversaciones-etiqueta": partición `threadKey` (el mismo
 * identificador que usan "conversaciones-zonas" y "conversaciones-ai-config"),
 * atributo `etiqueta`. Un chat sin fila todavía = sin etiqueta asignada.
 *
 * Nota: este archivo manejaba antes también un catálogo compartido de
 * etiquetas ("etiquetas-catalogo") — se eliminó ese concepto a pedido
 * explícito (etiqueta = texto libre, no una lista de donde elegir). La
 * tabla "etiquetas-catalogo" puede seguir existiendo en DynamoDB sin uso, no
 * hace falta borrarla.
 *
 * Mismo patrón de cliente que conversation-zones.ts: sin credenciales
 * explícitas (cadena de credenciales por defecto de AWS), misma región.
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const CONVERSATION_TAG_TABLE = 'conversaciones-etiqueta';

export async function getConversationTag(threadKey: string): Promise<string | undefined> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: CONVERSATION_TAG_TABLE, Key: { threadKey } })
    );
    return typeof result.Item?.etiqueta === 'string' ? result.Item.etiqueta : undefined;
  } catch (error) {
    console.error('No se pudo consultar "conversaciones-etiqueta" en DynamoDB:', error);
    return undefined;
  }
}

/** Trae toda la tabla de una — mismo criterio que getAllZones()/
 * getAllStatuses(): razonable mientras la tabla sea chica (una fila por
 * chat con etiqueta asignada alguna vez, no por mensaje). */
export async function getAllConversationTags(): Promise<Record<string, string>> {
  const tags: Record<string, string> = {};
  try {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new ScanCommand({ TableName: CONVERSATION_TAG_TABLE, ExclusiveStartKey: lastEvaluatedKey })
      );
      for (const item of result.Items ?? []) {
        if (typeof item.threadKey === 'string' && typeof item.etiqueta === 'string') {
          tags[item.threadKey] = item.etiqueta;
        }
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (error) {
    console.error('No se pudo escanear "conversaciones-etiqueta" en DynamoDB:', error);
  }
  return tags;
}

export async function setConversationTag(threadKey: string, etiqueta: string): Promise<void> {
  await dynamoClient.send(
    new PutCommand({ TableName: CONVERSATION_TAG_TABLE, Item: { threadKey, etiqueta } })
  );
}

/** "Quitar etiqueta" — borra la fila entera (a diferencia de guardar una
 * etiqueta vacía, que /api/conversation-tag rechaza). */
export async function deleteConversationTag(threadKey: string): Promise<void> {
  await dynamoClient.send(
    new DeleteCommand({ TableName: CONVERSATION_TAG_TABLE, Key: { threadKey } })
  );
}
