import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Funcionalidad "Estado del chat": en qué punto de atención está una
 * conversación — tabla "conversaciones-estado" en DynamoDB, partición
 * `threadKey` (mismo identificador que threadKeyFor en inbox-data.ts, y que
 * ya usan "conversaciones-zonas" y "conversaciones-ai-config"), atributo
 * `estado`. Mismo patrón de cliente que esos dos: sin credenciales
 * explícitas (cadena de credenciales por defecto de AWS), misma región.
 */
export const ASSIGNABLE_STATUSES = ['Nuevo', 'En proceso', 'Cerrado'] as const;

export type ChatStatus = (typeof ASSIGNABLE_STATUSES)[number];

export function isValidStatus(value: string): value is ChatStatus {
  return (ASSIGNABLE_STATUSES as readonly string[]).includes(value);
}

const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const STATUS_TABLE = 'conversaciones-estado';

/**
 * A pedido del usuario: un chat sin fila todavía en la tabla se trata como
 * "Nuevo" (no como "sin estado") — no hace falta escribir nada hasta que
 * alguien lo cambie a mano.
 */
export async function getStatus(threadKey: string): Promise<ChatStatus> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: STATUS_TABLE, Key: { threadKey } })
    );
    const estado = result.Item?.estado;
    return typeof estado === 'string' && isValidStatus(estado) ? estado : 'Nuevo';
  } catch (error) {
    console.error('No se pudo consultar "conversaciones-estado" en DynamoDB:', error);
    return 'Nuevo';
  }
}

/**
 * Trae toda la tabla de una, para pintar la etiqueta de cualquier chat sin
 * pedirla uno por uno — la usa /api/conversation-status. Solo incluye las
 * filas que sí existen (un chat sin fila se interpreta como "Nuevo" del
 * lado del cliente, ver fetchConversationStatuses en inbox-data.ts). Mismo
 * comentario sobre `scan` completo que en conversation-zones.ts.
 */
export async function getAllStatuses(): Promise<Record<string, ChatStatus>> {
  const statuses: Record<string, ChatStatus> = {};
  try {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new ScanCommand({ TableName: STATUS_TABLE, ExclusiveStartKey: lastEvaluatedKey })
      );
      for (const item of result.Items ?? []) {
        if (typeof item.threadKey === 'string' && typeof item.estado === 'string' && isValidStatus(item.estado)) {
          statuses[item.threadKey] = item.estado;
        }
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (error) {
    console.error('No se pudo escanear "conversaciones-estado" en DynamoDB:', error);
  }
  return statuses;
}

export async function setStatus(threadKey: string, estado: ChatStatus): Promise<void> {
  await dynamoClient.send(
    new PutCommand({ TableName: STATUS_TABLE, Item: { threadKey, estado } })
  );
}
