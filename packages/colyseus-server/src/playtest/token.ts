import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token del link de prueba (ticket 3.8): `base64url(payload)~base64url(hmac)`,
 * HMAC-SHA256 con una clave derivada de `PLAYTEST_SECRET`. No es un JWT a
 * propósito: el único consumidor es este servidor, el payload es mínimo
 * (`pid` + `exp`) y no lleva nada secreto — **el paquete nunca viaja en él**.
 * Quien tiene el link puede jugar esa prueba hasta que caduque. El separador
 * es `~` (no `.`) porque el token va en la ruta de la página y el proxy de
 * next-intl trata los segmentos con punto como ficheros estáticos.
 */

/** Separador entre payload y firma (fuera del alfabeto base64url). */
export const PLAYTEST_TOKEN_SEPARATOR = "~";

export interface PlaytestTokenPayload {
  /** Versión del formato. */
  v: 1;
  /** Id del playtest en el registro. */
  pid: string;
  /** Caducidad, en segundos desde epoch. */
  exp: number;
}

export type PlaytestTokenError = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED";

export type PlaytestTokenResult =
  { ok: true; payload: PlaytestTokenPayload } | { ok: false; error: PlaytestTokenError };

/** Clave de firma de links: separada de la que autentica la ruta interna. */
function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("escaperoom/playtest-token/v1").digest();
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", signingKey(secret)).update(body).digest("base64url");
}

export function signPlaytestToken(
  secret: string,
  input: { playtestId: string; expiresAt: number },
): string {
  const payload: PlaytestTokenPayload = {
    v: 1,
    pid: input.playtestId,
    exp: Math.floor(input.expiresAt / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}${PLAYTEST_TOKEN_SEPARATOR}${sign(secret, body)}`;
}

/** Verifica firma y caducidad (`now` en ms, inyectable en tests). */
export function verifyPlaytestToken(
  secret: string,
  token: unknown,
  now: number = Date.now(),
): PlaytestTokenResult {
  if (typeof token !== "string" || token.length > 512) return { ok: false, error: "MALFORMED" };
  const [body, signature, extra] = token.split(PLAYTEST_TOKEN_SEPARATOR);
  if (!body || !signature || extra !== undefined) return { ok: false, error: "MALFORMED" };

  const expected = Buffer.from(sign(secret, body));
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
  return { ok: true, payload };
}

function isPayload(value: unknown): value is PlaytestTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.pid === "string" &&
    candidate.pid.length > 0 &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}

/**
 * Comparación en tiempo constante del bearer de la ruta interna contra el
 * secreto (HMAC de ambos lados para igualar longitudes).
 */
export function isInternalSecret(secret: string, header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (value: string) =>
    createHmac("sha256", "escaperoom/playtest-internal/v1").update(value).digest();
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(secret));
}
