"use server";

import { headers } from "next/headers";
import { RoomDraftError } from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { getDraftSerializer, getRoomDraftService } from "@/server/services";
import { getPlaytestLauncher } from "@/server/playtest-launcher";
import {
  PlaytestCreationError,
  runPlaytestCreation,
  type RoomPlaytestResponse,
} from "@/server/rest/room-playtest";
import { actionError, actionOk, type ActionResult } from "@/server/actions/action-result";

/**
 * Server action de `PlaytestButton` ("Jugar" desde el editor): misma
 * `runPlaytestCreation` (`server/rest/room-playtest.ts`, compartida con
 * `POST /api/rooms/:roomId/playtest`, que sigue existiendo) sobre
 * `RoomDraftService`, la serialización del editor y el `PlaytestLauncher`.
 * Sin cuota propia, igual que la ruta REST.
 */
export async function createPlaytest(roomId: string): Promise<ActionResult<RoomPlaytestResponse>> {
  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);

  try {
    const result = await runPlaytestCreation(
      { drafts: getRoomDraftService(), serialize: getDraftSerializer(), launcher: getPlaytestLauncher() },
      actor,
      roomId,
    );
    return actionOk(result);
  } catch (err) {
    if (err instanceof RoomDraftError) return actionError(err.code, err.message);
    if (err instanceof PlaytestCreationError) return actionError(err.code, err.message);
    throw err;
  }
}
