import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Agregaciones sobre "respuestas-panel" (ver src/lib/respuestas.ts) para dos
 * consumidores: el Dashboard de métricas (todo el equipo, solo
 * Administrador) y el panel personal "Mis estadísticas" (una sola persona).
 *
 * Archivo separado de auditoria.ts a propósito, aunque las dos tablas
 * comparten la misma forma de clave (`dia`+`ts`): cada lib/*.ts de este
 * proyecto es dueño de su propio pipeline de punta a punta (ver metrics.ts y
 * auditoria.ts, que conviven sin importarse entre sí en
 * /api/metrics/route.ts) — así un cambio de esquema en una tabla no puede
 * romper la agregación de la otra por acoplamiento accidental.
 *
 * Mismo patrón de cliente que el resto: sin credenciales explícitas (cadena
 * de credenciales por defecto de AWS), misma región. El rol de Amplify
 * (AmplifySSRLoggingRole) necesita `Query` sobre esta tabla (ya tiene
 * `PutItem`, de cuando se sentó la base en src/lib/respuestas.ts).
 */
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-2' })
);

const RESPUESTAS_TABLE = 'respuestas-panel';

/** Itera las fechas `YYYY-MM-DD` de `desde` a `hasta`, en orden ascendente —
 * a diferencia de diasDescendentes() en auditoria.ts (que necesita
 * más-reciente-primero para la paginación de listarAuditoria), acá solo se
 * agrega de punta a punta, así que el orden no importa y ascendente es la
 * forma más simple de recorrerlo. Mismo tope de seguridad de ~1 año. */
