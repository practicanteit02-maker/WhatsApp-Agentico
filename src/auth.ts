/* eslint-disable @typescript-eslint/no-explicit-any */
import NextAuth from "next-auth";

const domain = "https://us-east-2l8f5mx4zy.auth.us-east-2.amazoncognito.com";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    {
      id: "cognito",
      name: "Cognito",
      type: "oauth",
      authorization: {
        url: `${domain}/oauth2/authorize`,
        params: { scope: "email profile" },
      },
      token: `${domain}/oauth2/token`,
      userinfo: `${domain}/oauth2/userInfo`,
      clientId: process.env.AUTH_COGNITO_ID,
      clientSecret: process.env.AUTH_COGNITO_SECRET,
      checks: ["state"],
      profile(profile: any) {
        return {
          id: profile.sub,
          name: profile.email,
          email: profile.email,
        };
      },
    } as any,
  ],
});
