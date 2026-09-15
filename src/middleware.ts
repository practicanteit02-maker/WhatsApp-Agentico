import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  // La propia página de login tiene que quedar afuera de este chequeo —
  // si no, alguien sin sesión entra a /login, el middleware la trata como
  // una ruta protegida más, y redirige de vuelta a /login sin parar.
  if (req.nextUrl.pathname === "/login") return;

  // GHSA-8fpg-xm3f-6cx3: un error de configuración de next-auth (variable de
  // entorno de Cognito mal puesta, etc.) puede dejar `req.auth` poblado con
  // un objeto de ERROR en vez de `null` — y ese objeto es truthy. Chequear
  // solo `!req.auth` (como estaba antes) dejaría pasar a CUALQUIER visitante
  // sin sesión en ese escenario, porque el objeto de error igual pasa el
  // chequeo. `req.auth?.user` es el chequeo seguro que recomienda el propio
  // advisory: un objeto de error no tiene `.user`, así que sigue fallando
  // cerrado (redirige a /login) incluso en ese caso. Mismo patrón que ya usa
  // el resto del código (checkZoneAccess, requierePermiso, etc. — todos
  // chequean session?.user, nunca la sesión pelada).
  if (!req.auth?.user) {
    const signInUrl = new URL("/login", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
