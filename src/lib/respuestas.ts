import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { auth } from '@/auth';

/**
 * Base para la futura funcionalidad "Tiempo de respuesta por persona": deja
 * registro de cada mensaje saliente que manda una persona del equipo, para
 * más adelante poder calcular cuánto tardó cada quien en responder. Kapso no
 * sirve como fuente para esto — el remitente de un saliente en la API de
 * WhatsApp es siempre "el número de la empresa", nunca distingue qué persona
 * del equipo lo mandó (confirmado revisando /api/messages/[conversationId]).
 * El otro lado (cuándo llegó el mensaje del cliente) sí es consultable ya
 * mismo desde ahí — no hace falta duplicarlo acá salvo el snapshot opcional
 * de abajo.
 *
 * Tabla "respuestas-panel" — mismo patrón time-series que auditoria-panel
 * (ver src/lib/auditoria.ts): partición `dia` (YYYY-MM-DD en America/Bogota)
 * + ordenación `ts` (ISO-8601 UTC + sufijo aleatorio). Se usa el mismo
 * diseño a propósito (el equipo ya lo conoce), aunque el volumen acá puede
 * crecer más rápido que en auditoria-panel: esto registra CADA mensaje
 * saliente, no solo acciones administrativas — si el volumen de mensajes
 * crece mucho, este particionado por día es lo primero a revisar.
 *
 * Mismo patrón de cliente que el resto de src/lib/*.ts: sin credenciales
 * explícitas (cadena de credenciales por defecto de AWS), misma región. El
 * rol de Amplify (AmplifySSRLoggingRole) necesita `PutItem` sobre esta
 * tabla (y más adelante `Query`, cuando exista la pantalla de reportes).
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const RESPUESTAS_TABLE = 'respuestas-panel';
const ZONA_HORARIA = 'America/Bogota';

/** Los 3 endpoints que representan "el equipo le respondió al cliente" —
 * sin sub-tipos por ahora (ej. texto vs. imagen quedan bajo 'texto'). */
export type CanalRespuesta = 'texto' | 'plantilla' | 'interactivo';

type EntradaRespuesta = {
  threadKey: string;
  canal: CanalRespuesta;
  /** Id del mensaje que devuelve Kapso al mandarlo — para cruzar con su
   * historial más adelante si hace falta. Opcional: no todos los caminos de
   * envío devuelven un id reconocible. */
  mensajeId?: string;
  /**
   * Snapshot de "cuánto pasó desde el último mensaje del cliente en este
   * chat", calculado del lado del CLIENTE (message-view.tsx ya tiene los
   * mensajes del hilo cargados en memoria en el momento de enviar — no hace
   * falta una consulta extra a Kapso en el camino caliente del envío). Es un
   * dato analítico de bajo riesgo, no algo de seguridad, así que se confía
   * en lo que manda el cliente — se valida acá que sea un número finito no
   * negativo, y se descarta si no lo es. Si no viene (ej. TemplateComposer,
   * que no tiene el hilo cargado, o el primer saliente de un chat nuevo sin
   * ningún inbound previo), el registro se guarda igual, solo sin este dato
   * — se puede recalcular después cruzando contra el historial real de
   * Kapso (ver el comentario grande de arriba).
   */
  segundosDesdeUltimoInbound?: number | null;
  /** El `createdAt` del mensaje del cliente que se usó para el cálculo de
   * arriba — queda de respaldo/auditable, no como fuente de verdad. */
  ultimoInboundEn?: string | null;
};

function diaBogota(fecha: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(fecha);
}

function sufijoAleatorio(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Intenta sacar el id del mensaje de lo que devuelve Kapso al mandarlo —
 * misma lógica que extractSentMessageId() en message-view.tsx (duplicada acá
 * a propósito: ese vive en el cliente, esto corre en el servidor, y son
 * formas de respuesta ligeramente distintas según el endpoint). Devuelve
 * undefined si no reconoce ninguna forma conocida, nunca lanza.
 */
export function extractMensajeId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const value = result as {
    messages?: Array<{ id?: unknown }>;
    messageId?: unknown;
    id?: unknown;
  };
  const fromMessages = value.messages?.find((m) => typeof m?.id === 'string')?.id;
  if (typeof fromMessages === 'string') return fromMessages;
  if (typeof value.messageId === 'string') return value.messageId;
  if (typeof value.id === 'string') return value.id;
  return undefined;
}

/**
 * Registra que `actor` (de la sesión actual) le mandó un mensaje al cliente
 * en `threadKey`. Se llama SIEMPRE después de que Kapso confirmó el envío,
 * justo antes de responder — nunca lanza (try/catch + console.error, mismo
 * criterio que registrarAuditoria()): si falla este registro, el mensaje ya
 * se mandó de verdad, esto no puede bloquear ni romper el envío.
 */
export async function registrarRespuesta(entrada: EntradaRespuesta): Promise<void> {
  try {
    const session = await auth();
    const actor = session?.user?.email ?? 'desconocido';
    const actorPerfil = session?.user?.perfil ?? 'Sin asignar';

    const ahora = new Date();
    const fecha = ahora.toISOString();
    const dia = diaBogota(ahora);
    const ts = `${fecha}#${sufijoAleatorio()}`;

    const item: Record<string, unknown> = {
      dia,
      ts,
      fecha,
      threadKey: entrada.threadKey,
      actor,
      actorPerfil,
      canal: entrada.canal,
    };
    if (entrada.mensajeId) item.mensajeId = entrada.mensajeId;
    if (
      typeof entrada.segundosDesdeUltimoInbound === 'number' &&
      Number.isFinite(entrada.segundosDesdeUltimoInbound) &&
      entrada.segundosDesdeUltimoInbound >= 0
    ) {
      item.segundosDesdeUltimoInbound = Math.round(entrada.segundosDesdeUltimoInbound);
      if (entrada.ultimoInboundEn) item.ultimoInboundEn = entrada.ultimoInboundEn;
    }

    await dynamoClient.send(new PutCommand({ TableName: RESPUESTAS_TABLE, Item: item }));
  } catch (error) {
    console.error('No se pudo registrar en "respuestas-panel" en DynamoDB:', error);
  }
}
