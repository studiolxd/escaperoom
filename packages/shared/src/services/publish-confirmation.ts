import { createHmac, timingSafeEqual } from "node:crypto";
import { isDevFallbackAllowed } from "@escaperoom/env";
import { type Actor } from "./actor";
import { requireUser } from "./common";
import {
  RoomPublishError,
  type PublishCheck,
  type PublishResult,
  type RoomPublishErrorCode,
  type RoomPublishErrorDetails,
  type RoomPublishService,
} from "./room-publish";

/**
 * Confirmación humana de la publicación pedida por el MCP (ticket 4.5,
 * specs/10 §1.1 y §5: «`publish` es irreversible y lleva confirmación humana
 * explícita»).
 *
 * El agente NO publica: `request` comprueba que la sala es publicable (el
 * mismo `checkPublishable` de 3.9: validador en verde, audios moderados) y
 * devuelve un **token de confirmación** firmado. El humano lo abre en la web
 * con su sesión y confirma; solo entonces `confirm` llama a `publish` de 3.9.
 *
 * El token es **sin estado** (HMAC, como el `joinToken` de 5.8) y liga:
 *
 * - `rid` + `sub`: la sala y su autor (solo esa cuenta puede confirmar);
 * - `ph`: la huella del `RoomPackage` que se validó (`computePackageHash`). Si
 *   el draft cambia después, `publish` falla con `DRAFT_CHANGED`: lo que se
 *   publica es exactamente lo que se aprobó;
 * - `base`: la última versión publicada al pedirla. Se comprueba dentro del
 *   lock de la sala, así que tras la primera publicación el mismo token falla
 *   con `VERSION_CHANGED`: **un solo uso** sin tabla ni migración;
 * - `notes` y `exp`: las notas de versión y la caducidad.
 *
 * No hay estado que limpiar: una solicitud abandonada simplemente caduca.
 */

/** Secreto de desarrollo: solo fuera de `NODE_ENV=production`. */
export const DEV_PUBLISH_CONFIRM_SECRET = "dev-publish-confirm-secret-no-usar-en-produccion";

/** Caducidad por defecto: 30 min para que el humano revise y confirme. */
export const DEFAULT_PUBLISH_CONFIRM_TTL_SECONDS = 30 * 60;

/** Tope configurable: una solicitud nunca vive más de 24 h. */
export const MAX_PUBLISH_CONFIRM_TTL_SECONDS = 24 * 60 * 60;

/** Longitud máxima de las notas de versión que viajan en el token. */
export const MAX_VERSION_NOTES_LENGTH = 1000;

const AUDIENCE = "escaperoom:publish-confirm";
/** Tope de longitud aceptada (notas de 1000 caracteres multibyte + claims). */
const MAX_TOKEN_LENGTH = 8192;

export type PublishConfirmEnv = Record<string, string | undefined>;

export type PublishConfirmConfig = { secret: string; ttlSeconds: number };

/** Lee la configuración; `null` (publicación por MCP desactivada) sin secreto en producción. */
export function readPublishConfirmConfig(
  env: PublishConfirmEnv = process.env,
): PublishConfirmConfig | null {
  const configured = env.PUBLISH_CONFIRM_SECRET?.trim();
  const secret = configured || (isDevFallbackAllowed(env) ? DEV_PUBLISH_CONFIRM_SECRET : undefined);
  if (!secret) return null;
  const rawTtl = Number.parseInt(env.PUBLISH_CONFIRM_TTL_SECONDS ?? "", 10);
  const ttlSeconds =
    Number.isInteger(rawTtl) && rawTtl > 0
      ? Math.min(rawTtl, MAX_PUBLISH_CONFIRM_TTL_SECONDS)
      : DEFAULT_PUBLISH_CONFIRM_TTL_SECONDS;
  return { secret, ttlSeconds };
}

/** Lo que el humano aprueba al confirmar. */
export type PublishConfirmationClaims = {
  roomId: string;
  /** Autor que pidió la publicación: solo él puede confirmarla. */
  userId: string;
  packageHash: string;
  /** Última versión publicada al pedirla (`null` = primera publicación). */
  latestSemver: string | null;
  versionNotes: string;
  /** Epoch ms. */
  issuedAt: number;
  /** Epoch ms. */
  expiresAt: number;
};

