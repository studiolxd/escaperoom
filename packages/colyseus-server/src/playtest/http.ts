import express, { type Router } from "express";
import { matchMaker } from "@colyseus/core";
import { safeParseRoomPackage } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { PLAYTEST_INTERNAL_PATH, PLAYTEST_ROOM_NAME } from "../constants.js";
import { readPlaytestConfig } from "./config.js";
import { playtestRegistry } from "./registry.js";
import { isInternalSecret, signPlaytestToken } from "./token.js";

/** Tope del cuerpo: un RoomPackage grande cabe de sobra (el fixture ronda 40 KB). */
const MAX_BODY = "2mb";

const registerBody = z.object({
  roomPackage: z.unknown(),
  authorId: z.string().min(1).max(128),
  draftRoomId: z.string().min(1).max(128),
});

/** Respuesta de la ruta interna: lo que web necesita para el link de prueba. */
export interface PlaytestCreatedResponse {
  playtestId: string;
  token: string;
  /** Epoch ms. */
  expiresAt: number;
  /** Id de la room de Colyseus creada para el playtest. */
  roomId: string;
}

function fail(
  res: express.Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

/**
 * `POST /internal/playtests` (web → Colyseus, ticket 3.8). Solo la llama el
 * servidor de web, autenticado con `Authorization: Bearer <PLAYTEST_SECRET>`,
 * **después** de comprobar que el actor es el autor del borrador y de
 * serializar el doc Yjs. Aquí se valida el paquete contra el schema, se
 * congela en el registro, se levanta la room y se firma el link de prueba.
 */
export function createPlaytestRouter(): Router {
  const router = express.Router();
  router.post(PLAYTEST_INTERNAL_PATH, express.json({ limit: MAX_BODY }), async (req, res) => {
    const config = readPlaytestConfig();
    if (!config) {
      fail(res, 503, "PLAYTEST_DISABLED", "El playtest no está configurado (PLAYTEST_SECRET).");
      return;
    }
    if (!isInternalSecret(config.secret, req.header("authorization"))) {
      fail(res, 401, "UNAUTHORIZED", "Ruta interna: falta el secreto compartido.");
      return;
    }
    const body = registerBody.safeParse(req.body);
    if (!body.success) {
      fail(res, 400, "INVALID_BODY", "Cuerpo inválido.");
      return;
    }
    const parsed = safeParseRoomPackage(body.data.roomPackage);
    if (!parsed.success) {
      fail(res, 422, "INVALID_PACKAGE", "El paquete no cumple el schema del RoomPackage.");
      return;
    }

    const entry = playtestRegistry.register({
      roomPackage: parsed.data,
      authorId: body.data.authorId,
      draftRoomId: body.data.draftRoomId,
      ttlSeconds: config.ttlSeconds,
    });
    const token = signPlaytestToken(config.secret, entry);
    try {
      const room = await matchMaker.createRoom(PLAYTEST_ROOM_NAME, {
        playtestId: entry.playtestId,
        token,
      });
      const response: PlaytestCreatedResponse = {
        playtestId: entry.playtestId,
        token,
        expiresAt: entry.expiresAt,
        roomId: room.roomId,
      };
      res.status(201).json(response);
    } catch (err) {
      playtestRegistry.delete(entry.playtestId);
      // p. ej. el motor no puede montar la sesión con este borrador.
      fail(
        res,
        422,
        "PLAYTEST_UNPLAYABLE",
        "No se pudo levantar la partida con este borrador.",
        err instanceof Error ? err.message : undefined,
      );
    }
  });
  return router;
}
