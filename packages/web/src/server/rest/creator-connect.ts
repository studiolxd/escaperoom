import {
  CreatorConnectError,
  type Actor,
  type CreatorConnectErrorCode,
  type CreatorConnectService,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE } from "./_http";

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
  ONBOARDING_NOT_COMPLETE: 409,
};

const handle = handleDomainErrors(CreatorConnectError, STATUS_BY_CODE);

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

    /** `GET /api/me/stripe-connect/dashboard` — enlace de un solo uso al dashboard Express. */
    async getStripeConnectDashboard(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        deps.connect.authorize(actor);
        const { url } = await deps.connect.getDashboardLink(actor);
        return Response.json({ url }, { headers: NO_STORE });
      });
    },
  };
}
