import { createHmac, timingSafeEqual } from "node:crypto";
import { isDevFallbackAllowed } from "@escaperoom/env";

/**
 * `gameToken` de la `GameRoom` (C-4/B-4, auditoría 2026-09-24): JWT HS256
 * corto que autoriza a un cliente a crear o unirse a una partida `game`
 * (nunca `playtest`/`event`, que ya tienen su propio token). Mismo patrón
 * HMAC que `join-token.ts`, con su propia clave de firma (separación de
 * dominio) y audiencia.
 *
 * Tres tipos de claim:
 * - `purchase`: web lo firma tras comprobar en Postgres que el usuario tiene
 *   una `purchase` `room` `succeeded` de la sala (`GET /api/rooms/:roomId/access`,
 *   B-4). La `GameRoom` lo verifica sin tocar la base de datos y, al crear la
 *   room, reclama `purchase.playSessionStartedAt` (escritura condicional
 *   `IS NULL`: una compra = una partida) a través de `GameAccessStore`.
 * - `free`: sala realmente gratis (precio 0 + venta individual), sin cuenta
 *   ni Stripe (punto i de la entrada "CTA Jugar" de `docs/DEUDA.md`). Web lo
 *   firma tras comprobar que la sala cumple esa condición
 *   (`GET /api/rooms/:roomId/free-access`), sin exigir sesión. No hay
 *   `purchase` que reclamar ni consumir: el abuso se frena con cuotas por IP
 *   al FIRMAR el token (`withRateLimit`), no en la `GameRoom`.
 * - `dev_test`: partida de prueba sin compra, solo fuera de producción
 *   (`isDevFallbackAllowed`, comprobado también al verificar, no solo al
 *   firmar: un secreto filtrado no basta para colar una partida de prueba en
 *   un despliegue real). La usan `/es/play` sin `?session` y el E2E
 *   `game.reyaldric` (que arranca con `NODE_ENV=production` pero
 *   `ALLOW_DEV_SECRETS=1`, deliberado — ver `packages/e2e/support/env.ts`).
 *
 * Este módulo no depende de Prisma (subpath propio
 * `@escaperoom/shared/game-access-token`), así que Colyseus lo importa sin
 * arrastrar el cliente de base de datos.
 */

/** Secreto de desarrollo: solo fuera de `NODE_ENV=production` (o `ALLOW_DEV_SECRETS=1`). */
export const DEV_GAME_ACCESS_TOKEN_SECRET = "dev-game-access-token-secret-no-usar-en-produccion";

/** Caducidad: igual que `joinToken`, solo para hacer el `join`/`create` inicial. */
export const DEFAULT_GAME_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export const GAME_ACCESS_TOKEN_AUDIENCE = "escaperoom:game-room";
const ISSUER = "escaperoom:web";
const MAX_TOKEN_LENGTH = 2048;

export type GameAccessTokenEnv = Record<string, string | undefined>;
export type GameAccessTokenConfig = { secret: string; ttlSeconds: number };

/** Lee la configuración; `null` (la `GameRoom` no acepta ningún `gameToken`) si falta el secreto. */
export function readGameAccessTokenConfig(
  env: GameAccessTokenEnv = process.env,
): GameAccessTokenConfig | null {
  const configured = env.GAME_ACCESS_TOKEN_SECRET?.trim();
  const secret = configured || (isDevFallbackAllowed(env) ? DEV_GAME_ACCESS_TOKEN_SECRET : undefined);
  if (!secret) return null;
  return { secret, ttlSeconds: DEFAULT_GAME_ACCESS_TOKEN_TTL_SECONDS };
}

/** Claims de un `gameToken`: compra B2C (B-4), sala gratis sin cuenta, o partida de prueba sin persistencia. */
export type GameAccessClaims =
  | { kind: "purchase"; purchaseId: string; userId: string; roomVersionId: string }
  | { kind: "free"; roomId: string; roomVersionId: string }
  | { kind: "dev_test"; label: string };

