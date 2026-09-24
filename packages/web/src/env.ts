import { parseEnv } from "@escaperoom/env";
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
 * variables existen y su forma (saneamiento del esquema de entorno, ver PR).
 * Compone `baseServerSchema` con los fragmentos de producto que hoy se leen
 * de forma dispersa vía `process.env`/`readXConfig(env)` en `@escaperoom/web`
 * y `@escaperoom/shared`.
 *
 * Aún NO se importa desde el runtime real (ningún `next.config.ts`, layout,
 * route ni `instrumentation.ts` importa este archivo): el job `verify` de CI
 * (`pnpm turbo run lint typecheck test build`) no define hoy `APP_SECRET`,
 * `BETTER_AUTH_SECRET`, `EMAIL_FROM`, etc., así que activar esta validación
 * en `next build` rompería CI. Antes de enchufarla hay que declarar esas
 * variables en `.github/workflows/ci.yml` (job `verify`) — o relajar el
 * schema de build — y solo entonces empezar a migrar los `process.env.X`
 * dispersos a `env.X` (ticket 0.2+).
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
