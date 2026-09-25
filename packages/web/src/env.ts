import { parseEnv, requireInProduction } from "@escaperoom/env";
import { baseClientSchema } from "@escaperoom/env/client";
import {
  baseServerSchema,
  creatorChatSchema,
  editorSyncSchema,
  elevenLabsSchema,
  observabilitySchema,
  stripeSchema,
  tokensSchema,
} from "@escaperoom/env/server";

/**
 * Esquema de entorno de la app: única fuente de verdad tipada de qué
 * variables existen y su forma (E-4/A-19/C-5/F-41). Compone `baseServerSchema`
 * con los fragmentos de producto que hoy se leen de forma dispersa vía
 * `process.env`/`readXConfig(env)` en `@escaperoom/web` y `@escaperoom/shared`.
 *
 * Se importa desde `instrumentation.ts` (`register()`), que Next solo ejecuta
 * al arrancar un servidor real (`next dev`/`next start`), nunca durante
 * `next build` (ver docs de Next: "called once when a new Next.js server
 * instance is initiated") — así el job `verify` de CI (que no fija
 * `APP_SECRET`, `BETTER_AUTH_SECRET`, `EMAIL_FROM`…) no se ve afectado. Los
 * campos "obligatorios" del esquema real (secretos, `APP_URL`…) son
 * `.optional()` aquí a propósito: `requireInProduction` los exige solo con
 * `NODE_ENV=production`, para no romper `development`/`test` sin configurar
 * nada.
 */
export const env = parseEnv({
  serverSchema: baseServerSchema
    .extend(editorSyncSchema.shape)
    .extend(tokensSchema.shape)
    .extend(creatorChatSchema.shape)
    .extend(observabilitySchema.shape)
    .extend(elevenLabsSchema.shape)
    .extend(stripeSchema.shape),
  clientSchema: baseClientSchema,
  clientSource: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_COLYSEUS_URL: process.env.NEXT_PUBLIC_COLYSEUS_URL,
    NEXT_PUBLIC_EDITOR_SYNC_URL: process.env.NEXT_PUBLIC_EDITOR_SYNC_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
});

/** Variables sin las que un despliegue real no debe arrancar (E-4). */
export const REQUIRED_IN_PRODUCTION = [
  "APP_URL",
  "DATABASE_URL",
  "APP_SECRET",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "REDIS_URL",
  "JOIN_TOKEN_SECRET",
  "PLAYTEST_SECRET",
  "PUBLISH_CONFIRM_SECRET",
  "ANALYTICS_SERVER_SECRET",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "STORAGE_BUCKET",
] as const;

/** Llamado desde `instrumentation.ts`: valida y registra el modo activo. */
export function validateEnvOnBoot(): void {
  requireInProduction(env, REQUIRED_IN_PRODUCTION);
  // Sin valores: solo qué modo está activo (E-4 pide loguearlo al arrancar).
  console.info(`[env] NODE_ENV=${env.NODE_ENV} validado`);
}
