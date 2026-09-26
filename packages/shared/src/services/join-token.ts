import { createHmac, timingSafeEqual } from "node:crypto";
import { isDevFallbackAllowed } from "@escaperoom/env";

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

/** Tope configurable: un `joinToken` nunca vive más de 2 h (una partida + margen). */
export const MAX_JOIN_TOKEN_TTL_SECONDS = 2 * 60 * 60;

/**
 * Caducidad por defecto (C-1/C-2, auditoría 2026-09-24): el mismo token sirve
 * tanto para el `join` inicial como para volver a entrar en la MISMA plaza si
 * la pestaña se cierra o cae la red (`EventRoom.onJoin` la reconoce por
 * `playerId` y hereda el estado — `adoptSeat`, `game-room.ts`). Con 15 min una
 * desconexión tardía ya no podía reentrar aunque su plaza siguiera reservada
 * durante toda la partida (specs/11 §8.1); se sube al tope configurable (2 h,
 * cubre partidas largas + margen). El operador puede acortarlo con
 * `JOIN_TOKEN_TTL_SECONDS` si su catálogo no tiene salas tan largas.
 */
export const DEFAULT_JOIN_TOKEN_TTL_SECONDS = MAX_JOIN_TOKEN_TTL_SECONDS;

/**
 * Ticket duración-salas: margen sobre la duración de la partida para el
 * lobby (antes de `start_game`) y la pantalla de resultados
 * (`RESULTS_ROOM_LIFETIME_SEC` de `colyseus-server`, 5 min) — igual criterio
 * que `PLAY_SESSION_STALE_AFTER_SECONDS` documentaba antes de este ticket.
 */
const JOIN_TOKEN_DURATION_MARGIN_SECONDS = 30 * 60;

/**
 * Techo del `joinToken` para un evento "sin duración" (specs/11 §8: "vale
 * mientras la room exista"). Un JWT no puede vivir de verdad para siempre —
 * este techo es la aproximación práctica: generoso para cualquier jornada
 * real, pero acotado para no firmar tokens que vivan indefinidamente.
 *
 * **Pendiente** (anotado en la PR del ticket): esto solo se aplica cuando el
 * ORGANIZADOR fija el override "sin duración" en `event.config.timeLimitMinutes`
 * — si es la SALA la que declara `meta.timeLimitMinutes: null` sin que el
 * evento la sobrescriba, `redeem` no lo sabe hoy (no carga el `RoomPackage`)
 * y sigue cayendo en `ttlSeconds` por defecto (el tope de 2 h). Cerrarlo del
 * todo necesita que `redeem` cargue el paquete de la sala, no solo el evento.
 */
export const UNLIMITED_EVENT_JOIN_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * TTL del `joinToken` para ESTE evento (ticket duración-salas): si el
 * organizador fijó un override de duración (`event.config.timeLimitMinutes`),
 * el token tiene que durar al menos toda la partida + margen, no solo el
 * `ttlSeconds` por defecto (pensado para el límite de 1 h de antes de este
 * ticket). Sin override, `undefined`, se mantiene `defaultTtlSeconds` tal
 * cual (el caso de siempre).
 */
export function resolveEventJoinTokenTtlSeconds(
  timeLimitOverrideMinutes: number | null | undefined,
  defaultTtlSeconds: number,
): number {
  if (timeLimitOverrideMinutes === undefined) return defaultTtlSeconds;
  if (timeLimitOverrideMinutes === null) return UNLIMITED_EVENT_JOIN_TOKEN_TTL_SECONDS;
  return Math.max(
    defaultTtlSeconds,
    timeLimitOverrideMinutes * 60 + JOIN_TOKEN_DURATION_MARGIN_SECONDS,
  );
}

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
  const secret = configured || (isDevFallbackAllowed(env) ? DEV_JOIN_TOKEN_SECRET : undefined);
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

// ── Token de observador (ticket 5.9) ───────────────────────────────────────

/**
 * Audiencia del token de observador: la misma room de evento, pero en **modo
 * observador** (specs/19 §2: "observar nunca añade un jugador"). Una audiencia
 * distinta impide usar un token de observador como `joinToken` y viceversa.
 */
export const SPECTATOR_TOKEN_AUDIENCE = "escaperoom:event-spectator";

/** Caducidad del token de observador: solo sirve para hacer el `join` (5 min). */
export const SPECTATOR_TOKEN_TTL_SECONDS = 5 * 60;

/** Lo que la room necesita saber de un observador (el organizador del evento). */
export type SpectatorClaims = {
  /** `user.id` del organizador. */
  organizerId: string;
  eventId: string;
  sessionId: string;
};

type SpectatorTokenPayload = {
  iss: typeof ISSUER;
  aud: typeof SPECTATOR_TOKEN_AUDIENCE;
  sub: string;
  eid: string;
  sid: string;
  iat: number;
  exp: number;
};

export type SpectatorTokenResult =
  { ok: true; claims: SpectatorClaims; expiresAt: number } | { ok: false; error: JoinTokenError };

/** Clave de firma propia del observador (separación de dominio respecto al `joinToken`). */
function spectatorKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("escaperoom/spectator-token/v1").digest();
}

function signSpectator(secret: string, input: string): string {
  return createHmac("sha256", spectatorKey(secret)).update(input).digest("base64url");
}

/** Firma un token de observador (web, tras comprobar que el actor es el organizador). */
export function signSpectatorToken(
  secret: string,
  claims: SpectatorClaims,
  opts: { now: number; expiresAt: number },
): string {
  const payload: SpectatorTokenPayload = {
    iss: ISSUER,
    aud: SPECTATOR_TOKEN_AUDIENCE,
    sub: claims.organizerId,
    eid: claims.eventId,
    sid: claims.sessionId,
    iat: Math.floor(opts.now / 1000),
    exp: Math.floor(opts.expiresAt / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${HEADER}.${body}`;
  return `${input}.${signSpectator(secret, input)}`;
}

/** Verifica un token de observador (mismas reglas que `verifyJoinToken`). */
export function verifySpectatorToken(
  secret: string,
  token: unknown,
  now: number = Date.now(),
): SpectatorTokenResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: "MALFORMED" };
  }
  const [header, body, signature, extra] = token.split(".");
  if (!header || !body || !signature || extra !== undefined || header !== HEADER) {
    return { ok: false, error: "MALFORMED" };
  }
  const expected = Buffer.from(signSpectator(secret, `${header}.${body}`));
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
  if (!isSpectatorPayload(payload)) return { ok: false, error: "MALFORMED" };
  if (payload.exp * 1000 <= now) return { ok: false, error: "EXPIRED" };
  return {
    ok: true,
    expiresAt: payload.exp * 1000,
    claims: { organizerId: payload.sub, eventId: payload.eid, sessionId: payload.sid },
  };
}

function isSpectatorPayload(value: unknown): value is SpectatorTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 128;
  return (
    c.iss === ISSUER &&
    c.aud === SPECTATOR_TOKEN_AUDIENCE &&
    text(c.sub) &&
    text(c.eid) &&
    text(c.sid) &&
    typeof c.iat === "number" &&
    typeof c.exp === "number" &&
    Number.isFinite(c.exp)
  );
}
