import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { auth } from '@/auth';

/**
 * Zona real de cada conversación (reemplaza el sistema mock de
 * src/lib/mock-zones.ts) — tabla "conversaciones-zonas" en DynamoDB,
 * partición `threadKey` (el mismo identificador que arma threadKeyFor en
 * inbox-data.ts), atributo `zona`. Mismo patrón de cliente que
 * lookupPerfilYZona en src/auth.ts: sin credenciales explícitas (cadena de
 * credenciales por defecto de AWS), misma región.
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const ZONES_TABLE = 'conversaciones-zonas';

export async function getZone(threadKey: string): Promise<string | undefined> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({ TableName: ZONES_TABLE, Key: { threadKey } })
    );
    return typeof result.Item?.zona === 'string' ? result.Item.zona : undefined;
  } catch (error) {
    console.error('No se pudo consultar "conversaciones-zonas" en DynamoDB:', error);
    return undefined;
  }
}

/**
 * Trae toda la tabla de una — la usan tanto el endpoint de lectura
 * (/api/conversation-zones) como el filtro de la lista de chats
 * (/api/conversations). Un `scan` completo es razonable acá porque la tabla
 * es chica (una fila por conversación con zona asignada, no por mensaje); si
 * algún día crece mucho, esto necesitaría paginar con `LastEvaluatedKey`.
 */
export async function getAllZones(): Promise<Record<string, string>> {
  const zones: Record<string, string> = {};
  try {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new ScanCommand({ TableName: ZONES_TABLE, ExclusiveStartKey: lastEvaluatedKey })
      );
      for (const item of result.Items ?? []) {
        if (typeof item.threadKey === 'string' && typeof item.zona === 'string') {
          zones[item.threadKey] = item.zona;
        }
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (error) {
    console.error('No se pudo escanear "conversaciones-zonas" en DynamoDB:', error);
  }
  return zones;
}

export async function setZone(threadKey: string, zona: string): Promise<void> {
  await dynamoClient.send(
    new PutCommand({ TableName: ZONES_TABLE, Item: { threadKey, zona } })
  );
}

export type ZoneAccessResult =
  | { allowed: true }
  | { allowed: false; status: 401 | 403; error: string };

/**
 * Chequeo de acceso reutilizado por todos los endpoints que exponen o actúan
 * sobre un chat puntual (mensajes, envío, reacciones, botones, plantillas,
 * media): Administrador pasa siempre. Cualquier otro perfil solo pasa si la
 * zona real de ese chat coincide con su propia zona — sin sesión, sin zona
 * asignada todavía, o zona distinta, se niega. Nunca confía en nada que
 * mande el cliente sobre quién es: la sesión sale de `auth()`, server-side.
 */
export async function checkZoneAccess(threadKey: string): Promise<ZoneAccessResult> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, status: 401, error: 'No autenticado' };
  }

  if (session.user.perfil === 'Administrador') {
    return { allowed: true };
  }

  const zona = await getZone(threadKey);
  if (zona && zona === session.user.zona) {
    return { allowed: true };
  }

  return { allowed: false, status: 403, error: 'No tenés acceso a esta conversación' };
}
