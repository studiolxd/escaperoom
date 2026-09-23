import {
  AccessKeyError,
  EventError,
  type AccessKeyErrorCode,
  type AccessKeyRow,
  type AccessKeyService,
  type Actor,
  type GameSessionRef,
  type RedeemResult,
  type RedeemService,
} from "@escaperoom/shared/services";
import { eventJson, type EventRouteContext } from "./events";

/** Dependencias inyectables de los handlers de claves (testeables sin Postgres). */
export type AccessKeyHandlerDeps = {
  accessKeys: AccessKeyService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type AccessKeyRouteContext = { params: Promise<{ code: string }> };

const STATUS_BY_CODE: Record<AccessKeyErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  EVENT_NOT_ACTIVE: 409,
  EVENT_EXPIRED: 409,
  SEAT_LIMIT_EXCEEDED: 409,
  ACCESS_KEY_NOT_ROTATING: 409,
  ACCESS_KEY_INVALID: 404,
  ACCESS_KEY_USED: 409,
  ACCESS_KEY_EXPIRED: 409,
  ACCESS_KEY_NOT_CONFIRMED: 409,
  SESSION_FULL: 409,
  SESSION_REQUIRED: 422,
  CONFLICT: 409,
};

/** Errores de 5.4 que puede lanzar la activación (`events.activate`). */
const EVENT_STATUS_BY_CODE: Partial<Record<string, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EVENT_NOT_EDITABLE: 409,
  PAYMENT_REQUIRED: 409,
};

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number, extra = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: NO_STORE });
}

class BadJsonError extends Error {}

/** Cuerpo JSON; `allowEmpty` admite un POST sin cuerpo (activar sin plan). */
async function readJson(request: Request, allowEmpty = false): Promise<unknown> {
  const text = await request.text();
  if (allowEmpty && text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadJsonError("El cuerpo no es JSON válido");
  }
}

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AccessKeyError) {
      const extra = { ...(err.issues.length > 0 ? { issues: err.issues } : {}), ...err.details };
      return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code], extra);
    }
    if (err instanceof EventError) {
      const extra = err.issues.length > 0 ? { issues: err.issues } : {};
      return errorResponse(err.code, err.message, EVENT_STATUS_BY_CODE[err.code] ?? 422, extra);
    }
    if (err instanceof BadJsonError) return errorResponse("BAD_REQUEST", err.message, 400);
    throw err;
  }
}

/** Forma pública de una clave (el organizador ve el código en claro: es quien lo reparte). */
export function accessKeyJson(k: AccessKeyRow) {
  return {
    code: k.code,
    eventId: k.eventId,
    type: k.keyType,
    status: k.status,
    sessionId: k.sessionId,
    groupId: k.groupId,
    email: k.email,
    singleUse: k.singleUse,
    seats: k.seats,
    redeemedCount: k.redeemedCount,
    requireConfirmation: k.requireConfirmation,
    regeneratedFrom: k.regeneratedFrom,
    confirmedAt: k.confirmedAt?.toISOString() ?? null,
    activatedAt: k.activatedAt?.toISOString() ?? null,
    usedAt: k.usedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  };
}

function sessionJson(s: GameSessionRef) {
  return { id: s.id, name: s.name, capacity: s.capacity, status: s.status };
}

/**
 * Handlers REST de claves (specs/13 §6.2) y de la activación con generación
 * (§6.1). Adaptadores finos sobre `AccessKeyService`.
 */
export function createAccessKeyHandlers(deps: AccessKeyHandlerDeps) {
  return {
    /**
     * `POST /api/events/:id/activate` — `draft → active`, crea las sesiones y
     * genera las claves del `keyPlan` (cuerpo opcional).
     */
    async postActivate(request: Request, ctx: EventRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.accessKeys.authorize(actor);
        const result = await deps.accessKeys.activateEvent(
          actor,
          id,
          await readJson(request, true),
        );
        return Response.json(
          {
            ...eventJson(result.event),
            sessions: result.sessions.map(sessionJson),
            accessKeys: { generated: result.keys.length },
          },
          { headers: NO_STORE },
        );
      });
    },

    /** `POST /api/events/:id/access-keys` — generación a demanda (201). */
    async postAccessKeys(request: Request, ctx: EventRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.accessKeys.authorize(actor);
        const keys = await deps.accessKeys.generateKeys(actor, id, await readJson(request));
        return Response.json(
          { items: keys.map(accessKeyJson) },
          { status: 201, headers: NO_STORE },
        );
      });
    },

    /** `GET /api/events/:id/access-keys?cursor=&limit=&status=` — listado del panel. */
    async listAccessKeys(request: Request, ctx: EventRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const params = new URL(request.url).searchParams;
        const query = Object.fromEntries(
          (["cursor", "limit", "status"] as const).flatMap((k) => {
            const v = params.get(k);
            return v === null ? [] : [[k, v]];
          }),
        );
        const page = await deps.accessKeys.listKeys(actor, id, query);
        return Response.json(
          { items: page.items.map(accessKeyJson), nextCursor: page.nextCursor, seats: page.seats },
          { headers: NO_STORE },
        );
      });
    },

    /** `POST /api/access-keys/:code/regenerate` — rota una clave rotativa (201). */
    async postRegenerate(request: Request, ctx: AccessKeyRouteContext): Promise<Response> {
      return handle(async () => {
        const { code } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const key = await deps.accessKeys.regenerateKey(actor, decodeURIComponent(code));
        return Response.json(accessKeyJson(key), { status: 201, headers: NO_STORE });
      });
    },
  };
}

/** Respuesta del canje (specs/13 §6.2): nunca incluye la clave en claro. */
export function redeemJson(r: RedeemResult) {
  return {
    eventId: r.eventId,
    sessionId: r.sessionId,
    groupId: r.groupId,
    colyseusEndpoint: r.colyseusEndpoint,
    roomName: r.roomName,
    joinToken: r.joinToken,
    expiresAt: r.expiresAt.toISOString(),
    player: r.player,
  };
}

/**
 * `POST /api/access-keys/redeem` — público (el invitado puede no tener cuenta).
 * `redeem: null` = canje desactivado (falta `JOIN_TOKEN_SECRET` en producción).
 */
export function createRedeemHandler(deps: {
  redeem: RedeemService | null;
  resolveActor: (request: Request) => Promise<Actor>;
}) {
  return async function postRedeem(request: Request): Promise<Response> {
    return handle(async () => {
      if (!deps.redeem) {
        return errorResponse("REDEEM_UNAVAILABLE", "El canje de claves no está disponible", 503);
      }
      const actor = await deps.resolveActor(request);
      const result = await deps.redeem.redeem(actor, await readJson(request));
      return Response.json(redeemJson(result), { headers: NO_STORE });
    });
  };
}