type TokenPayload = {
  v: 1;
  aud: typeof AUDIENCE;
  rid: string;
  sub: string;
  ph: string;
  base: string | null;
  notes: string;
  /** Segundos desde epoch. */
  iat: number;
  exp: number;
};

export { PUBLISH_CONFIRMATION_ERROR_CODES, type PublishConfirmationErrorCode } from "./error-codes";
import type { PublishConfirmationErrorCode } from "./error-codes";

/** Error del token o de quién confirma (los de la sala son `RoomPublishError`). */
export class PublishConfirmationError extends Error {
  readonly code: PublishConfirmationErrorCode;
  constructor(code: PublishConfirmationErrorCode, message: string) {
    super(message);
    this.name = "PublishConfirmationError";
    this.code = code;
  }
}

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");

/** Firma el token de confirmación (`<payload base64url>~<hmac>`). */
export function signPublishConfirmation(claims: PublishConfirmationClaims, secret: string): string {
  const payload: TokenPayload = {
    v: 1,
    aud: AUDIENCE,
    rid: claims.roomId,
    sub: claims.userId,
    ph: claims.packageHash,
    base: claims.latestSemver,
    notes: claims.versionNotes,
    iat: Math.floor(claims.issuedAt / 1000),
    exp: Math.floor(claims.expiresAt / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}~${sign(body, secret)}`;
}

export type PublishConfirmationTokenResult =
  | { ok: true; claims: PublishConfirmationClaims }
  | { ok: false; error: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

/** Verifica firma, forma y caducidad del token. No mira la sala ni el actor. */
export function verifyPublishConfirmation(
  token: string,
  secret: string,
  now: number = Date.now(),
): PublishConfirmationTokenResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: "MALFORMED" };
  }
  const [body, signature, extra] = token.split("~");
  if (!body || !signature || extra !== undefined) return { ok: false, error: "MALFORMED" };
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, error: "BAD_SIGNATURE" };
  }
  let payload: Partial<TokenPayload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TokenPayload>;
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  const { v, aud, rid, sub, ph, base, notes, iat, exp } = payload ?? {};
  if (
    v !== 1 ||
    aud !== AUDIENCE ||
    typeof rid !== "string" ||
    typeof sub !== "string" ||
    typeof ph !== "string" ||
    (base !== null && typeof base !== "string") ||
    typeof notes !== "string" ||
    typeof iat !== "number" ||
    typeof exp !== "number"
  ) {
    return { ok: false, error: "MALFORMED" };
  }
  if (exp * 1000 <= now) return { ok: false, error: "EXPIRED" };
  return {
    ok: true,
    claims: {
      roomId: rid,
      userId: sub,
      packageHash: ph,
      latestSemver: base ?? null,
      versionNotes: notes,
      issuedAt: iat * 1000,
      expiresAt: exp * 1000,
    },
  };
}

/** Solicitud de publicación pendiente de confirmación humana. */
export type PublishConfirmationRequest = {
  token: string;
  claims: PublishConfirmationClaims;
  /** Cómo quedaría la publicación (versión siguiente, informe con los avisos). */
  check: PublishCheck;
};

/** Estado actual de una solicitud, para la pantalla de confirmación. */
export type PublishConfirmationState =
  | { status: "ready"; claims: PublishConfirmationClaims; check: PublishCheck }
  /** El draft o el histórico cambiaron: hay que volver a pedirla. */
  | {
      status: "stale";
      reason: Extract<RoomPublishErrorCode, "DRAFT_CHANGED" | "VERSION_CHANGED">;
      claims: PublishConfirmationClaims;
      check: PublishCheck;
    }
  /** La sala ya no es publicable (validador, moderación, sala retirada…). */
  | {
      status: "blocked";
      claims: PublishConfirmationClaims;
      error: { code: RoomPublishErrorCode; message: string; details: RoomPublishErrorDetails };
    };

function normalizeNotes(versionNotes: unknown): string {
  const notes = typeof versionNotes === "string" ? versionNotes.trim() : "";
  if (!notes) {
    throw new PublishConfirmationError("VALIDATION_ERROR", "Las notas de versión son obligatorias");
  }
  if (notes.length > MAX_VERSION_NOTES_LENGTH) {
    throw new PublishConfirmationError(
      "VALIDATION_ERROR",
      `Las notas de versión admiten como máximo ${MAX_VERSION_NOTES_LENGTH} caracteres`,
    );
  }
  return notes;
}

/**
 * Servicio de la confirmación humana. Solo depende de `checkPublishable` y
 * `publish` de 3.9: la autorización (solo el autor), el validador y la
 * moderación siguen viviendo allí.
 */
export function createPublishConfirmationService(deps: {
  publish: Pick<RoomPublishService, "checkPublishable" | "publish">;
  config: PublishConfirmConfig;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;

  /** Token válido y del actor que lo usa. */
  function authorize(actor: Actor, token: string): PublishConfirmationClaims {
    requireUser(actor, PublishConfirmationError);
    const verified = verifyPublishConfirmation(token, deps.config.secret, now());
    if (!verified.ok) {
      throw verified.error === "EXPIRED"
        ? new PublishConfirmationError(
            "EXPIRED",
            "La solicitud de publicación ha caducado: pide al agente que la repita",
          )
        : new PublishConfirmationError("INVALID_TOKEN", "El enlace de confirmación no es válido");
    }
    if (verified.claims.userId !== actor.userId) {
      throw new PublishConfirmationError(
        "FORBIDDEN",
        "Esta solicitud de publicación es de otra cuenta",
      );
    }
    return verified.claims;
  }

  return {
    /**
     * Pide publicar (lo llama el MCP): comprueba que la sala es publicable
     * (`VALIDATION_FAILED` con el informe si no) y firma la solicitud. No
     * publica nada.
     */
    async request(
      actor: Actor,
      roomId: string,
      input: { versionNotes: string },
    ): Promise<PublishConfirmationRequest> {
      const versionNotes = normalizeNotes(input.versionNotes);
      const check = await deps.publish.checkPublishable(actor, roomId);
      const issuedAt = now();
      const claims: PublishConfirmationClaims = {
        roomId: check.roomId,
        userId: actor.userId,
        packageHash: check.packageHash,
        latestSemver: check.latestSemver,
        versionNotes,
        issuedAt,
        expiresAt: issuedAt + deps.config.ttlSeconds * 1000,
      };
      return { token: signPublishConfirmation(claims, deps.config.secret), claims, check };
    },

    /** Qué se va a publicar y si sigue siendo confirmable (pantalla de confirmación). */
    async inspect(actor: Actor, token: string): Promise<PublishConfirmationState> {
      const claims = authorize(actor, token);
      let check: PublishCheck;
      try {
        check = await deps.publish.checkPublishable(actor, claims.roomId);
      } catch (error) {
        if (!(error instanceof RoomPublishError)) throw error;
        return {
          status: "blocked",
          claims,
          error: { code: error.code, message: error.message, details: error.details },
        };
      }
      if (check.packageHash !== claims.packageHash) {
        return { status: "stale", reason: "DRAFT_CHANGED", claims, check };
      }
      if (check.latestSemver !== claims.latestSemver) {
        return { status: "stale", reason: "VERSION_CHANGED", claims, check };
      }
      return { status: "ready", claims, check };
    },

    /**
     * El humano confirma: publica con `publish` de 3.9 SOLO si el draft y la
     * última versión son los aprobados (`DRAFT_CHANGED` / `VERSION_CHANGED`).
     */
    async confirm(actor: Actor, token: string): Promise<PublishResult> {
      const claims = authorize(actor, token);
      return deps.publish.publish(
        actor,
        claims.roomId,
        { changelog: claims.versionNotes },
        { packageHash: claims.packageHash, latestSemver: claims.latestSemver },
      );
    },
  };
}

export type PublishConfirmationService = ReturnType<typeof createPublishConfirmationService>;
