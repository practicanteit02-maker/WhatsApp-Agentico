import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Funcionalidad "Respuestas rápidas": atajos de texto fijo que se insertan
 * en el chat escribiendo "/" (ver message-view.tsx) — tabla
 * "respuestas-rapidas" en DynamoDB, partición `atajo` (ej. "saludo"),
 * atributo `mensaje` (el texto a insertar). Mismo patrón de cliente que el
 * resto de los lib/*.ts de este proyecto (panel-users.ts,
 * conversation-zones.ts, chat-status.ts): sin credenciales explícitas
 * (cadena de credenciales por defecto de AWS), misma región.
 *
 * Se usa `atajo` como clave (en vez de un id autogenerado), igual que
 * `correo` en usuarios-panel o `threadKey` en el resto de las tablas de
 * este proyecto — es el único identificador natural que ya existe, y nada
 * en el proyecto usa ids autogenerados. El costo de esa decisión es que
 * "renombrar" un atajo no es una operación in-place de DynamoDB (una clave
 * de partición no se actualiza, hay que borrar y crear de nuevo) — por eso
 * el formulario de edición (ver quick-reply-manager.tsx) no permite
 * cambiar el atajo de uno ya creado, solo su mensaje.
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const QUICK_REPLIES_TABLE = 'respuestas-rapidas';

export type QuickReply = {
  atajo: string;
  mensaje: string;
};

export async function getQuickReply(atajo: string): Promise<QuickReply | undefined> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: QUICK_REPLIES_TABLE, Key: { atajo } })
    );
    if (!result.Item || typeof result.Item.mensaje !== 'string') return undefined;
    return { atajo, mensaje: result.Item.mensaje };
  } catch (error) {
    console.error('No se pudo consultar "respuestas-rapidas" en DynamoDB:', error);
    return undefined;
  }
}

/** Trae toda la tabla — la usa tanto el endpoint (GET /api/respuestas-rapidas)
 * como, del otro lado, tanto el menú "/" en el chat como la pantalla de
 * gestión. Un `scan` completo es razonable acá porque la tabla es chica
 * (un atajo por fila, no por mensaje ni por conversación). */
export async function getAllQuickReplies(): Promise<QuickReply[]> {
  const quickReplies: QuickReply[] = [];
  try {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new ScanCommand({ TableName: QUICK_REPLIES_TABLE, ExclusiveStartKey: lastEvaluatedKey })
      );
      for (const item of result.Items ?? []) {
        if (typeof item.atajo === 'string' && typeof item.mensaje === 'string') {
          quickReplies.push({ atajo: item.atajo, mensaje: item.mensaje });
        }
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (error) {
    console.error('No se pudo escanear "respuestas-rapidas" en DynamoDB:', error);
  }
  return quickReplies.sort((a, b) => a.atajo.localeCompare(b.atajo));
}

export async function setQuickReply(atajo: string, mensaje: string): Promise<void> {
  await dynamoClient.send(
    new PutCommand({ TableName: QUICK_REPLIES_TABLE, Item: { atajo, mensaje } })
  );
}

export async function deleteQuickReply(atajo: string): Promise<void> {
  await dynamoClient.send(
    new DeleteCommand({ TableName: QUICK_REPLIES_TABLE, Key: { atajo } })
  );
}
