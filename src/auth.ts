/* eslint-disable @typescript-eslint/no-explicit-any */
import NextAuth from "next-auth";
import Cognito from "next-auth/providers/cognito";

const cognitoProvider = {
  ...Cognito({
    clientId: process.env.AUTH_COGNITO_ID,
    clientSecret: process.env.AUTH_COGNITO_SECRET,
    issuer: process.env.AUTH_COGNITO_ISSUER,
    checks: ["state"],
    profile(profile: any) {
      return {
        id: profile.sub,
        name: profile.name ?? profile.email,
        email: profile.email,
      };
    },
  }),
  idToken: false,
} as any;

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [cognitoProvider],
});
