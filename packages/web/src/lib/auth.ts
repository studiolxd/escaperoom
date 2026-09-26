import { prisma } from "@escaperoom/shared/db";
import {
  createMailTransportFromEnv,
  resolveMailLocale,
  sendMagicLinkEmail,
  sendOrganizationInvitationEmail,
} from "@escaperoom/shared/mail";
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

/**
 * Origen público de la app para construir enlaces en emails (F-13): igual que
 * `server/mcp-oauth.ts#publicOrigin`, pero copiado en vez de importado —
 * importar ese módulo desde aquí crearía un ciclo (`mcp-oauth.ts` importa
 * `server/context.ts`, que importa este archivo).
 */
function publicOrigin(requestUrl: string | URL): string {
  const configured = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  return new URL(configured || requestUrl).origin;
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
    organization({
      // A-8: sin esto, Better Auth crea la `invitation` en base de datos pero
      // nunca avisa a la persona invitada. Mismo transporte que el enlace
      // mágico; la URL lleva a la página propia de aceptación (no a una ruta
      // de Better Auth: `accept-invitation` exige sesión y solo devuelve el
      // detalle a quien ya está autenticado como el email invitado).
      sendInvitationEmail: async (data, request) => {
        const locale = resolveMailLocale(localeFromHeaders(request?.headers));
        const origin = publicOrigin(request?.url ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
        const url = `${origin}/${locale}/invitations/organization/${data.id}/accept`;
        await sendOrganizationInvitationEmail(
          { transport: magicLinkTransport },
          {
            email: data.email,
            url,
            organizationName: data.organization.name,
            inviterEmail: data.inviter.user.email,
            locale,
          },
        );
      },
    }),
    bearer(),
  ],
  // A-8: sin esto, un miembro podría machacar la cuota por defecto de
  // Better Auth (por ruta, no por organización) reinvitando en bucle.
  rateLimit: {
    customRules: {
      "/organization/invite-member": { window: 3600, max: 20 },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
