import { z } from "zod";
import { bool } from "./helpers";

// ---------------------------------------------------------------------------
// Fragmentos de servidor. Cada app compone su `serverSchema` mezclando los
// fragmentos que use (`.extend(...)`) o parte de `baseServerSchema`.
// ---------------------------------------------------------------------------

export const coreSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_NAME: z.string().min(1),
  // Canonical public URL, no trailing slash
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  // ≥32 chars (`openssl rand -base64 32`) — HMAC de tokens y cifrado en reposo
  APP_SECRET: z.string().min(32),
  // Better Auth (ADR-016)
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
});

export const authSchema = z.object({
  // Better Auth (ADR-016): Google OAuth. El email mágico no necesita claves.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export const redisSchema = z.object({
  REDIS_URL: z.string().optional(),
  QUEUES_ENABLED: bool(false),
});

export const emailSchema = z.object({
  // Nodemailer por defecto, Resend opcional (ADR-020)
  EMAIL_PROVIDER: z.enum(["nodemailer", "resend"]).default("nodemailer"),
  EMAIL_FROM: z.email(),
  EMAIL_FROM_NAME: z.string().min(1),
  EMAIL_REPLY_TO: z.email().optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

export const storageSchema = z.object({
  STORAGE_PROVIDER: z.enum(["s3", "r2"]).default("s3"),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().default("us-east-1"),
  // Empty string = use the provider default endpoint
  STORAGE_ENDPOINT: z.string().default(""),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
});

/** Lo que usa una app típica entera. */
export const baseServerSchema = coreSchema
  .extend(authSchema.shape)
  .extend(redisSchema.shape)
  .extend(emailSchema.shape)
  .extend(storageSchema.shape);

// ---------------------------------------------------------------------------
// Fragmentos de producto de `web` (ticket de saneamiento del esquema de
// entorno). Documentan la forma real de variables que ya se leen en runtime
// vía `process.env` disperso (o vía `readXConfig(env)` en @escaperoom/shared),
// cada una con su propia degradación con gracia si falta. Todas opcionales:
// ninguna de ellas debe volverse obligatoria solo por aparecer aquí.
// ---------------------------------------------------------------------------

export const editorSyncSchema = z.object({
  // Puerto del proceso `pnpm dev:editor-sync`. Por defecto 2568 si falta.
  EDITOR_SYNC_PORT: z.coerce.number().int().positive().optional(),
  // Orígenes permitidos en el handshake (CSV). Por defecto, NEXT_PUBLIC_APP_URL.
  EDITOR_SYNC_ALLOWED_ORIGINS: z.string().optional(),
});

export const tokensSchema = z.object({
  // Secreto de playtest compartido con colyseus-server. Obligatorio en
  // producción (sin él, playtest responde 503); en desarrollo hay uno fijo.
  PLAYTEST_SECRET: z.string().optional(),
  // Firma los enlaces de confirmación de asistencia. Por defecto APP_SECRET.
  CONFIRMATION_TOKEN_SECRET: z.string().optional(),
  // Secreto del joinToken de canje de claves. Obligatorio en producción (sin
  // él, /api/access-keys/redeem responde 503); en desarrollo hay uno fijo.
  JOIN_TOKEN_SECRET: z.string().optional(),
  JOIN_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  // Secreto del enlace de confirmación de publicación por MCP. Obligatorio en
  // producción (sin él, la tool `publish` responde «no disponible»); en
  // desarrollo hay uno fijo.
  PUBLISH_CONFIRM_SECRET: z.string().optional(),
  PUBLISH_CONFIRM_TTL_SECONDS: z.coerce.number().int().positive().optional(),
});

export const creatorChatSchema = z.object({
  CREATOR_CHAT_PROVIDER: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  CREATOR_CHAT_MODEL: z.string().optional(),
  CREATOR_CHAT_MAX_TURNS: z.coerce.number().int().positive().optional(),
  CREATOR_CHAT_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  CREATOR_CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().optional(),
  CREATOR_CHAT_TOOL_RESULT_MAX_CHARS: z.coerce.number().int().positive().optional(),
  // Solo si el MCP (/mcp/creator) vive en otro proceso; por defecto el chat
  // le entrega las peticiones HTTP en el mismo proceso.
  CREATOR_CHAT_MCP_URL: z.string().optional(),
});

export const observabilitySchema = z.object({
  // Sin ella, Sentry queda deshabilitado; la app funciona igual.
  SENTRY_DSN: z.string().optional(),
  // Solo de build (subida de source maps con @sentry/webpack-plugin).
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
});

export const elevenLabsSchema = z.object({
  // Sin ella, /api/audio/generate/* responde 503; no rompe el resto de la app.
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().optional(),
});

export const stripeSchema = z.object({
  // Sin ellas, el checkout y el reparto con Connect no están disponibles.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});
