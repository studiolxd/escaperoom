import {
  CreatorConnectError,
  type Actor,
  type CreatorConnectErrorCode,
  type CreatorConnectService,
} from "@escaperoom/shared/services";

/** Dependencias inyectables de los handlers de Connect (testeables sin Postgres ni Stripe). */
export type CreatorConnectHandlerDeps = {
  connect: CreatorConnectService;
  resolveActor: (request: Request) => Promise<Actor>;
  buildUrls: () => { refreshUrl: string; returnUrl: string };
};

const STATUS_BY_CODE: Record<CreatorConnectErrorCode, number> = {
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  PAYMENT_GATEWAY_UNAVAILABLE: 501,
};

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
}

async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CreatorConnectError) {
      return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code]);
    }
    throw err;
  }
}

/**
 * Handlers REST de onboarding de Stripe Connect (specs/13 §2). Adaptadores
 * finos sobre `CreatorConnectService`.
 */
export function createCreatorConnectHandlers(deps: CreatorConnectHandlerDeps) {
  return {
    /** `POST /api/me/stripe-connect` — crea la cuenta si hace falta y devuelve la URL de onboarding. */
    async postStripeConnect(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        deps.connect.authorize(actor);
        const { url } = await deps.connect.startOnboarding(actor, deps.buildUrls());
        return Response.json({ url }, { headers: NO_STORE });
      });
    },

    /** `GET /api/me/stripe-connect/status` — `not_started | pending | complete`. */
    async getStripeConnectStatus(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        deps.connect.authorize(actor);
        const { status } = await deps.connect.getStatus(actor);
        return Response.json({ status }, { headers: NO_STORE });
      });
    },
  };
}
