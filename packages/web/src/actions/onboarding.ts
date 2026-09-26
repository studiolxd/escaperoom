"use server";

import { headers } from "next/headers";
import { isAnonymous, RoomDraftError } from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";
import { getRoomDraftService } from "@/server/services";
import {
  createOnboardingRoom,
  CreateRoomBodySchema,
  type CreateOnboardingRoomResult,
} from "@/server/rest/onboarding";
import {
  actionError,
  actionOk,
  consumeActionRateLimit,
  rateLimitedActionError,
  type ActionResult,
} from "@/server/actions/action-result";

export type CreateOnboardingRoomInput = { template: "rey-aldric" | "blank"; title?: string };

/**
 * Server action de `OnboardingWizard` (paso 2, "Pinta tu primera sala"):
 * misma `createOnboardingRoom` (`server/rest/onboarding.ts`, compartida con
 * `POST /api/onboarding/rooms`, que sigue existiendo) sobre `RoomDraftService`.
 * Cuota `onboarding-room-create` (A-9), igual que la ruta REST.
 */
export async function createOnboardingRoomAction(
  input: CreateOnboardingRoomInput,
): Promise<ActionResult<CreateOnboardingRoomResult>> {
  const rateLimit = await consumeActionRateLimit("onboarding-room-create");
  if (!rateLimit.ok) return rateLimitedActionError();

  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);
  if (isAnonymous(actor)) {
    return actionError("UNAUTHORIZED", "Inicia sesión para crear tu primera sala");
  }

  const parsed = CreateRoomBodySchema.safeParse(input);
  if (!parsed.success) {
    return actionError(
      "VALIDATION_ERROR",
      '"template" debe ser "rey-aldric" o "blank"; "title" (opcional) una cadena no vacía',
    );
  }

  try {
    const result = await createOnboardingRoom(
      { drafts: getRoomDraftService(), readReyAldricRoomPackageJson },
      actor,
      parsed.data,
    );
    return actionOk(result);
  } catch (err) {
    if (err instanceof RoomDraftError) return actionError(err.code, err.message);
    throw err;
  }
}
