import {
  EventError,
  type Actor,
  type EventErrorCode,
  type EventService,
  type EventView,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE, queryOf, readJson } from "./_http";

/** Dependencias inyectables de los handlers de eventos (testeables sin Postgres ni Stripe). */
export type EventHandlerDeps = {
  events: EventService;
  resolveActor: (request: Request) => Promise<Actor>;
  /** URLs de retorno del Checkout, construidas por el adaptador (origen de la petición, B-21). */
  buildUrls: (eventId: string) => { successUrl: string; cancelUrl: string };
};

/** Contexto de ruta dinámica de Next (App Router): `params` es asíncrono. */
export type EventRouteContext = { params: Promise<{ id: string }> };

const STATUS_BY_CODE: Record<EventErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  ROOM_VERSION_UNAVAILABLE: 422,
  SALE_EVENTS_DISABLED: 422,
  PRICING_UNAVAILABLE: 422,
  EVENT_NOT_EDITABLE: 409,
  CHECKOUT_NOT_REQUIRED: 409,
  PAYMENT_REQUIRED: 409,
  PAYMENT_GATEWAY_UNAVAILABLE: 501,
};

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(EventError, STATUS_BY_CODE);

/** Forma pública de un evento: `playersPurchased` se expone como `playersPlanned` (la entrada). */
export function eventJson(e: EventView) {
  return {
    id: e.id,
    organizerId: e.organizerId,
    roomId: e.roomId,
    roomVersionId: e.roomVersionId,
    title: e.title,
    audience: e.audience,
    status: e.status,
    maxSimultaneousSessions: e.maxSimultaneousSessions,
    groupingMode: e.groupingMode,
    requireConfirmation: e.requireConfirmation,
    expiryRules: e.expiryRules,
    playersPlanned: e.playersPurchased,
    allowVideo: e.config.allowVideo,
    recordingEnabled: e.config.recordingEnabled,
    recordingAcceptedAt: e.config.recordingAcceptedAt,
    pricingSnapshot: e.pricingSnapshot,
    pricing: e.pricing,
    payment: { status: e.config.payment.status, paidAt: e.config.payment.paidAt },
    activatable: e.activatable,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * Handlers REST de eventos (specs/13 §6.1). Adaptadores finos sobre
 * `EventService`: autorización, validación y precio viven en el servicio.
 */
export function createEventHandlers(deps: EventHandlerDeps) {
  return {
    /** `POST /api/events` — crea el evento (201). */
    async createEvent(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        // La autorización va antes que el cuerpo: un anónimo recibe 401, no 400.
        deps.events.authorize(actor);
        const event = await deps.events.createEvent(actor, await readJson(request));
        return Response.json(eventJson(event), { status: 201, headers: NO_STORE });
      });
    },

    /** `GET /api/events/:id` — detalle + resumen (organizador o admin). */
    async getEvent(request: Request, ctx: EventRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const event = await deps.events.getEvent(actor, id);
        return Response.json(
          { ...eventJson(event), summary: event.summary },
          { headers: NO_STORE },
        );
      });
    },

    /** `PATCH /api/events/:id` — edita la configuración mientras `status = draft`. */
    async patchEvent(request: Request, ctx: EventRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.events.authorize(actor);
        const event = await deps.events.updateEvent(actor, id, await readJson(request));
        return Response.json(eventJson(event), { headers: NO_STORE });
      });
    },

    /** `POST /api/events/:id/checkout` — abre el pago (si no es autoventa). */
    async postCheckout(request: Request, ctx: EventRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const { event, checkoutUrl } = await deps.events.startCheckout(actor, id, deps.buildUrls(id));
        return Response.json({ event: eventJson(event), checkoutUrl }, { headers: NO_STORE });
      });
    },

    /**
     * `draft → active` con el pago saldado, sin generar nada. La ruta
     * `POST /api/events/:id/activate` usa `createAccessKeyHandlers().postActivate`
     * (5.5), que además crea las sesiones y las claves.
     */
    async postActivate(request: Request, ctx: EventRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const event = await deps.events.activate(actor, id);
        return Response.json(eventJson(event), { headers: NO_STORE });
      });
    },

    /** `GET /api/me/events?cursor=&limit=` — eventos propios como organizador. */
    async listMyEvents(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const query = queryOf(request, ["cursor", "limit"]);
        const page = await deps.events.listMyEvents(actor, query);
        return Response.json(
          { items: page.items.map(eventJson), nextCursor: page.nextCursor },
          { headers: NO_STORE },
        );
      });
    },
  };
}
