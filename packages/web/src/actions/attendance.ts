"use server";

import { AccessKeyError, type ConfirmResult } from "@escaperoom/shared/services";
import { getInvitationService } from "@/server/services";
import {
  actionError,
  actionOk,
  consumeActionRateLimit,
  rateLimitedActionError,
  type ActionResult,
} from "@/server/actions/action-result";

export type ConfirmAttendanceInput = { code: string; token: string };

/**
 * Server action de `ConfirmAttendance`: mismo `InvitationService.confirm` que
 * `POST /api/access-keys/:code/confirm` (`server/rest/access-keys.ts`, que
 * sigue existiendo — el enlace del email también puede confirmar por REST
 * desde clientes que no sean esta página). Cuota `invitation-confirm`, igual
 * que la ruta REST.
 */
export async function confirmAttendance(
  input: ConfirmAttendanceInput,
): Promise<ActionResult<ConfirmResult>> {
  const rateLimit = await consumeActionRateLimit("invitation-confirm");
  if (!rateLimit.ok) return rateLimitedActionError();

  try {
    const result = await getInvitationService().confirm(input.code, { token: input.token });
    return actionOk(result);
  } catch (err) {
    if (err instanceof AccessKeyError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}
