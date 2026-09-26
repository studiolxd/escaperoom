"use server";

import { headers } from "next/headers";
import {
  AccessKeyError,
  REDEEM_UNAVAILABLE_ERROR,
  type RedeemResult,
} from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { getRedeemService } from "@/server/services";
import {
  actionError,
  actionOk,
  consumeActionRateLimit,
  rateLimitedActionError,
  type ActionResult,
} from "@/server/actions/action-result";

export type RedeemActionInput = {
  code: string;
  displayName?: string;
  sessionId?: string;
  groupId?: string;
};

export type RedeemActionData = Pick<RedeemResult, "sessionId" | "joinToken">;

/**
 * Server action de `RedeemForm`: mismo `RedeemService.redeem` que
 * `POST /api/access-keys/redeem` (`server/rest/access-keys.ts`, que sigue
 * existiendo). Cuota `redeem`, igual que la ruta REST.
 */
export async function redeemAccessKey(
  input: RedeemActionInput,
): Promise<ActionResult<RedeemActionData>> {
  const rateLimit = await consumeActionRateLimit("redeem");
  if (!rateLimit.ok) return rateLimitedActionError();

  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);
  const redeem = getRedeemService();
  if (!redeem) {
    return actionError(REDEEM_UNAVAILABLE_ERROR, "El canje de claves no está disponible");
  }

  try {
    const result = await redeem.redeem(actor, input);
    return actionOk({ sessionId: result.sessionId, joinToken: result.joinToken });
  } catch (err) {
    if (err instanceof AccessKeyError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}
