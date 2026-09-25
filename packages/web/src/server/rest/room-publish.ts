import {
  RoomPublishError,
  type Actor,
  type RoomPublishErrorCode,
  type RoomPublishService,
  type RoomVersionMeta,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE, readJson } from "./_http";

/** Dependencias inyectables de los handlers de publicación (testeables sin Postgres ni R2). */
export type RoomPublishHandlerDeps = {
  publish: RoomPublishService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type RoomRouteContext = { params: Promise<{ roomId: string }> };
export type RoomVersionRouteContext = { params: Promise<{ roomId: string; versionId: string }> };

export const PUBLISH_STATUS_BY_CODE: Record<RoomPublishErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  // A-22: fijado en specs/13 §1 — VALIDATION_ERROR es 422 en todas las rutas (era 400 aquí).
  VALIDATION_ERROR: 422,
  VERSION_CONFLICT: 409,
  ROOM_NOT_PUBLISHABLE: 409,
  INVALID_PACKAGE: 422,
  UNSUPPORTED_PACKAGE_FORMAT: 422,
  VALIDATION_FAILED: 422,
  ASSETS_NOT_PUBLISHABLE: 422,
  SERIALIZER_UNAVAILABLE: 501,
  DRAFT_CHANGED: 409,
  VERSION_CHANGED: 409,
  ACCOUNT_FROZEN: 403,
  CREATOR_SUSPENDED: 403,
  CREATOR_BANNED: 403,
  CONTENT_BLOCKED: 422,
};

/**
 * Traduce errores de dominio a la forma de error REST (specs/13 §1). El
 * `details` (informe del validador, audios bloqueantes, campos) se spreadea
 * en `error` tal cual (`report`, `reportText`, …), no anidado bajo `details`
 * — así lo espera el editor.
 */
const handle = handleDomainErrors(
  RoomPublishError,
  PUBLISH_STATUS_BY_CODE,
  (err) => ({ ...err.details }) as Record<string, unknown>,
);

export function versionJson(v: RoomVersionMeta) {
  return {
    id: v.id,
    semver: v.semver,
    changelog: v.changelog,
    packageFormat: v.packageFormat,
    assetsHash: v.assetsHash,
    publishedAt: v.publishedAt.toISOString(),
  };
}

/**
 * Handlers REST de publicación y versiones (specs/13 §3–4). Adaptadores finos
 * sobre `RoomPublishService`: autorización y validación viven en el servicio.
 */
export function createRoomPublishHandlers(deps: RoomPublishHandlerDeps) {
  return {
    /** `POST /api/rooms/:roomId/publish` — `{ semver?, changelog? }` → versión creada (201). */
    async postPublish(request: Request, ctx: RoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const body = await readJson(request, { allowEmpty: true });
        const result = await deps.publish.publish(actor, roomId, body);
        return Response.json(
          {
            version: versionJson(result.version),
            warnings: result.report.checks
              .filter((c) => c.status === "warning")
              .map((c) => ({ id: c.id, summary: c.summary })),
            assets: result.assets.map((a) => ({
              key: a.key,
              sha256: a.sha256,
              contentType: a.contentType,
              byteSize: a.byteSize,
            })),
            moderationFlags: result.moderationFlags,
          },
          { status: 201, headers: NO_STORE },
        );
      });
    },

    /** `GET /api/rooms/:roomId/versions` — histórico público (solo metadata). */
    async getVersions(request: Request, ctx: RoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const items = await deps.publish.listVersions(actor, roomId);
        return Response.json({ items: items.map(versionJson), nextCursor: null });
      });
    },

    /** `GET /api/rooms/:roomId/versions/:versionId/package` — el RoomPackage congelado (autor/admin). */
    async getVersionPackage(request: Request, ctx: RoomVersionRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId, versionId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const result = await deps.publish.getVersionPackage(actor, roomId, versionId);
        return Response.json(
          { version: versionJson(result.version), package: result.package },
          { headers: NO_STORE },
        );
      });
    },
  };
}
