import NextAuth from "next-auth";
import Cognito from "next-auth/providers/cognito";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Cognito({
      clientId: process.env.AUTH_COGNITO_ID,
      clientSecret: process.env.AUTH_COGNITO_SECRET,
      issuer: process.env.AUTH_COGNITO_ISSUER,
      checks: ["state"],
    }),
  ],
});
