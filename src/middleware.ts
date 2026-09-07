import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  // La propia página de login tiene que quedar afuera de este chequeo —
  // si no, alguien sin sesión entra a /login, el middleware la trata como
  // una ruta protegida más, y redirige de vuelta a /login sin parar.
  if (req.nextUrl.pathname === "/login") return;

  if (!req.auth) {
    const signInUrl = new URL("/login", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
