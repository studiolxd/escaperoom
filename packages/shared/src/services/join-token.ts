import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `joinToken` del canje (ticket 5.8, specs/02 §4.5, specs/13 §6.2, specs/11 §8).
 *
 * JWT HS256 corto que `POST /api/access-keys/redeem` entrega al invitado y que
 * la room de evento de Colyseus exige en el `join`. **Nunca lleva la clave en
 * claro**: solo a qué sesión/grupo entra, con qué identidad visible y hasta
 * cuándo. Web firma y Colyseus verifica con el mismo secreto
 * (`JOIN_TOKEN_SECRET`); Colyseus no necesita Postgres para validar el join
 * porque el asiento ya se consumió al canjear.
 *
 * Este módulo no depende de Prisma (tiene subpath propio
 * `@escaperoom/shared/join-token`), así que Colyseus lo importa sin arrastrar
 * el cliente de base de datos.
 */

/** Secreto de desarrollo: solo fuera de `NODE_ENV=production`. */
export const DEV_JOIN_TOKEN_SECRET = "dev-join-token-secret-no-usar-en-produccion";

/** Caducidad por defecto: 15 min para hacer el `join` (tras él, la reconexión es de Colyseus). */
export const DEFAULT_JOIN_TOKEN_TTL_SECONDS = 15 * 60;

/** Tope configurable: un `joinToken` nunca vive más de 2 h (una partida + margen). */
export const MAX_JOIN_TOKEN_TTL_SECONDS = 2 * 60 * 60;

/** Audiencia del token: la room de evento de Colyseus. */
export const JOIN_TOKEN_AUDIENCE = "escaperoom:event-room";
const ISSUER = "escaperoom:web";
/** Tope de longitud aceptada (defensa ante payloads enormes en el join). */
const MAX_TOKEN_LENGTH = 2048;

export type JoinTokenEnv = Record<string, string | undefined>;

export type JoinTokenConfig = { secret: string; ttlSeconds: number };

/** Lee la configuración; `null` (canje desactivado) si falta el secreto en producción. */
export function readJoinTokenConfig(env: JoinTokenEnv = process.env): JoinTokenConfig | null {
  const configured = env.JOIN_TOKEN_SECRET?.trim();
  const secret = configured || (env.NODE_ENV === "production" ? undefined : DEV_JOIN_TOKEN_SECRET);
  if (!secret) return null;
  const rawTtl = Number.parseInt(env.JOIN_TOKEN_TTL_SECONDS ?? "", 10);
  const ttlSeconds =
    Number.isInteger(rawTtl) && rawTtl > 0
      ? Math.min(rawTtl, MAX_JOIN_TOKEN_TTL_SECONDS)
      : DEFAULT_JOIN_TOKEN_TTL_SECONDS;
  return { secret, ttlSeconds };
}

/** Lo que la room necesita saber de quien entra. */
export type JoinClaims = {
  /** Identidad del jugador: `user:<id>` con cuenta, `guest:<uuid>` sin ella. */
  playerId: string;
  /** Nombre visible en la partida. */
  displayName: string;
  eventId: string;
  sessionId: string;
  groupId: string | null;
};

type JoinTokenPayload = {
  iss: typeof ISSUER;
  aud: typeof JOIN_TOKEN_AUDIENCE;
  sub: string;
  name: string;
  eid: string;
  sid: string;
  gid: string | null;
  /** Segundos desde epoch. */
  iat: number;
  exp: number;
};

export type JoinTokenError = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED";

export type JoinTokenResult =
  { ok: true; claims: JoinClaims; expiresAt: number } | { ok: false; error: JoinTokenError };

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

/** Clave de firma derivada (separación de dominio respecto a otros usos del secreto). */
function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("escaperoom/join-token/v1").digest();
}

function sign(secret: string, input: string): string {
  return createHmac("sha256", signingKey(secret)).update(input).digest("base64url");
}

/** Firma un `joinToken`; `now` y `expiresAt` en ms. */
export function signJoinToken(
  secret: string,
  claims: JoinClaims,
  opts: { now: number; expiresAt: number },
): string {
  const payload: JoinTokenPayload = {
    iss: ISSUER,
    aud: JOIN_TOKEN_AUDIENCE,
    sub: claims.playerId,
    name: claims.displayName,
    eid: claims.eventId,
    sid: claims.sessionId,
    gid: claims.groupId,
    iat: Math.floor(opts.now / 1000),
    exp: Math.floor(opts.expiresAt / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${HEADER}.${body}`;
  return `${input}.${sign(secret, input)}`;
}

/**
 * Verifica firma, cabecera (solo HS256: nada de `alg: none`), audiencia y
 * caducidad (`now` en ms, inyectable en tests).
 */
export function verifyJoinToken(
  secret: string,
  token: unknown,
  now: number = Date.now(),
): JoinTokenResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: "MALFORMED" };
  }
  const [header, body, signature, extra] = token.split(".");
  if (!header || !body || !signature || extra !== undefined) {
    return { ok: false, error: "MALFORMED" };
  }
  if (header !== HEADER) return { ok: false, error: "MALFORMED" };

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
  return {
    ok: true,
    expiresAt: payload.exp * 1000,
    claims: {
      playerId: payload.sub,
      displayName: payload.name,
      eventId: payload.eid,
      sessionId: payload.sid,
      groupId: payload.gid,
    },
  };
}

function isPayload(value: unknown): value is JoinTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 128;
  return (
    c.iss === ISSUER &&
    c.aud === JOIN_TOKEN_AUDIENCE &&
    text(c.sub) &&
    text(c.name) &&
    text(c.eid) &&
    text(c.sid) &&
    (c.gid === null || text(c.gid)) &&
    typeof c.iat === "number" &&
    typeof c.exp === "number" &&
    Number.isFinite(c.exp)
  );
}
