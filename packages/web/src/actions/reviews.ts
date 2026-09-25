"use server";

import { headers } from "next/headers";
import { ReviewError, type ReviewInput } from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { getReviewService } from "@/server/services";
import {
  actionError,
  actionOk,
  consumeActionRateLimit,
  rateLimitedActionError,
  type ActionResult,
} from "@/server/actions/action-result";

export type UpsertReviewActionData = {
  created: boolean;
  ratingAvg: number | null;
  ratingCount: number;
};

/**
 * Server action de `ReviewForm`: mismo `ReviewService.upsertReview` que
 * `POST /api/rooms/:roomId/reviews` (`server/rest/room-reviews.ts`, que sigue
 * existiendo — lo migra otra tarea en paralelo al contrato A-22, no se toca
 * aquí). Cuota `review-write`, la misma que la ruta REST.
 */
export async function upsertRoomReview(
  roomId: string,
  input: ReviewInput,
): Promise<ActionResult<UpsertReviewActionData>> {
  const rateLimit = await consumeActionRateLimit("review-write");
  if (!rateLimit.ok) return rateLimitedActionError();

  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);

  try {
    const { created, ratingAvg, ratingCount } = await getReviewService().upsertReview(
      actor,
      roomId,
      input,
    );
    return actionOk({ created, ratingAvg, ratingCount });
  } catch (err) {
    if (err instanceof ReviewError) return actionError(err.code, err.message);
    throw err;
  }
}
