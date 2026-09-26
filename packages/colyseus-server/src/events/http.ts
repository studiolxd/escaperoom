import express, { type Router } from "express";
import { z } from "zod";
import { matchMaker } from "@colyseus/core";
import {
  allNonEmptyGroupsReady,
  EVENT_PROGRESS_INTERNAL_PATH,
  groupReadinessStatus,
  isEventProgressAuthorized,
  type GroupStartResult,
  type SessionLiveProgress,
} from "@escaperoom/shared/event-progress";
import { readJoinTokenConfig } from "@escaperoom/shared/join-token";
import { EVENT_ROOM_NAME } from "../constants.js";
import type { EventRoom, EventRoomMetadata } from "../rooms/event-room.js";

/** Tope de espera de cada room al pedirle su progreso. */
const ROOM_CALL_TIMEOUT_MS = 2000;

function fail(res: express.Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

/**
 * `GET /internal/events/:eventId/progress` (web → Colyseus, ticket 5.9): el
 * progreso público de cada room `event` viva del evento, para el panel del
 * organizador. Solo la llama el servidor de web **después** de comprobar que
 * el actor es el organizador; se autentica con una credencial derivada de
 * `JOIN_TOKEN_SECRET` (`eventProgressBearer`). Las rooms se localizan por la
 * metadata del listado (`eventId`) y cada una responde con
 * `EventRoom.progressSnapshot` (contadores y tiempos, sin soluciones).
 */
export function createEventProgressRouter(): Router {
  const router = express.Router();
  router.get(`${EVENT_PROGRESS_INTERNAL_PATH}/:eventId/progress`, async (req, res) => {
    const config = readJoinTokenConfig();
    if (!config) {
      fail(res, 503, "EVENTS_DISABLED", "Los eventos no están configurados (JOIN_TOKEN_SECRET).");
      return;
    }
    if (!isEventProgressAuthorized(config.secret, req.header("authorization"))) {
      fail(res, 401, "UNAUTHORIZED", "Ruta interna: falta la credencial compartida.");
      return;
    }
    const { eventId } = req.params;
    const listings = await matchMaker.query({ name: EVENT_ROOM_NAME });
    const rooms = listings.filter(
      (listing) =>
        (listing.metadata as Partial<EventRoomMetadata> | undefined)?.eventId === eventId,
    );
    const settled = await Promise.allSettled(
      rooms.map(
        (listing) =>
          matchMaker.remoteRoomCall<EventRoom>(
            listing.roomId,
            "progressSnapshot",
            [],
            ROOM_CALL_TIMEOUT_MS,
          ) as Promise<SessionLiveProgress>,
      ),
    );
    const sessions = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    res.set("Cache-Control", "no-store").status(200).json({ sessions });
  });

  const StartAllBody = z.object({ force: z.boolean().optional().default(false) });

  /**
   * `POST /internal/events/:eventId/start-all` (web → Colyseus, ticket
   * "inicio conjunto", specs/11 §4.1/§4.5, specs/19 §2): "Comenzar todos" del
   * panel del organizador. Misma autenticación y localización de rooms que la
   * ruta de progreso.
   *
   * Sin `force`: todo o nada — primero se lee el progreso en vivo de cada room
   * (`progressSnapshot`, sin mutar nada) y solo si TODOS los grupos con algún
   * conectado cumplen mínimo y "Listo" se manda `organizerStartGroup` a esos
   * mismos grupos; si alguno falla, no se arranca ninguno y se devuelve el
   * detalle (el panel ofrece Esperar/Refrescar/Comenzar igualmente).
   *
   * Con `force`: se manda `organizerStartGroup({force: true})` a todo grupo
   * con al menos un conectado (los vacíos se saltan, nunca arrancan).
   */
  router.post(`${EVENT_PROGRESS_INTERNAL_PATH}/:eventId/start-all`, express.json(), async (req, res) => {
    const config = readJoinTokenConfig();
    if (!config) {
      fail(res, 503, "EVENTS_DISABLED", "Los eventos no están configurados (JOIN_TOKEN_SECRET).");
      return;
    }
    if (!isEventProgressAuthorized(config.secret, req.header("authorization"))) {
      fail(res, 401, "UNAUTHORIZED", "Ruta interna: falta la credencial compartida.");
      return;
    }
    const body = StartAllBody.safeParse(req.body ?? {});
    if (!body.success) {
      fail(res, 400, "VALIDATION_ERROR", "Cuerpo inválido.");
      return;
    }
    const { eventId } = req.params;
    const { force } = body.data;
    const listings = await matchMaker.query({ name: EVENT_ROOM_NAME });
    const rooms = listings.filter(
      (listing) =>
        (listing.metadata as Partial<EventRoomMetadata> | undefined)?.eventId === eventId,
    );
    const progress = await Promise.allSettled(
      rooms.map(
        (listing) =>
          matchMaker.remoteRoomCall<EventRoom>(
            listing.roomId,
            "progressSnapshot",
            [],
            ROOM_CALL_TIMEOUT_MS,
          ) as Promise<SessionLiveProgress>,
      ),
    );
    const live = progress.flatMap((result, index) =>
      result.status === "fulfilled" ? [{ listing: rooms[index]!, snapshot: result.value }] : [],
    );

    // Sin `force`: si algún grupo no vacío falla, no se toca ninguna room.
    const eligible = force
      ? live.filter(({ snapshot }) => snapshot.phase === "lobby" && snapshot.players > 0)
      : allNonEmptyGroupsReady(live.map(({ snapshot }) => snapshot))
        ? live.filter(({ snapshot }) => snapshot.phase === "lobby" && snapshot.players > 0)
        : [];

    const started = await Promise.allSettled(
      eligible.map(
        ({ listing }) =>
          matchMaker.remoteRoomCall<EventRoom>(
            listing.roomId,
            "organizerStartGroup",
            [{ force }],
            ROOM_CALL_TIMEOUT_MS,
          ) as Promise<GroupStartResult>,
      ),
    );
    const startedBySession = new Map<string, GroupStartResult>(
      started.flatMap((result) =>
        result.status === "fulfilled" ? ([[result.value.sessionId, result.value]] as const) : [],
      ),
    );
    const groups: GroupStartResult[] = live.map(({ snapshot }) => {
      const result = startedBySession.get(snapshot.sessionId);
      if (result) return result;
      return {
        sessionId: snapshot.sessionId,
        status: groupReadinessStatus(snapshot),
        connected: snapshot.players,
        ready: snapshot.readyCount,
        min: snapshot.minPlayers,
      };
    });
    res.set("Cache-Control", "no-store").status(200).json({ groups });
  });

  return router;
}
