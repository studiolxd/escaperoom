import { docToRoomPackage, type RoomPackageSerializer } from "@escaperoom/editor/validation";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import {
  buildDraftDoc,
  RoomDraftError,
  type Actor,
  type RoomDraftErrorCode,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import {
  renderValidationReport,
  validateRoomPackage,
  type AssetManifestInput,
} from "@escaperoom/shared/validator";
import type { RoomRouteContext } from "./room-draft";

/** Dependencias inyectables del handler de validación (testeables sin Postgres). */
export type RoomValidateHandlerDeps = {
  drafts: RoomDraftService;
  resolveActor: (request: Request) => Promise<Actor>;
  /**
   * Doc Yjs del draft → `RoomPackage` (serialización de 3.1). `null` mientras
   * no esté disponible: el endpoint responde 501 tras autorizar.
   */
  serialize: RoomPackageSerializer | null;
  /** Manifest del pack de la sala para el check `assets` (opcional). */
  loadAssetManifest?: (pkg: RoomPackage) => Promise<AssetManifestInput | undefined>;
};

const STATUS_BY_CODE: Record<RoomDraftErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_UPDATE: 422,
};

function errorResponse(code: string, message: string, status: number, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

/**
 * `POST /api/rooms/:roomId/validate` (specs/09 §5, specs/22 §2): valida el
 * draft actual con el mismo validador que corre en el editor y en
 * `publish()`. Solo el autor (mismo permiso que el draft). Responde el informe
 * estructurado y su versión en texto.
 */
export function createRoomValidateHandlers(deps: RoomValidateHandlerDeps) {
  return {
    async postValidate(request: Request, ctx: RoomRouteContext): Promise<Response> {
      try {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const draft = await deps.drafts.loadDraft(actor, roomId);
        if (!deps.serialize) {
          return errorResponse(
            "NOT_IMPLEMENTED",
            "La serialización del draft a RoomPackage aún no está disponible",
            501,
          );
        }
        const converted = docToRoomPackage(buildDraftDoc(draft), deps.serialize);
        if (!converted.ok) {
          return errorResponse(
            "INVALID_DRAFT",
            "El draft aún no forma un RoomPackage válido",
            422,
            converted.errors,
          );
        }
        const assetManifest = await deps.loadAssetManifest?.(converted.pkg);
        const report = validateRoomPackage(converted.pkg, assetManifest ? { assetManifest } : {});
        return Response.json(
          { roomId, ok: report.ok, report, text: renderValidationReport(report) },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (err) {
        if (err instanceof RoomDraftError) {
          return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code]);
        }
        throw err;
      }
    },
  };
}
