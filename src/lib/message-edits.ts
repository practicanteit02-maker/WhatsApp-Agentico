import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Funcionalidad "Mostrar cuando un cliente edita un mensaje" — lado de
 * lectura. La escritura vive fuera de este repo, en el handler aislado
 * webhook-meta-log.mjs del proyecto whatsapp-agente-lambda (procesa el
 * webhook tipo "meta" de Kapso, el payload crudo de Meta que sí trae el
 * evento de edición) — acá solo se consulta lo que ese handler ya guardó.
 *
 * Tabla "ediciones-panel": partición `threadKey` (mismo threadKeyFor() que
 * el resto del panel), sort key `messageId` (el wamid del mensaje
 * ORIGINAL, no el id del evento de edición) — una fila por mensaje editado,
 * se pisa en cada edición nueva al mismo mensaje. Sin historial de
 * versiones, a propósito: solo importa el texto más reciente.
 */
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-2' }));
const EDICIONES_TABLE = 'ediciones-panel';

export type EdicionMensaje = {
  texto: string;
  editadoEn: string;
};

/**
 * Todas las ediciones de un chat de una sola vez (Query por partición
 * `threadKey`) — pensado para pedirse junto con la carga de mensajes de ese
 * chat, no una consulta por mensaje. El volumen esperado por chat es chico
 * (unas pocas ediciones, no una por mensaje), así que no hace falta paginar
 * con LastEvaluatedKey como sí hace falta en tablas de mayor volumen
 * (auditoria-panel, respuestas-panel).
 */
export async function listarEdiciones(threadKey: string): Promise<Record<string, EdicionMensaje>> {
  const mapa: Record<string, EdicionMensaje> = {};

  try {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: EDICIONES_TABLE,
        KeyConditionExpression: '#threadKey = :threadKey',
        ExpressionAttributeNames: { '#threadKey': 'threadKey' },
        ExpressionAttributeValues: { ':threadKey': threadKey },
      })
    );

    for (const item of result.Items ?? []) {
      if (typeof item.messageId === 'string' && typeof item.texto === 'string') {
        mapa[item.messageId] = {
          texto: item.texto,
          editadoEn: typeof item.editadoEn === 'string' ? item.editadoEn : '',
        };
      }
    }
  } catch (error) {
    console.error('No se pudo consultar "ediciones-panel" en DynamoDB:', error);
  }

  return mapa;
}
