import {
  PublishConfirmationError,
  RoomPublishError,
  type Actor,
  type PublishConfirmationErrorCode,
  type PublishConfirmationService,
} from "@escaperoom/shared/services";
import { BadJsonError, errorResponse, NO_STORE, readJson } from "./_http";
import { PUBLISH_STATUS_BY_CODE, versionJson } from "./room-publish";

/** Dependencias inyectables del handler de confirmación (testeable sin Postgres ni R2). */
export type PublishConfirmHandlerDeps = {
  /** `null` si la confirmación no está configurada (producción sin `PUBLISH_CONFIRM_SECRET`). */
  confirmations: PublishConfirmationService | null;
  resolveActor: (request: Request) => Promise<Actor>;
};

const STATUS_BY_CONFIRMATION_CODE: Record<PublishConfirmationErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_TOKEN: 400,
  EXPIRED: 410,
  // A-22: fijado en specs/13 §1 — VALIDATION_ERROR es 422 en todas las rutas.
  VALIDATION_ERROR: 422,
};

/**
 * `POST /api/publish-confirm` — `{ token }` (ticket 4.5). El creador confirma
 * en la web, con SU sesión, la publicación que pidió el agente por MCP: solo
 * aquí se llama a la publicación de 3.9 y se crea la `roomVersion`.
 *
 * Solo acepta peticiones del propio sitio (`Sec-Fetch-Site`), además de la
 * cookie de sesión `SameSite=Lax`: otra web no puede confirmar por el creador.
 * Y solo con la sesión del NAVEGADOR (4.7): cualquier `Authorization` (el
 * token OAuth del MCP) se rechaza con 403 antes de resolver el actor, para
 * que el agente no pueda confirmar su propia publicación.
 */
export function createPublishConfirmHandlers(deps: PublishConfirmHandlerDeps) {
  return {
    async postConfirm(request: Request): Promise<Response> {
      if (request.headers.has("authorization")) {
        return errorResponse(
          "BEARER_NOT_ALLOWED",
          "La confirmación de publicación exige la sesión del navegador del creador; los tokens del MCP no pueden confirmar",
          403,
        );
      }
      // B-25: se exige que la cabecera esté PRESENTE y valga "same-origin",
      // no solo que no traiga un valor distinto — sin `Sec-Fetch-Site`
      // (navegadores viejos, o quien simplemente no la manda) la petición
      // pasaba igual.
      const site = request.headers.get("sec-fetch-site");
      if (site !== "same-origin") {
        return errorResponse(
          "CROSS_SITE",
          "La confirmación solo se acepta desde la propia web",
          403,
        );
      }
      if (!deps.confirmations) {
        return errorResponse(
          "PUBLISH_CONFIRM_DISABLED",
          "La confirmación de publicaciones no está configurada en este entorno",
          503,
        );
      }
      let body: unknown;
      try {
        body = await readJson(request);
      } catch (err) {
        if (err instanceof BadJsonError) return errorResponse("INVALID_JSON", err.message, 400);
        throw err;
      }
      const token = (body as { token?: unknown } | null)?.token;
      if (typeof token !== "string" || !token) {
        return errorResponse("VALIDATION_ERROR", "Falta el token de confirmación", 422);
      }
      try {
        const actor = await deps.resolveActor(request);
        const result = await deps.confirmations.confirm(actor, token);
        return Response.json(
          {
            version: versionJson(result.version),
            warnings: result.report.checks
              .filter((c) => c.status === "warning")
              .map((c) => ({ id: c.id, summary: c.summary })),
          },
          { status: 201, headers: NO_STORE },
        );
      } catch (err) {
        if (err instanceof PublishConfirmationError) {
          return errorResponse(err.code, err.message, STATUS_BY_CONFIRMATION_CODE[err.code]);
        }
        if (err instanceof RoomPublishError) {
          return errorResponse(
            err.code,
            err.message,
            PUBLISH_STATUS_BY_CODE[err.code],
            err.details,
          );
        }
        throw err;
      }
    },
  };
}
