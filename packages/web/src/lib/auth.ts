import { prisma } from "@escaperoom/shared/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, magicLink, organization } from "better-auth/plugins";

/**
 * Better Auth (ADR-016). Modelo canónico adoptado: `user`, `session`, `account`,
 * `verification` + plugin de organización (`organization`, `member`,
 * `invitation`). Sin mapeo de nombres: los modelos Prisma ya coinciden.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: false },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // TODO(0.11): enviar con @escaperoom/mailer (Nodemailer por defecto, ADR-020).
        console.info(`[magic-link] ${email} → ${url}`);
      },
    }),
    organization(),
    bearer(),
  ],
});

export type Session = typeof auth.$Infer.Session;
