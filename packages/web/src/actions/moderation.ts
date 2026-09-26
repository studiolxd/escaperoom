"use server";

import { headers } from "next/headers";
import { AudioError, ModerationError, type ResolveAppealResult, type ResolveReportResult, type AudioAssetRow } from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { getAudioAssetService, getModerationService } from "@/server/services";
import { actionError, actionOk, type ActionResult } from "@/server/actions/action-result";

/**
 * Server actions de `ModerationQueueView`: mismos servicios que
 * `PATCH /api/admin/reports/:id`, `PATCH /api/admin/appeals/:id` y
 * `PATCH /api/admin/audio/:id` (`server/rest/moderation.ts`,
 * `server/rest/audio.ts`, que siguen existiendo). `ModerationService` y
 * `AudioAssetService` ya exigen `isModerator | isAdmin` en el propio
 * servicio (`requireModerator`); sin cuota, igual que las rutas REST.
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

export type ReviewAudioInput =
  | { id: string; decision: "approved" }
  | { id: string; decision: "rejected"; reason: string };

export async function reviewModerationAudio(
  input: ReviewAudioInput,
): Promise<ActionResult<AudioAssetRow>> {
  const actor = await resolveActorFromHeaders(await headers());
  const audio = getAudioAssetService();
  try {
    await audio.authorizeModeration(actor);
    const { id, ...body } = input;
    const asset = await audio.reviewUpload(actor, id, body);
    return actionOk(asset);
  } catch (err) {
    if (err instanceof AudioError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}