type GameAccessTokenPayload = {
  iss: typeof ISSUER;
  aud: typeof GAME_ACCESS_TOKEN_AUDIENCE;
  /** Segundos desde epoch. */
  iat: number;
  exp: number;
} & (
  | { k: "purchase"; pid: string; uid: string; rvid: string }
  | { k: "free"; rid: string; rvid: string }
  | { k: "dev_test"; lbl: string }
);

export type GameAccessTokenError = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED";

export type GameAccessTokenResult =
  | { ok: true; claims: GameAccessClaims; expiresAt: number }
  | { ok: false; error: GameAccessTokenError };

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

/** Clave de firma derivada (separación de dominio respecto a otros usos del secreto). */
function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("escaperoom/game-access-token/v1").digest();
}

function sign(secret: string, input: string): string {
  return createHmac("sha256", signingKey(secret)).update(input).digest("base64url");
}

function toPayload(
  claims: GameAccessClaims,
):
  | { k: "purchase"; pid: string; uid: string; rvid: string }
  | { k: "free"; rid: string; rvid: string }
  | { k: "dev_test"; lbl: string } {
  if (claims.kind === "purchase") {
    return { k: "purchase", pid: claims.purchaseId, uid: claims.userId, rvid: claims.roomVersionId };
  }
  if (claims.kind === "free") {
    return { k: "free", rid: claims.roomId, rvid: claims.roomVersionId };
  }
  return { k: "dev_test", lbl: claims.label };
}

function fromPayload(payload: GameAccessTokenPayload): GameAccessClaims {
  if (payload.k === "purchase") {
    return { kind: "purchase", purchaseId: payload.pid, userId: payload.uid, roomVersionId: payload.rvid };
  }
  if (payload.k === "free") {
    return { kind: "free", roomId: payload.rid, roomVersionId: payload.rvid };
  }
  return { kind: "dev_test", label: payload.lbl };
}

/** Firma un `gameToken`; `now` y `expiresAt` en ms. */
export function signGameAccessToken(
  secret: string,
  claims: GameAccessClaims,
  opts: { now: number; expiresAt: number },
): string {
  const payload: GameAccessTokenPayload = {
    iss: ISSUER,
    aud: GAME_ACCESS_TOKEN_AUDIENCE,
    iat: Math.floor(opts.now / 1000),
    exp: Math.floor(opts.expiresAt / 1000),
    ...toPayload(claims),
  } as GameAccessTokenPayload;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${HEADER}.${body}`;
  return `${input}.${sign(secret, input)}`;
}

/** Verifica firma, cabecera (solo HS256), audiencia y caducidad. */
export function verifyGameAccessToken(
  secret: string,
  token: unknown,
  now: number = Date.now(),
): GameAccessTokenResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: "MALFORMED" };
  }
  const [header, body, signature, extra] = token.split(".");
  if (!header || !body || !signature || extra !== undefined || header !== HEADER) {
    return { ok: false, error: "MALFORMED" };
  }
  const expected = Buffer.from(sign(secret, `${header}.${body}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, error: "BAD_SIGNATURE" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  if (!isPayload(payload)) return { ok: false, error: "MALFORMED" };
  if (payload.exp * 1000 <= now) return { ok: false, error: "EXPIRED" };
  return { ok: true, expiresAt: payload.exp * 1000, claims: fromPayload(payload) };
}

function isPayload(value: unknown): value is GameAccessTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 128;
  if (c.iss !== ISSUER || c.aud !== GAME_ACCESS_TOKEN_AUDIENCE) return false;
  if (typeof c.iat !== "number" || typeof c.exp !== "number" || !Number.isFinite(c.exp)) return false;
  if (c.k === "purchase") return text(c.pid) && text(c.uid) && text(c.rvid);
  if (c.k === "free") return text(c.rid) && text(c.rvid);
  if (c.k === "dev_test") return text(c.lbl);
  return false;
}
