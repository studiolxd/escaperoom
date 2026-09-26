"use server";

import { headers } from "next/headers";
import { ModerationError, type ResolveAppealResult, type ResolveReportResult } from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { getModerationService } from "@/server/services";
import { actionError, actionOk, type ActionResult } from "@/server/actions/action-result";

/**
 * Server actions de `ModerationQueueView`: mismos servicios que
 * `PATCH /api/admin/reports/:id` y `PATCH /api/admin/appeals/:id`
 * (`server/rest/moderation.ts`, que sigue existiendo). `ModerationService`
 * ya exige `isModerator | isAdmin` en el propio servicio
 * (`requireModerator`); sin cuota, igual que las rutas REST.
 *
 * La pestaña de audio (`PATCH /api/admin/audio/:id`) NO se migra aquí: otro
 * agente va a retirar la moderación previa de audio (la pestaña y las rutas
 * `/api/admin/audio*`), así que invertir en esa acción sería trabajo tirado.
 */

export type ResolveReportInput = {
  id: string;
  status: "actioned" | "dismissed";
  action?: string;
  resolutionNote?: string;
};

export async function resolveModerationReport(
  input: ResolveReportInput,
): Promise<ActionResult<ResolveReportResult>> {
  const actor = await resolveActorFromHeaders(await headers());
  try {
    const { id, ...body } = input;
    const result = await getModerationService().resolveReport(actor, id, body);
    return actionOk(result);
  } catch (err) {
    if (err instanceof ModerationError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}

export type ResolveAppealInput = {
  id: string;
  decision: "upheld" | "overturned";
  resolutionNote?: string;
};

export async function resolveModerationAppeal(
  input: ResolveAppealInput,
): Promise<ActionResult<ResolveAppealResult>> {
  const actor = await resolveActorFromHeaders(await headers());
  try {
    const { id, ...body } = input;
    const result = await getModerationService().resolveAppeal(actor, id, body);
    return actionOk(result);
  } catch (err) {
    if (err instanceof ModerationError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}
