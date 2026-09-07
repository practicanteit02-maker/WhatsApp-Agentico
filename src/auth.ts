/* eslint-disable @typescript-eslint/no-explicit-any */
import NextAuth from "next-auth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const domain = "https://us-east-2l8f5mx4zy.auth.us-east-2.amazoncognito.com";

// Sin credenciales explícitas a propósito: el SDK usa la cadena de
// credenciales por defecto de AWS — en producción (Amplify) las toma solas
// del rol IAM del servicio (AmplifySSRLoggingRole); en local, de lo que
// tengas configurado vía `aws configure` / variables de entorno estándar.
const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-east-2" })
);

const USUARIOS_TABLE = "usuarios-panel";
const DEFAULT_PERFIL = "Sin asignar";
const DEFAULT_ZONA = "Sin asignar";

/**
 * Busca perfil y zona de una persona en la tabla "usuarios-panel" de
 * DynamoDB (clave de partición: correo). Si el correo no está en la tabla,
 * o si la consulta falla por cualquier motivo (permisos, tabla caída,
 * etc.), no bloquea el login — devuelve valores por defecto y deja pasar a
 * la persona igual, solo sin esos datos asignados.
 */
async function lookupPerfilYZona(correo: string): Promise<{ perfil: string; zona: string }> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: USUARIOS_TABLE,
        Key: { correo },
      })
    );

    if (result.Item) {
      return {
        perfil: typeof result.Item.perfil === "string" ? result.Item.perfil : DEFAULT_PERFIL,
        zona: typeof result.Item.zona === "string" ? result.Item.zona : DEFAULT_ZONA,
      };
    }
  } catch (error) {
    console.error('No se pudo consultar "usuarios-panel" en DynamoDB:', error);
  }

  return { perfil: DEFAULT_PERFIL, zona: DEFAULT_ZONA };
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    {
      id: "cognito",
      name: "Cognito",
      type: "oauth",
      authorization: {
        url: `${domain}/oauth2/authorize`,
        params: { scope: "openid email profile" },
      },
      token: {
        url: `${domain}/oauth2/token`,
        // La causa real del "bug del nonce": Cognito, al federar con
        // Google, devuelve un id_token con un claim "nonce" que
        // oauth4webapi valida automáticamente contra "no debería haber
        // ninguno" (nuestro checks: ["state"] nunca pidió uno) — y revienta
        // con "unexpected ID Token nonce claim value" ANTES de que nuestro
        // profile() llegue a correr. `conform` sí se usa de verdad en
        // @auth/core (ver callback.ts) para interceptar la respuesta cruda
        // del token endpoint justo antes de esa validación — acá borramos
        // la propiedad id_token del body (no alcanza con vaciarla: tiene
        // que no existir) para que oauth4webapi nunca llegue a intentar
        // validarla. El endpoint userinfo (más abajo) sigue trayendo el
        // email igual, así que no se pierde ningún dato real.
        async conform(response: Response) {
          const body = await response.json();
          delete body.id_token;
          return new Response(JSON.stringify(body), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        },
      },
      userinfo: `${domain}/oauth2/userInfo`,
      clientId: process.env.AUTH_COGNITO_ID,
      clientSecret: process.env.AUTH_COGNITO_SECRET,
      checks: ["state"],
      profile(profile: any) {
        // Confirmado con un login real (ver JSON en la conversación): hoy
        // Cognito no devuelve ningún claim "name" para usuarios federados
        // con Google (el Attribute Mapping de Google→Cognito en la consola
        // de AWS no lo tiene mapeado), así que esto cae siempre a
        // profile.email por ahora — pero queda listo para el día que se
        // arregle ese mapeo, sin tener que tocar código de nuevo.
        return {
          id: profile.sub,
          name: profile.name ?? profile.email,
          email: profile.email,
        };
      },
    } as any,
  ],
  callbacks: {
    // Solo consulta DynamoDB en el momento del login (cuando NextAuth pasa
    // `user`, recién salido del profile() de arriba) — en los refrescos
    // posteriores del token ya queda guardado ahí, así que no repite la
    // consulta en cada request.
    async jwt({ token, user }) {
      if (user?.email) {
        const { perfil, zona } = await lookupPerfilYZona(user.email);
        token.perfil = perfil;
        token.zona = zona;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.perfil = token.perfil ?? DEFAULT_PERFIL;
        session.user.zona = token.zona ?? DEFAULT_ZONA;
      }
      return session;
    },
  },
});
