import express, { type Router } from "express";
import { matchMaker } from "@colyseus/core";
import {
  EVENT_PROGRESS_INTERNAL_PATH,
  isEventProgressAuthorized,
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
  return router;
}
