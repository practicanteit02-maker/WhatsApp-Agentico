import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { auth } from '@/auth';
import { variantesDeRol } from '@/lib/permissions';

/**
 * Funcionalidad "Historial de auditoría": deja registro de quién cambió qué
 * y cuándo en las acciones que ya existen en el panel (cambio de zona/estado
 * de un chat, poner/editar/quitar etiqueta, crear plantilla, crear/editar/
 * eliminar usuario). El caso de uso principal es revisar qué hizo cada
 * Coordinador en una ventana de tiempo.
 *
 * Tabla "auditoria-panel" — a diferencia del resto de las tablas del
 * proyecto (clave simple), esta es time-series con clave compuesta:
 *   - Partición `dia`  (S): fecha `YYYY-MM-DD` en America/Bogota.
 *   - Ordenación `ts`  (S): ISO-8601 UTC + `#` + sufijo aleatorio, para
 *     poder listar cronológicamente dentro de un día y garantizar unicidad.
 * Se lista consultando un `dia` a la vez (Query, más reciente primero) e
 * iterando hacia atrás por el rango de fechas — sin GSI: el filtro por
 * persona/rol/acción va como FilterExpression sobre esa Query, que a este
 * volumen (un puñado de personas, decenas de acciones al día) alcanza de
 * sobra. La paginación usa la última clave (`dia` + `ts`) como cursor.
 *
 * Mismo patrón de cliente que conversation-zones.ts / panel-users.ts: sin
 * credenciales explícitas (cadena de credenciales por defecto de AWS), misma
 * región. El rol de Amplify (AmplifySSRLoggingRole) necesita `PutItem` y
 * `Query` sobre esta tabla.
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const AUDIT_TABLE = 'auditoria-panel';
const ZONA_HORARIA = 'America/Bogota';

export type AccionAuditoria =
  | 'cambio_zona'
  | 'cambio_estado'
  | 'asignar_etiqueta'
  | 'editar_etiqueta'
  | 'quitar_etiqueta'
  | 'crear_plantilla'
  | 'crear_usuario'
  | 'editar_usuario'
  | 'eliminar_usuario';

export type ObjetoAuditoria = 'chat' | 'plantilla' | 'usuario';

export type RegistroAuditoria = {
  dia: string;
  ts: string;
  fecha: string;
  actor: string;
  actorPerfil: string;
  accion: AccionAuditoria;
  objetoTipo: ObjetoAuditoria;
  objetoId: string;
  valorAnterior?: string | null;
  valorNuevo?: string | null;
  detalle?: string;
};

type EntradaAuditoria = {
  accion: AccionAuditoria;
  objetoTipo: ObjetoAuditoria;
  objetoId: string;
  valorAnterior?: string | null;
  valorNuevo?: string | null;
  detalle?: string;
};

/** `YYYY-MM-DD` de una fecha en la zona horaria de Bogotá (en-CA formatea
 * justo así). Se usa tanto para la partición al escribir como para armar el
 * rango de días al leer. */
export function diaBogota(fecha: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(fecha);
}

/** Resta `n` días a una fecha `YYYY-MM-DD` (aritmética de calendario en UTC,
 * sin horas — la cadena ya representa un día de Bogotá). */
export function restarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() - n);
  return fecha.toISOString().slice(0, 10);
}

function sufijoAleatorio(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Registra una acción en "auditoria-panel". Se llama SIEMPRE después de que
 * la mutación real terminó bien, justo antes de responder. Resuelve quién es
 * por su cuenta con auth() (el endpoint no pasa el actor).
 *
 * Nunca lanza: todo va envuelto en try/catch con console.error, igual que
 * getZone()/getAllConversationTags(). Si falla la escritura de auditoría, la
 * acción real ya se hizo y respondió `ok` — la auditoría no puede romper la
 * funcionalidad que audita.
 */
export async function registrarAuditoria(entrada: EntradaAuditoria): Promise<void> {
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
      actor,
      actorPerfil,
      accion: entrada.accion,
      objetoTipo: entrada.objetoTipo,
      objetoId: entrada.objetoId,
    };
    if (entrada.valorAnterior != null) item.valorAnterior = entrada.valorAnterior;
    if (entrada.valorNuevo != null) item.valorNuevo = entrada.valorNuevo;
    if (entrada.detalle) item.detalle = entrada.detalle;

    await dynamoClient.send(new PutCommand({ TableName: AUDIT_TABLE, Item: item }));
  } catch (error) {
    console.error('No se pudo registrar en "auditoria-panel" en DynamoDB:', error);
  }
}

export type FiltrosAuditoria = {
  desde: string;
  hasta: string;
  actor?: string;
  perfil?: string;
  acciones?: string[];
  limit: number;
  cursor?: string;
};

export type ResultadoAuditoria = {
  registros: RegistroAuditoria[];
  nextCursor: string | null;
};

type Cursor = { dia: string; ts: string };

function decodificarCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (typeof parsed?.dia === 'string' && typeof parsed?.ts === 'string') {
      return { dia: parsed.dia, ts: parsed.ts };
    }
  } catch {
    // cursor corrupto: se ignora y se empieza desde el principio
  }
  return undefined;
}

function codificarCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
}

/** Itera las fechas `YYYY-MM-DD` de `hasta` a `desde`, de la más reciente a
 * la más antigua. Tope de seguridad de ~1 año para no barrer sin fin si
 * llegan parámetros absurdos. */
function* diasDescendentes(desde: string, hasta: string): Generator<string> {
  const [hy, hm, hd] = hasta.split('-').map(Number);
  const [dy, dm, dd] = desde.split('-').map(Number);
  const cursor = new Date(Date.UTC(hy, hm - 1, hd));
  const fin = new Date(Date.UTC(dy, dm - 1, dd)).getTime();
  let guarda = 0;
  while (cursor.getTime() >= fin && guarda++ < 400) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
}

function mapearItem(item: Record<string, unknown>): RegistroAuditoria {
  return {
    dia: String(item.dia ?? ''),
    ts: String(item.ts ?? ''),
    fecha: String(item.fecha ?? item.ts ?? ''),
    actor: String(item.actor ?? 'desconocido'),
    actorPerfil: String(item.actorPerfil ?? 'Sin asignar'),
    accion: item.accion as AccionAuditoria,
    objetoTipo: item.objetoTipo as ObjetoAuditoria,
    objetoId: String(item.objetoId ?? ''),
    valorAnterior: typeof item.valorAnterior === 'string' ? item.valorAnterior : undefined,
    valorNuevo: typeof item.valorNuevo === 'string' ? item.valorNuevo : undefined,
    detalle: typeof item.detalle === 'string' ? item.detalle : undefined,
  };
}

/**
 * Lista registros de auditoría del rango de fechas dado, del más reciente al
 * más antiguo, con filtros opcionales y paginación por cursor. Cada día del
 * rango es una Query a su propia partición; el filtro por persona/rol/acción
 * se aplica como FilterExpression. Trae `limit + 1` para saber si hay más y,
 * si los hay, devuelve como cursor la clave del último registro incluido.
 *
 * DynamoDB rechaza con ValidationException cualquier clave de
 * ExpressionAttributeNames que no se use en alguna expresión, así que los
 * nombres se arman por Query: `#dia` siempre; los del filtro solo si ese
 * filtro está activo; y `#ts` solo en el día del cursor (que es el único que
 * lo referencia en la KeyConditionExpression). Toda la lectura va dentro de
 * un try/catch: cualquier error (permisos, tabla inexistente, expresión
 * inválida) se propaga como una excepción con contexto en vez de dejar que
 * el handler devuelva un 500 con cuerpo vacío.
 */
export async function listarAuditoria(filtros: FiltrosAuditoria): Promise<ResultadoAuditoria> {
  const { desde, hasta, actor, perfil, acciones, limit } = filtros;
  const cursor = decodificarCursor(filtros.cursor);

  // Nombres/valores del FILTRO: constantes para todas las Query del rango, y
  // solo se incluyen si su filtro está activo (si no, quedarían sin usar).
  const nombresFiltro: Record<string, string> = {};
  const valoresFiltro: Record<string, unknown> = {};
  const filtroPartes: string[] = [];

  if (actor) {
    nombresFiltro['#actor'] = 'actor';
    filtroPartes.push('#actor = :actor');
    valoresFiltro[':actor'] = actor;
  }
  if (perfil) {
    const variantes = variantesDeRol(perfil);
    if (variantes.length > 0) {
      nombresFiltro['#actorPerfil'] = 'actorPerfil';
      const marcadores = variantes.map((_, i) => `:perfil${i}`);
      variantes.forEach((valor, i) => {
        valoresFiltro[`:perfil${i}`] = valor;
      });
      filtroPartes.push(`#actorPerfil IN (${marcadores.join(', ')})`);
    }
  }
  if (acciones && acciones.length > 0) {
    nombresFiltro['#accion'] = 'accion';
    const marcadores = acciones.map((_, i) => `:accion${i}`);
    acciones.forEach((valor, i) => {
      valoresFiltro[`:accion${i}`] = valor;
    });
    filtroPartes.push(`#accion IN (${marcadores.join(', ')})`);
  }

  const filterExpression = filtroPartes.length > 0 ? filtroPartes.join(' AND ') : undefined;

  const registros: RegistroAuditoria[] = [];
  let alcanzoCursor = !cursor;

  try {
    for (const dia of diasDescendentes(desde, hasta)) {
      if (cursor && !alcanzoCursor) {
        if (dia > cursor.dia) continue;
        alcanzoCursor = true;
      }

      const usarTope = Boolean(cursor && dia === cursor.dia);

      // Nombres/valores/condición de ESTA Query: `#dia` siempre; `#ts` solo
      // en el día del cursor, que es donde se usa en la key condition.
      const nombres: Record<string, string> = { '#dia': 'dia', ...nombresFiltro };
      const valores: Record<string, unknown> = { ...valoresFiltro, ':dia': dia };
      let keyCondition = '#dia = :dia';
      if (usarTope) {
        nombres['#ts'] = 'ts';
        keyCondition += ' AND #ts < :tope';
        valores[':tope'] = cursor!.ts;
      }

      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const salida = await dynamoClient.send(
          new QueryCommand({
            TableName: AUDIT_TABLE,
            KeyConditionExpression: keyCondition,
            FilterExpression: filterExpression,
            ExpressionAttributeNames: nombres,
            ExpressionAttributeValues: valores,
            ExclusiveStartKey: exclusiveStartKey,
            ScanIndexForward: false,
          })
        );
        for (const item of salida.Items ?? []) {
          registros.push(mapearItem(item as Record<string, unknown>));
        }
        exclusiveStartKey = salida.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey && registros.length <= limit);

      if (registros.length > limit) break;
    }
  } catch (error) {
    console.error('No se pudo consultar "auditoria-panel" en DynamoDB:', error);
    throw new Error('No se pudo consultar el historial de auditoría en DynamoDB');
  }

  if (registros.length > limit) {
    const ultimo = registros[limit - 1];
    registros.length = limit;
    return { registros, nextCursor: codificarCursor({ dia: ultimo.dia, ts: ultimo.ts }) };
  }

  return { registros, nextCursor: null };
}

