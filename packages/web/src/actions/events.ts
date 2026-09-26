"use server";

import { headers } from "next/headers";
import {
  AccessKeyError,
  EventError,
  EventPanelError,
  type EnqueueResult,
  type GroupStartResult,
} from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { getEventPanelService, getEventService, getInvitationService } from "@/server/services";
import {
  actionError,
  actionOk,
  consumeActionRateLimit,
  rateLimitedActionError,
  type ActionResult,
} from "@/server/actions/action-result";

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

/**
 * Server action del botón "reenviar pendientes" de `EventDashboardView`
 * (ticket 5.9): mismo `InvitationService.resendPending` que `POST
 * /api/events/:id/invitations/resend` (`server/rest/access-keys.ts`, que
 * sigue existiendo). Cuota `invitation-resend-pending`, igual que la ruta REST.
 */
export async function resendPendingInvitations(eventId: string): Promise<ActionResult<EnqueueResult>> {
  const rateLimit = await consumeActionRateLimit("invitation-resend-pending");
  if (!rateLimit.ok) return rateLimitedActionError();

  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);

  try {
    const result = await getInvitationService().resendPending(actor, eventId);
    return actionOk(result);
  } catch (err) {
    if (err instanceof AccessKeyError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}

/**
 * Ticket duración-salas (specs/02 §7): el organizador fija SU duración para
 * el evento, por encima de la de la sala — más corta, más larga o sin
 * límite (`null`). Mismo `EventService.updateEvent` que `PATCH
 * /api/events/:id`; solo funciona mientras el evento está en `draft`
 * (`EVENT_NOT_EDITABLE` si no). `timeLimitBelowEstimate` en la respuesta es
 * el aviso si el override queda por debajo del `estimatedMinutes` de la
 * sala — el panel lo muestra, no bloquea el guardado.
 */
export async function updateEventTimeLimit(
  eventId: string,
  timeLimitMinutes: number | null,
): Promise<ActionResult<{ timeLimitMinutes?: number | null; timeLimitBelowEstimate: boolean }>> {
  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);

  try {
    const event = await getEventService().updateEvent(actor, eventId, { timeLimitMinutes });
    return actionOk({
      timeLimitMinutes: event.config.timeLimitMinutes,
      timeLimitBelowEstimate: event.timeLimitBelowEstimate,
    });
  } catch (err) {
    if (err instanceof EventError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}

/**
 * Ticket "inicio conjunto": el organizador activa/desactiva "Todos los
 * grupos comienzan juntos" desde su panel. Mismo `EventService.setAllGroupsStartTogether`
 * que un futuro `PATCH` dedicado; a diferencia de `updateEventTimeLimit`,
 * funciona en `draft` Y en `active` — solo se bloquea (`EVENT_NOT_EDITABLE`)
 * en cuanto algún grupo del evento ha empezado a jugar.
 */
export async function setAllGroupsStartTogether(
  eventId: string,
  enabled: boolean,
): Promise<ActionResult<{ allGroupsStartTogether: boolean }>> {
  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);

  try {
    const event = await getEventService().setAllGroupsStartTogether(actor, eventId, enabled);
    return actionOk({ allGroupsStartTogether: event.config.allGroupsStartTogether === true });
  } catch (err) {
    if (err instanceof EventError) return actionError(err.code, err.message, err.issues);
    throw err;
  }
}

/**
 * "Comenzar todos"/"Comenzar igualmente" (ticket "inicio conjunto", specs/11
 * §4.1/§4.5, specs/19 §2): mismo `EventPanelService.startAllGroups` que
 * `POST /api/events/:id/start-all` (que sigue existiendo). Cuota
 * `event-start-all`, igual que la ruta REST.
 */
export async function startAllGroups(
  eventId: string,
  force: boolean,
): Promise<ActionResult<GroupStartResult[]>> {
  const rateLimit = await consumeActionRateLimit("event-start-all");
  if (!rateLimit.ok) return rateLimitedActionError();

  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);

  try {
    const groups = await getEventPanelService().startAllGroups(actor, eventId, { force });
    return actionOk(groups);
  } catch (err) {
    if (err instanceof EventPanelError) return actionError(err.code, err.message);
    throw err;
  }
}
