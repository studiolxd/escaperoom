import { parseEnv, requireInProduction } from "@escaperoom/env";
import { analyticsClientSchema, baseClientSchema } from "@escaperoom/env/client";
import {
  analyticsSchema,
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
    .extend(stripeSchema.shape)
    .extend(analyticsSchema.shape),
  clientSchema: baseClientSchema.extend(analyticsClientSchema.shape),
  clientSource: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_COLYSEUS_URL: process.env.NEXT_PUBLIC_COLYSEUS_URL,
    NEXT_PUBLIC_EDITOR_SYNC_URL: process.env.NEXT_PUBLIC_EDITOR_SYNC_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
    NEXT_PUBLIC_PLAUSIBLE_SRC: process.env.NEXT_PUBLIC_PLAUSIBLE_SRC,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
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
  "GAME_ACCESS_TOKEN_SECRET",
  "PLAYTEST_SECRET",
  "PUBLISH_CONFIRM_SECRET",
  "ANALYTICS_SERVER_SECRET",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "STORAGE_BUCKET",
] as const;

/**
 * Valores de `.env.example`: evidentes para desarrollo, pero que un despliegue
 * real no debe llevar puestos sin darse cuenta (docs/DEUDA.md «Claves reales
 * de analítica antes de desplegar en producción»).
 */
const DEV_ANALYTICS_PLACEHOLDERS = {
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "localhost",
  NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-DEV0000000",
} as const;

/**
 * Falla fuerte en producción si faltan las claves de Plausible/Google
 * Analytics o si siguen siendo los valores de desarrollo de `.env.example`
 * (docs/DEUDA.md). `ANALYTICS_DISABLED=1` es el único escape explícito para
 * desplegar a propósito sin analítica; su ausencia nunca debe interpretarse
 * como "sin analítica", solo como un despliegue mal configurado.
 */
export function validateAnalyticsEnvOnBoot(): void {
  if (env.NODE_ENV !== "production" || env.ANALYTICS_DISABLED) return;
  const problems = Object.entries(DEV_ANALYTICS_PLACEHOLDERS)
    .filter(([key, devValue]) => {
      const value = env[key as keyof typeof DEV_ANALYTICS_PLACEHOLDERS];
      return !value || value === devValue;
    })
    .map(([key, devValue]) => `${key} falta o sigue siendo el valor de desarrollo ("${devValue}")`);
  if (problems.length > 0) {
    throw new Error(
      `Analítica sin configurar en producción (docs/DEUDA.md «Claves reales de analítica antes de ` +
        `desplegar en producción»): ${problems.join("; ")}. Si el despliegue es deliberadamente sin ` +
        `analítica, fija ANALYTICS_DISABLED=1.`,
    );
  }
}

/** Llamado desde `instrumentation.ts`: valida y registra el modo activo. */
export function validateEnvOnBoot(): void {
  requireInProduction(env, REQUIRED_IN_PRODUCTION);
  validateAnalyticsEnvOnBoot();
  // Sin valores: solo qué modo está activo (E-4 pide loguearlo al arrancar).
  console.info(`[env] NODE_ENV=${env.NODE_ENV} validado`);
}
