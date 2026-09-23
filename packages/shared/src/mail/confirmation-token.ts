import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Enlace firmado de confirmación de asistencia (ticket 5.6, specs/02 §4.4).
 *
 * `payload.firma`, ambos en base64url: el payload es `{ c: código, e: exp }` y
 * la firma un HMAC-SHA256 con una clave derivada del secreto (separación de
 * dominio: reutilizar `APP_SECRET` no permite confundir este token con otro
 * HMAC de la app). Sin estado: el enlace vale hasta `e` o hasta que la clave
 * deja de estar pendiente (confirmar dos veces es idempotente).
 */

export const DEV_CONFIRMATION_SECRET = "dev-confirmation-secret-no-usar-en-produccion";
/** Por defecto el enlace vive 30 días (acotado además por la caducidad de la clave). */
export const DEFAULT_CONFIRMATION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DOMAIN = "escaperoom:access-key-confirmation:v1";
const MAX_TOKEN_LENGTH = 512;

export type ConfirmationTokenConfig = { secret: string; ttlSeconds: number };

/**
 * `CONFIRMATION_TOKEN_SECRET` o, si no, `APP_SECRET`; fuera de producción cae a
 * un secreto de desarrollo. `null` (confirmación desactivada) en producción sin
 * ninguno de los dos.
 */
export function readConfirmationTokenConfig(
  env: Record<string, string | undefined> = process.env,
): ConfirmationTokenConfig | null {
  const configured = env.CONFIRMATION_TOKEN_SECRET?.trim() || env.APP_SECRET?.trim();
  const secret =
    configured || (env.NODE_ENV === "production" ? undefined : DEV_CONFIRMATION_SECRET);
  if (!secret) return null;
  const rawTtl = Number.parseInt(env.CONFIRMATION_TOKEN_TTL_SECONDS ?? "", 10);
  return {
    secret,
    ttlSeconds: Number.isInteger(rawTtl) && rawTtl > 0 ? rawTtl : DEFAULT_CONFIRMATION_TTL_SECONDS,
  };
}

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(DOMAIN).digest();
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", signingKey(secret)).update(payload).digest("base64url");
}

/** Firma el enlace de `code`, válido hasta `expiresAt`. */
export function signConfirmationToken(
  input: { code: string; expiresAt: Date },
  secret: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({ c: input.code, e: Math.floor(input.expiresAt.getTime() / 1000) }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export type ConfirmationTokenError = "MALFORMED" | "BAD_SIGNATURE" | "WRONG_KEY" | "EXPIRED";

export type ConfirmationTokenResult =
  { ok: true; expiresAt: Date } | { ok: false; error: ConfirmationTokenError };

/**
 * Verifica firma (tiempo constante), que el token sea de `code` y que no haya
 * caducado. La firma se comprueba antes de mirar el contenido.
 */
export function verifyConfirmationToken(
  token: string,
  code: string,
  secret: string,
  now: Date = new Date(),
): ConfirmationTokenResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: "MALFORMED" };
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: "MALFORMED" };
  const [payload, signature] = parts as [string, string];

  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, error: "BAD_SIGNATURE" };
  }

  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  const { c, e } = (data ?? {}) as { c?: unknown; e?: unknown };
  if (typeof c !== "string" || typeof e !== "number" || !Number.isFinite(e)) {
    return { ok: false, error: "MALFORMED" };
  }
  if (c !== code) return { ok: false, error: "WRONG_KEY" };
  if (e * 1000 <= now.getTime()) return { ok: false, error: "EXPIRED" };
  return { ok: true, expiresAt: new Date(e * 1000) };
}
