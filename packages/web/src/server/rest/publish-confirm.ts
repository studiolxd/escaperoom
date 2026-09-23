import {
  PublishConfirmationError,
  RoomPublishError,
  type Actor,
  type PublishConfirmationErrorCode,
  type PublishConfirmationService,
} from "@escaperoom/shared/services";
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
  VALIDATION_ERROR: 400,
};

function errorResponse(code: string, message: string, status: number, extra: object = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

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
      const site = request.headers.get("sec-fetch-site");
      if (site && site !== "same-origin") {
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
      const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
      if (typeof body?.token !== "string" || !body.token) {
        return errorResponse("VALIDATION_ERROR", "Falta el token de confirmación", 400);
      }
      try {
        const actor = await deps.resolveActor(request);
        const result = await deps.confirmations.confirm(actor, body.token);
        return Response.json(
          {
            version: versionJson(result.version),
            warnings: result.report.checks
              .filter((c) => c.status === "warning")
              .map((c) => ({ id: c.id, summary: c.summary })),
          },
          { status: 201, headers: { "Cache-Control": "no-store" } },
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