export type AgregadoAuditoria = {
  desde: string;
  hasta: string;
  totalAcciones: number;
  /** Una entrada por persona que hizo al menos una acción en el rango,
   * ordenada de más a menos acciones. `perfil` es el rol más reciente con
   * el que aparece (el snapshot del registro más nuevo). */
  porActor: Array<{ actor: string; perfil: string; total: number }>;
  /** Un punto por CADA día del rango (incluidos los de cero), en orden
   * ascendente, para que el gráfico de barras tenga el eje continuo. */
  porDia: Array<{ dia: string; total: number }>;
};

/**
 * Agrega los registros de "auditoria-panel" del rango de fechas para el
 * Dashboard de métricas: total de acciones, acciones por persona y acciones
 * por día. Recorre el rango día-por-día con el mismo `Query` que
 * listarAuditoria (misma partición `dia`), pero solo cuenta — proyecta
 * únicamente `actor`/`actorPerfil` y no materializa las filas completas.
 * Lanza (con contexto) si la consulta falla, igual que listarAuditoria.
 */
export async function agregarAuditoria(desde: string, hasta: string): Promise<AgregadoAuditoria> {
  const porActorMap = new Map<string, { perfil: string; total: number }>();
  const porDiaMap = new Map<string, number>();
  let totalAcciones = 0;

  try {
    for (const dia of diasDescendentes(desde, hasta)) {
      // Deja el día en el mapa aunque no tenga acciones, para que el gráfico
      // muestre la barra en cero en vez de saltarse la fecha.
      if (!porDiaMap.has(dia)) porDiaMap.set(dia, 0);

      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const salida = await dynamoClient.send(
          new QueryCommand({
            TableName: AUDIT_TABLE,
            KeyConditionExpression: '#dia = :dia',
            ProjectionExpression: '#actor, #actorPerfil',
            ExpressionAttributeNames: {
              '#dia': 'dia',
              '#actor': 'actor',
              '#actorPerfil': 'actorPerfil',
            },
            ExpressionAttributeValues: { ':dia': dia },
            ExclusiveStartKey: exclusiveStartKey,
          })
        );
        for (const item of salida.Items ?? []) {
          const actor = typeof item.actor === 'string' ? item.actor : 'desconocido';
          const perfil = typeof item.actorPerfil === 'string' ? item.actorPerfil : 'Sin asignar';
          totalAcciones += 1;
          porDiaMap.set(dia, (porDiaMap.get(dia) ?? 0) + 1);
          const previo = porActorMap.get(actor);
          // diasDescendentes va del más nuevo al más viejo, así que el primer
          // perfil que se ve para un actor es el más reciente — se conserva.
          porActorMap.set(actor, {
            perfil: previo?.perfil ?? perfil,
            total: (previo?.total ?? 0) + 1,
          });
        }
        exclusiveStartKey = salida.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);
    }
  } catch (error) {
    console.error('No se pudo agregar "auditoria-panel" en DynamoDB:', error);
    throw new Error('No se pudieron calcular las métricas de auditoría en DynamoDB');
  }

  const porActor = Array.from(porActorMap.entries())
    .map(([actor, { perfil, total }]) => ({ actor, perfil, total }))
    .sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));

  const porDia = Array.from(porDiaMap.entries())
    .map(([dia, total]) => ({ dia, total }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  return { desde, hasta, totalAcciones, porActor, porDia };
}
