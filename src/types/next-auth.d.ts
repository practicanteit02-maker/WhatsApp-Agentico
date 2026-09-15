import type { DefaultSession } from "next-auth";

// Extiende los tipos de NextAuth para que `perfil` y `zonas` (asignados en
// src/auth.ts desde la tabla "usuarios-panel" de DynamoDB) estén disponibles
// con tipos en session.user en cualquier parte de la app, y en el JWT
// mientras viaja entre los callbacks de src/auth.ts.
declare module "next-auth" {
  interface Session {
    user: {
      perfil: string;
      // Funcionalidad "Números/Zonas múltiples": antes era `zona: string`
      // (un solo valor) — ahora un array, siempre normalizado (nunca
      // undefined) por el callback session() de src/auth.ts, incluso para
      // sesiones ya activas con un JWT viejo que todavía trae solo `zona`
      // (ver JWT.zona más abajo, y el comentario en ese callback).
      zonas: string[];
    } & DefaultSession["user"];
  }
}

// "next-auth/jwt" solo reexporta el tipo (`export * from "@auth/core/jwt"`)
// — el `interface JWT` real, el que hace falta ampliar para que la
// declaración se fusione de verdad, vive en "@auth/core/jwt".
declare module "@auth/core/jwt" {
  interface JWT {
    perfil?: string;
    // Campo nuevo, el que escribe el callback jwt() en cualquier login
    // posterior a este cambio.
    zonas?: string[];
    // Campo LEGACY: no se vuelve a escribir (el callback jwt() ya no lo
    // toca), pero sigue declarado acá porque un JWT firmado ANTES de este
    // cambio todavía lo trae — session() lo lee como respaldo mientras esa
    // sesión no se renueve con un login nuevo. Se puede borrar este campo
    // (y el fallback que lo usa en session()) una vez que sea razonable
    // asumir que ya no queda ningún JWT viejo circulando (duran lo que dure
    // la sesión de NextAuth configurada).
    zona?: string;
  }
}
