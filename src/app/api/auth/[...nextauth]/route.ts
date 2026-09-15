import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";

// Frena a fuerza bruta / scripts golpeando el flujo de login: cubre TODAS
// las rutas de next-auth (csrf, providers, signin, callback, session,
// signout — todas caen bajo este mismo catch-all), contadas juntas por IP.
// Es OAuth federado con Cognito (no hay contraseña que este endpoint
// verifique — eso pasa del lado de Cognito), así que el objetivo acá no es
// contar "intentos de contraseña" sino evitar que alguien use nuestros
// propios endpoints de auth como vector de abuso/DoS. Un login real hace un
// puñado de requests (csrf + signin + callback + session, y de nuevo si el
// usuario reintenta a mano); 20 cada 60s da margen de sobra para eso sin
// abrir la puerta a un script golpeando sin parar.
const LOGIN_RATE_LIMIT = 20;
const LOGIN_RATE_WINDOW_MS = 60_000;

async function withLoginRateLimit(
  request: NextRequest,
  handler: (req: NextRequest) => Promise<Response>
): Promise<Response> {
  const limitado = enforceRateLimit(
    `auth:${getClientIp(request)}`,
    LOGIN_RATE_LIMIT,
    LOGIN_RATE_WINDOW_MS,
    "Demasiados intentos de inicio de sesión. Esperá un momento y volvé a intentar."
  );
  if (limitado) return limitado;

  return handler(request);
}

export async function GET(request: NextRequest) {
  return withLoginRateLimit(request, handlers.GET);
}

export async function POST(request: NextRequest) {
  return withLoginRateLimit(request, handlers.POST);
}
