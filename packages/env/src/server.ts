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
  .extend(redisSchema.shape)
  .extend(emailSchema.shape)
  .extend(storageSchema.shape);
