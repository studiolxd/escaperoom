import { tooManyRequestsResponse } from "@escaperoom/kit/rate-limit/http";
import {
  ModerationError,
  REPORT_CATEGORY_SEVERITY,
  type Actor,
  type AppealRow,
  type ContentReportRow,
  type ModerationErrorCode,
  type ModerationService,
  type QueueItem,
} from "@escaperoom/shared/services";
import { consumeRateLimit } from "@/server/rate-limit";
import { handleDomainErrors, NO_STORE, queryOf, readJson } from "./_http";

/** Dependencias inyectables de los handlers de moderación (testeables sin Postgres). */
export type ModerationHandlerDeps = {
  moderation: ModerationService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type ModerationIdRouteContext = { params: Promise<{ id: string }> };
export type ModerationRoomRouteContext = { params: Promise<{ roomId: string }> };

const STATUS_BY_CODE: Record<ModerationErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  REPORT_REASON_REQUIRED: 422,
  ALREADY_REVIEWED: 409,
  APPEAL_NOT_ALLOWED: 409,
  APPEAL_ALREADY_PENDING: 409,
  NOTHING_TO_APPEAL: 409,
};

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(ModerationError, STATUS_BY_CODE);

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Lo que ve quien reporta: su reporte, sin datos internos de moderación. */
function reporterJson(r: ContentReportRow) {
  return {
    id: r.id,
    targetType: r.targetType,
    category: r.category,
    severity: r.severity,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Vista del moderador (cola). */
export function reportJson(r: ContentReportRow) {
  return {
    id: r.id,
    reporterId: r.reporterId,
    targetType: r.targetType,
    roomId: r.roomId,
    roomVersionId: r.roomVersionId,
    reviewId: r.reviewId,
    targetUserId: r.targetUserId,
    reason: r.reason,
    details: r.details,
    severity: r.severity,
    category: r.category,
    source: r.source,
    status: r.status,
    flags: r.flags,
    slaDueAt: r.slaDueAt.toISOString(),
    actionTaken: r.actionTaken,
    autoActioned: r.autoActioned,
    reviewedBy: r.reviewedBy,
    reviewedAt: iso(r.reviewedAt),
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt.toISOString(),
  };
}

function queueItemJson(item: QueueItem) {
  return {
    ...reportJson(item.report),
    overdue: item.overdue,
    reportsOnTarget: item.reportsOnTarget,
    activeEvent: item.activeEvent,
  };
}

export function appealJson(a: AppealRow & { overdue?: boolean }) {
  return {
    id: a.id,
    creatorId: a.creatorId,
    roomId: a.roomId,
    contentReportId: a.contentReportId,
    strikeId: a.strikeId,
    reason: a.reason,
    status: a.status,
    reviewedBy: a.reviewedBy,
    resolutionNote: a.resolutionNote,
    slaDueAt: a.slaDueAt.toISOString(),
    overdue: a.overdue ?? false,
    createdAt: a.createdAt.toISOString(),
    reviewedAt: iso(a.reviewedAt),
  };
}

function standingJson(s: Awaited<ReturnType<ModerationService["standing"]>>) {
  return { ...s, suspendedUntil: iso(s.suspendedUntil) };
}

/**
 * Handlers REST de moderación (ticket 6.1, specs/13 §3 y §10, specs/17).
 * Adaptadores finos sobre `ModerationService`: la autorización (moderador,
 * autor de la sala) y la validación viven en el servicio. En las rutas de
 * moderador el guard va antes que el cuerpo: un anónimo recibe 401, no 400.
 */
export function createModerationHandlers(deps: ModerationHandlerDeps) {
  const { moderation } = deps;

  async function createReport(request: Request, body: unknown): Promise<Response> {
    // A-3/ADR-013 (revisado 2026-09-25): la categoría no dispara ya ninguna
    // acción automática, pero sigue entrando con prioridad máxima en la cola;
    // esta cuota extra (se suma a `report-write`) acota el spam de reportes
    // "críticos" falsos, ya que revisarlos primero cuesta más que uno normal.
    const category =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { category?: unknown }).category
        : undefined;
    if (
      typeof category === "string" &&
      REPORT_CATEGORY_SEVERITY[category as keyof typeof REPORT_CATEGORY_SEVERITY] === "critical"
    ) {
      const quota = await consumeRateLimit("report-write-critical", request);
      if (!quota.ok) return tooManyRequestsResponse(quota.retryAfter);
    }

    const actor = await deps.resolveActor(request);
    const { report, created } = await moderation.report(actor, body);
    return Response.json(reporterJson(report), {
      status: created ? 201 : 200,
      headers: NO_STORE,
    });
  }

  return {
    /** `POST /api/rooms/:roomId/report` — `{ category, reason, details? }` (specs/13 §3). */
    async postRoomReport(request: Request, ctx: ModerationRoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const body = await readJson(request, { allowEmpty: true });
        const fields = body && typeof body === "object" && !Array.isArray(body) ? body : {};
        return createReport(request, { ...fields, targetType: "room", targetId: roomId });
      });
    },

    /** `POST /api/reports` — `{ targetType: room|review|user, targetId, category, reason, details? }`. */
    async postReport(request: Request): Promise<Response> {
      return handle(async () =>
        createReport(request, await readJson(request, { allowEmpty: true })),
      );
    },

    /** `GET /api/admin/reports?status=&severity=&limit=` — cola priorizada con SLA. */
    async listReports(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const items = await moderation.listQueue(
          actor,
          queryOf(request, ["status", "severity", "limit"]),
        );
        return Response.json(
          { items: items.map(queueItemJson), nextCursor: null },
          { headers: NO_STORE },
        );
      });
    },

    /** `PATCH /api/admin/reports/:id` — `{ status: actioned|dismissed, action?, resolutionNote? }`. */
    async patchReport(request: Request, ctx: ModerationIdRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        await moderation.authorizeModeration(actor);
        const result = await moderation.resolveReport(
          actor,
          id,
          await readJson(request, { allowEmpty: true }),
        );
        return Response.json(
          {
            report: reportJson(result.report),
            strike: result.strike
              ? {
                  ...result.strike,
                  createdAt: result.strike.createdAt.toISOString(),
                  revokedAt: iso(result.strike.revokedAt),
                }
              : null,
            standing: result.standing ? standingJson(result.standing) : null,
          },
          { headers: NO_STORE },
        );
      });
    },

    /** `POST /api/rooms/:roomId/appeal` — `{ reason, contentReportId? }` (autor de la sala). */
    async postRoomAppeal(request: Request, ctx: ModerationRoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const appeal = await moderation.appealRoom(
          actor,
          roomId,
          await readJson(request, { allowEmpty: true }),
        );
        return Response.json(appealJson(appeal), { status: 201, headers: NO_STORE });
      });
    },

    /** `POST /api/me/appeal` — `{ reason }`: apela la suspensión o el ban de la cuenta. */
    async postAccountAppeal(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const appeal = await moderation.appealAccount(
          actor,
          await readJson(request, { allowEmpty: true }),
        );
        return Response.json(appealJson(appeal), { status: 201, headers: NO_STORE });
      });
    },

    /** `GET /api/me/moderation` — estado del creador (strikes vigentes, suspensión…). */
    async getMyStanding(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        return Response.json(standingJson(await moderation.standing(actor)), {
          headers: NO_STORE,
        });
      });
    },

    /** `GET /api/admin/appeals?status=pending&limit=` — cola de apelaciones. */
    async listAppeals(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const items = await moderation.listAppeals(actor, queryOf(request, ["status", "limit"]));
        return Response.json(
          { items: items.map(appealJson), nextCursor: null },
          { headers: NO_STORE },
        );
      });
    },

    /** `PATCH /api/admin/appeals/:id` — `{ decision: upheld|overturned, resolutionNote? }`. */
    async patchAppeal(request: Request, ctx: ModerationIdRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        await moderation.authorizeModeration(actor);
        const result = await moderation.resolveAppeal(
          actor,
          id,
          await readJson(request, { allowEmpty: true }),
        );
        return Response.json(
          { appeal: appealJson(result.appeal), standing: standingJson(result.standing) },
          { headers: NO_STORE },
        );
      });
    },
  };
}
