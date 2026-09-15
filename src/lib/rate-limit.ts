import { NextResponse } from 'next/server';

/**
 * Límite de solicitudes en memoria, ventana fija por clave — sin Redis ni
 * ninguna infraestructura compartida, pensado para el entorno actual
 * (Amplify, un solo proceso Node por instancia). Mismo patrón que el resto
 * de los cachés en memoria del proyecto (ver getConversationZonaCache en
 * src/app/api/webhooks/whatsapp/route.ts, o inboxEventBus en
 * src/lib/event-bus.ts): vive en globalThis para sobrevivir el fast-refresh
 * de Turbopack en desarrollo, y se barre de entradas vencidas en cada
 * llamada en vez de necesitar un cron/setInterval aparte.
 *
 * LIMITACIÓN CONOCIDA: el balde vive en la memoria de UNA instancia del
 * proceso Node. Si Amplify llega a correr (o escalar a) más de una
 * instancia al mismo tiempo, cada una cuenta por separado — el límite real
 * efectivo puede terminar siendo hasta N veces el configurado, con N =
 * cantidad de instancias activas en ese momento. Un cold start (instancia
 * nueva, redeploy) también resetea el conteo a cero. Es una barrera
 * razonable contra abuso obvio o un script de una sola fuente, no una
 * garantía dura contra un atacante distribuido — para eso haría falta un
 * store compartido (Redis, DynamoDB, etc.), fuera del alcance de este
 * cambio.
 */
type Bucket = { count: number; resetAt: number };

function getStore(): Map<string, Bucket> {
  const global = globalThis as unknown as { __rateLimitBuckets?: Map<string, Bucket> };
  if (!global.__rateLimitBuckets) {
    global.__rateLimitBuckets = new Map();
  }
  return global.__rateLimitBuckets;
}

/**
 * IP del cliente que originó el request. Amplify corre detrás de CloudFront,
 * que sí manda `x-forwarded-for` con la IP real del visitante; en local, sin
 * ningún proxy delante, ese header no viene y todo cae al mismo balde
 * 'unknown' (en desarrollo el rate limiting deja de ser por-IP y pasa a ser
 * global — aceptable para no bloquear pruebas locales, ver limitación de
 * arriba).
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || 'unknown';
}

/**
 * Chequea y consume una unidad del balde `key` — `limit` solicitudes cada
 * `windowMs`, ventana fija (no deslizante: al vencer, el balde se reinicia
 * entero de una, no de a poco). Devuelve `null` si puede seguir (mismo
 * patrón que requierePermiso() en src/lib/require-permission.ts: `null` =
 * dejar pasar, un NextResponse listo para retornar = frenar acá), o la
 * respuesta 429 con el header `Retry-After` si ya se pasó del límite.
 */
export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message: string
): NextResponse | null {
  const store = getStore();
  const now = Date.now();

  for (const [storedKey, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(storedKey);
  }

  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return NextResponse.json(
      { error: message },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
    );
  }

  existing.count += 1;
  return null;
}
