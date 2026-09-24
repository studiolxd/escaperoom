import { prisma } from "@escaperoom/shared/db";
import { createMailTransportFromEnv, sendMagicLinkEmail } from "@escaperoom/shared/mail";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, magicLink, organization } from "better-auth/plugins";
import { resolveGoogleSocialProviders } from "./auth-google-provider";

/**
 * Better Auth (ADR-016). Modelo canónico adoptado: `user`, `session`, `account`,
 * `verification` + plugin de organización (`organization`, `member`,
 * `invitation`). Sin mapeo de nombres: los modelos Prisma ya coinciden.
 */

// Transporte del enlace mágico (A-1): el mismo `createMailTransportFromEnv`
// que `getContactService` (server/services.ts). Se computa una vez al cargar
// el módulo, igual que el resto de la configuración de `betterAuth` de abajo.
const magicLinkTransport = createMailTransportFromEnv();

/** Idioma del email a partir de `Accept-Language`; sin cabecera, `es` (ADR-018). */
function localeFromHeaders(headers: Headers | undefined | null): unknown {
  return headers?.get("accept-language")?.split(",")[0]?.split("-")[0];
}

const googleSocialProviders = resolveGoogleSocialProviders();

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: false },
  // A-17: Google solo se registra como proveedor si hay credenciales reales;
  // con `?? ""` el proveedor quedaba "configurado" con claves vacías.
  ...(googleSocialProviders ? { socialProviders: googleSocialProviders } : {}),
  plugins: [
    magicLink({
      // El alta por magic link es el flujo de signup (PR #106): no se activa
      // `disableSignUp`.
      sendMagicLink: async ({ email, url }, ctx) => {
        await sendMagicLinkEmail(
          { transport: magicLinkTransport },
          { email, url, locale: localeFromHeaders(ctx?.headers) },
        );
        if (process.env.NODE_ENV !== "production") {
          // Nunca la URL de sesión de un solo uso, ni en desarrollo.
          console.info(`[magic-link] enviado a ${email}`);
        }
      },
    }),
    organization(),
    bearer(),
  ],
});

export type Session = typeof auth.$Infer.Session;
