import type { DefaultSession } from "next-auth";

// Extiende los tipos de NextAuth para que `perfil` y `zona` (asignados en
// src/auth.ts desde la tabla "usuarios-panel" de DynamoDB) estén disponibles
// con tipos en session.user en cualquier parte de la app, y en el JWT
// mientras viaja entre los callbacks de src/auth.ts.
declare module "next-auth" {
  interface Session {
    user: {
      perfil: string;
      zona: string;
    } & DefaultSession["user"];
  }
}

// "next-auth/jwt" solo reexporta el tipo (`export * from "@auth/core/jwt"`)
// — el `interface JWT` real, el que hace falta ampliar para que la
// declaración se fusione de verdad, vive en "@auth/core/jwt".
declare module "@auth/core/jwt" {
  interface JWT {
    perfil?: string;
    zona?: string;
  }
}
