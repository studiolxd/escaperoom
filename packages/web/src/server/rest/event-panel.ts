import {
  EventPanelError,
  type Actor,
  type EventPanelErrorCode,
  type EventPanelService,
} from "@escaperoom/shared/services";

/** Dependencias inyectables de los handlers del panel (testeables sin Postgres ni Colyseus). */
export type EventPanelHandlerDeps = {
  panel: EventPanelService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type EventPanelRouteContext = { params: Promise<{ id: string }> };
export type EventSessionRouteContext = { params: Promise<{ id: string; sessionId: string }> };

const STATUS_BY_CODE: Record<EventPanelErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  SESSION_NOT_LIVE: 409,
  SPECTATOR_UNAVAILABLE: 503,
};

const NO_STORE = { "Cache-Control": "no-store" };

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EventPanelError) {
      return Response.json(
        { error: { code: err.code, message: err.message } },
        { status: STATUS_BY_CODE[err.code], headers: NO_STORE },
      );
    }
    throw err;
  }
}

/**
 * Handlers REST del panel del organizador (ticket 5.9, specs/19 §2).
 * Adaptadores finos sobre `EventPanelService`: la autorización (solo el
 * organizador del evento) y el cruce con Colyseus viven en el servicio.
 */
export function createEventPanelHandlers(deps: EventPanelHandlerDeps) {
  return {
    /** `GET /api/events/:id/dashboard` — dashboard + progreso en vivo + ranking. */
    async getDashboard(request: Request, ctx: EventPanelRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        return Response.json(await deps.panel.getDashboard(actor, id), { headers: NO_STORE });
      });
    },

    /** `GET /api/events/:id/progress/export?locale=` — progreso/ranking en CSV (adjunto). */
    async getProgressCsv(request: Request, ctx: EventPanelRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const locale = new URL(request.url).searchParams.get("locale") ?? undefined;
        const { csv, filename } = await deps.panel.exportProgressCsv(actor, id, { locale });
        return new Response(csv, {
          headers: {
            ...NO_STORE,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      });
    },

    /** `POST /api/events/:id/sessions/:sessionId/spectate` — token de observador. */
    async postSpectate(request: Request, ctx: EventSessionRouteContext): Promise<Response> {
      return handle(async () => {
        const { id, sessionId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const ticket = await deps.panel.issueSpectatorTicket(actor, id, sessionId);
        return Response.json(ticket, { headers: NO_STORE });
      });
    },
  };
}
