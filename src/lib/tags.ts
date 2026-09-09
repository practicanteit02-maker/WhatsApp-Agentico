import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Funcionalidad "Etiquetar Perfiles": una etiqueta única por conversación
 * (ej. "Modelo X", "Sede Bogotá") para clasificar/filtrar chats — mismo
 * concepto que Zona (src/lib/conversation-zones.ts), salvo que la lista de
 * valores posibles no es un enum fijo en código (ver mock-zones.ts) sino un
 * catálogo editable en DynamoDB. Por eso este archivo maneja DOS tablas en
 * vez de una:
 *
 * - "etiquetas-catalogo": qué etiquetas existen para elegir. Partición
 *   `etiqueta` (el nombre, ej. "Modelo X"), sin otro atributo — a
 *   propósito simple, sin color por etiqueta, mismo criterio que Zona (los
 *   pills de zona tampoco tienen color por-zona, todos comparten el mismo
 *   estilo visual).
 * - "conversaciones-etiqueta": qué etiqueta tiene cada chat. Partición
 *   `threadKey` (el mismo identificador que usan "conversaciones-zonas" y
 *   "conversaciones-ai-config"), atributo `etiqueta`. Un chat sin fila
 *   todavía = sin etiqueta asignada.
 *
 * Mismo patrón de cliente que conversation-zones.ts: sin credenciales
 * explícitas (cadena de credenciales por defecto de AWS), misma región.
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const TAGS_CATALOG_TABLE = 'etiquetas-catalogo';
const CONVERSATION_TAG_TABLE = 'conversaciones-etiqueta';

// --- Catálogo de etiquetas disponibles ---

/** Trae todo el catálogo — lo usan tanto /api/tags-catalog como la
 * validación de /api/conversation-tag (para no dejar asignar una etiqueta
 * que no exista). Un `scan` completo es razonable acá porque la tabla es
 * chica (una fila por etiqueta, no por chat ni por mensaje). */
export async function getTagsCatalog(): Promise<string[]> {
  const tags: string[] = [];
  try {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new ScanCommand({ TableName: TAGS_CATALOG_TABLE, ExclusiveStartKey: lastEvaluatedKey })
      );
      for (const item of result.Items ?? []) {
        if (typeof item.etiqueta === 'string') {
          tags.push(item.etiqueta);
        }
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (error) {
    console.error('No se pudo escanear "etiquetas-catalogo" en DynamoDB:', error);
  }
  return tags.sort((a, b) => a.localeCompare(b));
}

export async function tagExistsInCatalog(etiqueta: string): Promise<boolean> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: TAGS_CATALOG_TABLE, Key: { etiqueta } })
    );
    return Boolean(result.Item);
  } catch (error) {
    console.error('No se pudo consultar "etiquetas-catalogo" en DynamoDB:', error);
    return false;
  }
}

export async function addTagToCatalog(etiqueta: string): Promise<void> {
  await dynamoClient.send(
    new PutCommand({ TableName: TAGS_CATALOG_TABLE, Item: { etiqueta } })
  );
}

export async function deleteTagFromCatalog(etiqueta: string): Promise<void> {
  await dynamoClient.send(
    new DeleteCommand({ TableName: TAGS_CATALOG_TABLE, Key: { etiqueta } })
  );
}

// --- Etiqueta asignada a cada chat ---

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
