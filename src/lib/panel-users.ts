import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Cuentas del panel — tabla "usuarios-panel" en DynamoDB (misma tabla que ya
 * usa src/auth.ts para leer perfil/zona al iniciar sesión), partición
 * `correo`, atributos `perfil` y `zona`. Este archivo es el lado de
 * escritura/listado completo (crear, editar, borrar, listar todos), que
 * auth.ts no necesita para su único uso (leer un correo puntual al hacer
 * login) — mismo patrón de cliente sin credenciales explícitas que el resto
 * de los lib/*.ts de este proyecto (conversation-zones.ts, chat-status.ts,
 * chat-ai-config.ts): cadena de credenciales por defecto de AWS.
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const USUARIOS_TABLE = 'usuarios-panel';

export type PanelUser = {
  correo: string;
  perfil: string;
  zona: string;
};

export async function getUser(correo: string): Promise<PanelUser | undefined> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: USUARIOS_TABLE, Key: { correo } })
    );
    if (!result.Item) return undefined;
    return {
      correo,
      perfil: typeof result.Item.perfil === 'string' ? result.Item.perfil : '',
      zona: typeof result.Item.zona === 'string' ? result.Item.zona : '',
    };
  } catch (error) {
    console.error('No se pudo consultar "usuarios-panel" en DynamoDB:', error);
    return undefined;
  }
}

/** Trae toda la tabla — la usa la sección de Ajustes > Usuarios para listar
 * las cuentas existentes. Igual que getAllZones() en conversation-zones.ts,
 * un `scan` completo es razonable acá porque la tabla es chica (una fila por
 * persona del equipo, no por conversación). */
export async function getAllUsers(): Promise<PanelUser[]> {
  const users: PanelUser[] = [];
  try {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new ScanCommand({ TableName: USUARIOS_TABLE, ExclusiveStartKey: lastEvaluatedKey })
      );
      for (const item of result.Items ?? []) {
        if (typeof item.correo === 'string') {
          users.push({
            correo: item.correo,
            perfil: typeof item.perfil === 'string' ? item.perfil : '',
            zona: typeof item.zona === 'string' ? item.zona : '',
          });
        }
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (error) {
    console.error('No se pudo escanear "usuarios-panel" en DynamoDB:', error);
  }
  return users.sort((a, b) => a.correo.localeCompare(b.correo));
}

export async function setUser(correo: string, perfil: string, zona: string): Promise<void> {
  await dynamoClient.send(
    new PutCommand({ TableName: USUARIOS_TABLE, Item: { correo, perfil, zona } })
  );
}

export async function deleteUser(correo: string): Promise<void> {
  await dynamoClient.send(
    new DeleteCommand({ TableName: USUARIOS_TABLE, Key: { correo } })
  );
}
