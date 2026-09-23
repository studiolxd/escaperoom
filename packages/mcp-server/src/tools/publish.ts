import {
  MAX_VERSION_NOTES_LENGTH,
  PublishConfirmationError,
  RoomPublishError,
} from "@escaperoom/shared/services";
import { z } from "zod";
import { appLink, publishConfirmPath } from "../links";
import { buildPublishChecklist, renderPublishChecklist } from "../publish-checklist";
import { textResult, ToolError, type ToolErrorCode } from "../results";
import { defineTool, RoomIdSchema } from "./define";

/** Código de la tool para cada error de la publicación de 3.9. */
const CODE_BY_PUBLISH_ERROR: Partial<Record<RoomPublishError["code"], ToolErrorCode>> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  INVALID_PACKAGE: "INVALID_DRAFT",
  SERIALIZER_UNAVAILABLE: "NOT_AVAILABLE",
  ROOM_NOT_PUBLISHABLE: "NOT_PUBLISHABLE",
  UNSUPPORTED_PACKAGE_FORMAT: "NOT_PUBLISHABLE",
  ASSETS_NOT_PUBLISHABLE: "NOT_PUBLISHABLE",
};

/** Traduce los errores de la publicación a errores accionables para el agente. */
function publishErrorToToolError(error: RoomPublishError, roomId: string): ToolError {
  if (error.code === "VALIDATION_FAILED" && error.details.report) {
    const report = error.details.report;
    return new ToolError(
      "VALIDATION_FAILED",
      `la sala no pasa el validador: no se puede publicar ni pedir la confirmación.\n${renderPublishChecklist(report, roomId)}`,
      { reason: error.code, ...buildPublishChecklist(report) },
    );
  }
  const code = CODE_BY_PUBLISH_ERROR[error.code] ?? "INTERNAL";
  const problems = error.details.problems?.map((p) => `${p.ref}: ${p.message}`) ?? [];
  const message =
    problems.length > 0 ? `${error.message}:\n  · ${problems.join("\n  · ")}` : error.message;
  return new ToolError(code, message, { reason: error.code, ...error.details });
}

/**
 * Fase D — publicar (specs/10 §2, §5). Publicar es irreversible: el agente
 * **no publica**. La tool exige el validador en verde (y el resto de
 * comprobaciones de 3.9) y crea una **solicitud pendiente**: un enlace a la
 * web que el creador abre con su sesión para confirmar. Solo al confirmar se
 * llama a la publicación de 3.9 y se crea la `roomVersion`; si el draft cambia
 * entretanto, la confirmación se rechaza (ver `publish-confirmation.ts`).
 */
export const publishTool = defineTool({
  name: "publish",
  title: "Publicar",
  description:
    "Pide publicar una versión del draft. Irreversible: exige el validador en verde y NO publica directamente — devuelve un enlace que el creador debe abrir en la web para confirmar. Si el draft cambia antes de confirmar, la confirmación se invalida y hay que volver a pedirla.",
  phase: "verification",
  ticket: "4.5",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    versionNotes: z
      .string()
      .trim()
      .min(1)
      .max(MAX_VERSION_NOTES_LENGTH)
      .describe('Notas de la versión (p. ej. "v1.0 — sala inicial")'),
  }),
  // No escribe nada (solo firma la solicitud), pero abre la puerta a una
  // acción irreversible: los clientes deben tratarla como destructiva.
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async run({ roomId, versionNotes }, { actor, deps }) {
    if (!deps.publishRequests || !deps.appUrl) {
      throw new ToolError(
        "NOT_AVAILABLE",
        "la publicación con confirmación no está configurada en este servidor. El creador puede publicar desde el editor.",
      );
    }
    let request;
    try {
      request = await deps.publishRequests.request(actor, roomId, { versionNotes });
    } catch (error) {
      if (error instanceof RoomPublishError) throw publishErrorToToolError(error, roomId);
      if (error instanceof PublishConfirmationError) {
        throw new ToolError(
          error.code === "VALIDATION_ERROR" ? "INVALID_INPUT" : "INTERNAL",
          error.message,
        );
      }
      throw error;
    }
    const { check, claims } = request;
    const confirmUrl = appLink(
      deps.appUrl,
      check.defaultLanguage,
      publishConfirmPath(request.token),
    );
    const expiresAt = new Date(claims.expiresAt).toISOString();
    const checklist = buildPublishChecklist(check.report);
    const lines = [
      "⏸️ publish — solicitud creada; la sala NO se ha publicado todavía.",
      "Publicar es irreversible y necesita la confirmación explícita del creador: pídele que abra este enlace con su sesión y confirme.",
      confirmUrl,
      `Se publicará como v${check.nextSemver} con las notas «${claims.versionNotes}». El enlace caduca el ${expiresAt} y sirve para una sola publicación.`,
      "Si el draft cambia antes de la confirmación, se rechazará: vuelve a llamar a validate y publish.",
    ];
    if (checklist.warnings.length > 0) {
      lines.push("", "Avisos (no bloquean; coméntalos con el creador):");
      for (const warning of checklist.warnings) lines.push(`  🟡 ${warning.summary}`);
    }
    return textResult(lines.join("\n"), {
      status: "pending_confirmation",
      published: false,
      confirmUrl,
      expiresAt,
      nextSemver: check.nextSemver,
      latestSemver: check.latestSemver,
      packageHash: check.packageHash,
      warnings: checklist.warnings,
    });
  },
});
