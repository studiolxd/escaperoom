"use server";

import { headers } from "next/headers";
import {
  PUBLISH_CONFIRM_DISABLED_ERROR,
  PublishConfirmationError,
  RoomPublishError,
} from "@escaperoom/shared/services";
import { resolveBrowserActorFromHeaders } from "@/server/context";
import { getPublishConfirmationService } from "@/server/services";
import { versionJson } from "@/server/rest/room-publish";
import { actionError, actionOk, type ActionResult } from "@/server/actions/action-result";

export type ConfirmPublishInput = { token: string };
export type ConfirmPublishData = {
  version: ReturnType<typeof versionJson>;
  warnings: { id: string; summary: string }[];
};

/**
 * Server action de `ConfirmPublish`: mismo `PublishConfirmationService.confirm`
 * que `POST /api/publish-confirm` (`server/rest/publish-confirm.ts`, que
 * sigue existiendo — el enlace de confirmación puede abrirse en cualquier
 * navegador). Repite AQUÍ los dos guardas de seguridad de esa ruta (4.5/4.7):
 * ninguna cabecera `Authorization` (el token OAuth del MCP no puede
 * confirmar por el creador) y `Sec-Fetch-Site: same-origin` (B-25) — Next
 * exige `Origin === Host` en toda Server Action, pero eso no basta para
 * distinguir "sin sesión de navegador" de "con un Bearer del MCP".
 */
export async function confirmPublish(
  input: ConfirmPublishInput,
): Promise<ActionResult<ConfirmPublishData>> {
  const hdrs = await headers();
  if (hdrs.has("authorization")) {
    return actionError(
      "BEARER_NOT_ALLOWED",
      "La confirmación de publicación exige la sesión del navegador del creador; los tokens del MCP no pueden confirmar",
    );
  }
  if (hdrs.get("sec-fetch-site") !== "same-origin") {
    return actionError("CROSS_SITE", "La confirmación solo se acepta desde la propia web");
  }

  const confirmations = getPublishConfirmationService();
  if (!confirmations) {
    return actionError(
      PUBLISH_CONFIRM_DISABLED_ERROR,
      "La confirmación de publicaciones no está configurada en este entorno",
    );
  }
  if (!input.token) {
    return actionError("VALIDATION_ERROR", "Falta el token de confirmación");
  }

  try {
    const actor = await resolveBrowserActorFromHeaders(hdrs);
    const result = await confirmations.confirm(actor, input.token);
    return actionOk({
      version: versionJson(result.version),
      warnings: result.report.checks
        .filter((c) => c.status === "warning")
        .map((c) => ({ id: c.id, summary: c.summary })),
    });
  } catch (err) {
    if (err instanceof PublishConfirmationError) return actionError(err.code, err.message);
    if (err instanceof RoomPublishError) return actionError(err.code, err.message);
    throw err;
  }
}