function* diasEnRango(desde: string, hasta: string): Generator<string> {
  const [dy, dm, dd] = desde.split('-').map(Number);
  const [hy, hm, hd] = hasta.split('-').map(Number);
  const cursor = new Date(Date.UTC(dy, dm - 1, dd));
  const fin = new Date(Date.UTC(hy, hm - 1, hd)).getTime();
  let guarda = 0;
  while (cursor.getTime() <= fin && guarda++ < 400) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

// Colombia es UTC-5 todo el año (sin horario de verano), así que en vez de
// Intl.DateTimeFormat por fila (correcto pero más caro a este volumen —
// "respuestas-panel" registra CADA mensaje saliente, no solo acciones
// administrativas como auditoria-panel) alcanza con restar 5 horas en
// milisegundos y leer los getters UTC.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** `{ diaSemana, hora }` de un ISO-8601 UTC en hora de Bogotá. `diaSemana`:
 * 0=Lunes...6=Domingo (getUTCDay() nativo da 0=Domingo, se remapea para que
 * la semana empiece en lunes, como se muestra en la matriz). */
function diaSemanaYHoraBogota(fechaIso: string): { diaSemana: number; hora: number } | null {
  const ms = Date.parse(fechaIso);
  if (!Number.isFinite(ms)) return null;
  const bogota = new Date(ms - BOGOTA_OFFSET_MS);
  return {
    diaSemana: (bogota.getUTCDay() + 6) % 7,
    hora: bogota.getUTCHours(),
  };
}

export type MetricaPorActor = {
  actor: string;
  perfil: string;
  totalMensajes: number;
  /** threadKeys distintos en el rango — "a cuántos chats distintos le
   * respondió", no cuántos mensajes mandó en total. */
  chatsAtendidos: number;
  /** Promedio de segundosDesdeUltimoInbound — null si ningún mensaje de esta
   * persona en el rango traía ese dato (ver el campo opcional en
   * src/lib/respuestas.ts). */
  tiempoRespuestaPromedioSeg: number | null;
};

/** Una celda del heatmap "hora del día × día de la semana". Siempre 168
 * (7×24), incluidas las celdas en 0, para que la cuadrícula sea completa. */
export type CeldaActividad = { diaSemana: number; hora: number; total: number };

export type AgregadoRespuestas = {
  desde: string;
  hasta: string;
  totalMensajes: number;
  chatsAtendidos: number;
  tiempoRespuestaPromedioSeg: number | null;
  /** Cuántos de `totalMensajes` sí traían el snapshot de tiempo de
   * respuesta — para no mostrar un promedio como si fuera sobre todos los
   * mensajes cuando en realidad es sobre unos pocos. */
  mensajesConTiempo: number;
  /** Desglose por persona, ordenado de más a menos mensajes. Vacío cuando
   * hay `filtroActor` (sería un solo renglón redundante con los totales de
   * arriba — ver agregarRespuestas). */
  porActor: MetricaPorActor[];
  matrizActividad: CeldaActividad[];
};

/**
 * Agrega "respuestas-panel" del rango de fechas dado.
 *
 * Sin `filtroActor`: todo el equipo (Dashboard de métricas, Administrador).
 * Con `filtroActor`: solo esa persona (panel "Mis estadísticas") — el
 * llamador (/api/mis-estadisticas/route.ts) SIEMPRE pasa acá el correo de la
 * sesión real, nunca un valor que mande el cliente; es lo que garantiza que
 * cada persona vea exclusivamente lo suyo.
 *
 * Recorre el rango día-por-día con un `Query` por partición (mismo patrón
 * que auditoria.ts), proyectando solo lo que hace falta para agregar — no
 * materializa las filas completas. Lanza (con contexto) si la consulta
 * falla, para que el handler devuelva un error explícito en vez de un 500
 * con cuerpo vacío.
 */
export async function agregarRespuestas(
  desde: string,
  hasta: string,
  filtroActor?: string,
): Promise<AgregadoRespuestas> {
  type Acumulador = { perfil: string; total: number; threadKeys: Set<string>; sumaSeg: number; conSeg: number };
  const porActorMap = new Map<string, Acumulador>();
  const threadKeysGlobal = new Set<string>();
  const matriz = new Map<string, number>(); // clave `${diaSemana}-${hora}`
  let totalMensajes = 0;
  let sumaSegGlobal = 0;
  let conSegGlobal = 0;

  const nombres: Record<string, string> = {
    '#dia': 'dia',
    '#actor': 'actor',
    '#actorPerfil': 'actorPerfil',
    '#threadKey': 'threadKey',
    '#fecha': 'fecha',
    '#segundosDesdeUltimoInbound': 'segundosDesdeUltimoInbound',
  };

  try {
    for (const dia of diasEnRango(desde, hasta)) {
      const valores: Record<string, unknown> = { ':dia': dia };
      let filterExpression: string | undefined;
      if (filtroActor) {
        filterExpression = '#actor = :actor';
        valores[':actor'] = filtroActor;
      }

      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const salida = await dynamoClient.send(
          new QueryCommand({
            TableName: RESPUESTAS_TABLE,
            KeyConditionExpression: '#dia = :dia',
            FilterExpression: filterExpression,
            ProjectionExpression: '#actor, #actorPerfil, #threadKey, #fecha, #segundosDesdeUltimoInbound',
            ExpressionAttributeNames: nombres,
            ExpressionAttributeValues: valores,
            ExclusiveStartKey: exclusiveStartKey,
          })
        );

        for (const item of salida.Items ?? []) {
          const actor = typeof item.actor === 'string' ? item.actor : 'desconocido';
          const perfil = typeof item.actorPerfil === 'string' ? item.actorPerfil : 'Sin asignar';
          const threadKey = typeof item.threadKey === 'string' ? item.threadKey : undefined;
          const fecha = typeof item.fecha === 'string' ? item.fecha : undefined;
          const segundos = typeof item.segundosDesdeUltimoInbound === 'number'
            ? item.segundosDesdeUltimoInbound
            : undefined;

          totalMensajes += 1;
          if (threadKey) threadKeysGlobal.add(threadKey);
          if (segundos !== undefined) {
            sumaSegGlobal += segundos;
            conSegGlobal += 1;
          }

          const previo = porActorMap.get(actor) ?? {
            perfil,
            total: 0,
            threadKeys: new Set<string>(),
            sumaSeg: 0,
            conSeg: 0,
          };
          previo.total += 1;
          if (threadKey) previo.threadKeys.add(threadKey);
          if (segundos !== undefined) {
            previo.sumaSeg += segundos;
            previo.conSeg += 1;
          }
          porActorMap.set(actor, previo);

          if (fecha) {
            const ubicacion = diaSemanaYHoraBogota(fecha);
            if (ubicacion) {
              const clave = `${ubicacion.diaSemana}-${ubicacion.hora}`;
              matriz.set(clave, (matriz.get(clave) ?? 0) + 1);
            }
          }
        }

        exclusiveStartKey = salida.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);
    }
  } catch (error) {
    console.error('No se pudo agregar "respuestas-panel" en DynamoDB:', error);
    throw new Error('No se pudieron calcular las métricas de respuestas en DynamoDB');
  }

  const porActor: MetricaPorActor[] = filtroActor
    ? []
    : Array.from(porActorMap.entries())
        .map(([actor, v]) => ({
          actor,
          perfil: v.perfil,
          totalMensajes: v.total,
          chatsAtendidos: v.threadKeys.size,
          tiempoRespuestaPromedioSeg: v.conSeg > 0 ? Math.round(v.sumaSeg / v.conSeg) : null,
        }))
        .sort((a, b) => b.totalMensajes - a.totalMensajes || a.actor.localeCompare(b.actor));

  const matrizActividad: CeldaActividad[] = [];
  for (let diaSemana = 0; diaSemana < 7; diaSemana++) {
    for (let hora = 0; hora < 24; hora++) {
      matrizActividad.push({ diaSemana, hora, total: matriz.get(`${diaSemana}-${hora}`) ?? 0 });
    }
  }

  return {
    desde,
    hasta,
    totalMensajes,
    chatsAtendidos: threadKeysGlobal.size,
    tiempoRespuestaPromedioSeg: conSegGlobal > 0 ? Math.round(sumaSegGlobal / conSegGlobal) : null,
    mensajesConTiempo: conSegGlobal,
    porActor,
    matrizActividad,
  };
}
