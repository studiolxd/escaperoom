"use server";

import { headers } from "next/headers";
import { EventError } from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { getEventService } from "@/server/services";
import { actionError, actionOk, type ActionResult } from "@/server/actions/action-result";

export type CreateMinimalEventInput = { roomVersionId: string; title: string; playersPlanned: number };

/**
 * Server action del flujo mínimo "Organizar un evento" (`NewEventForm`, PR
 * #157): mismo `EventService.createEvent` que `POST /api/events`
 * (`server/rest/events.ts`, que sigue existiendo). El resto de la
 * configuración (sesiones simultáneas, agrupación…) queda con los mismos
 * valores por defecto que ya usaba el `fetch` original; sin cuota específica
 * en `RATE_LIMIT_POLICIES` — igual que la ruta REST, que tampoco la tenía.
 */
export async function createMinimalEvent(
  input: CreateMinimalEventInput,
): Promise<ActionResult<{ id: string }>> {
  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);

  try {
    const event = await getEventService().createEvent(actor, {
      roomVersionId: input.roomVersionId,
      title: input.title,
      playersPlanned: input.playersPlanned,
      maxSimultaneousSessions: 1,
      groupingMode: "free",
      requireConfirmation: false,
      expiryRules: [],
      audience: "general",
    });
    return actionOk({ id: event.id });
  } catch (err) {
    if (err instanceof EventError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}
