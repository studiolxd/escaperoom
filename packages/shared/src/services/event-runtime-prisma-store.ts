import type { PrismaClient } from "../../generated/client";
import { parseRoomPackage } from "../schemas";
import { LIVE_ACCESS_KEY_STATUSES } from "./access-keys";
import type { LiveResult, SessionStoredProgress, StoredProgressSource } from "./event-progress";
import {
  completesGroup,
  storedProgressForSessions,
  type EventPackage,
  type EventRuntimeStore,
  type ProgressMilestone,
  type StoredProgressRow,
} from "./event-runtime";

/**
 * Runtime de eventos sobre Postgres (ticket 5.12): lo usa Colyseus (paquete del
 * evento y escritura de hitos) y web (progreso persistido del panel).
 *
 * - El paquete se lee de `roomVersion.package` (inmutable desde 3.9) a través
 *   de `event.roomVersionId`, y se vuelve a validar con el esquema del
 *   `RoomPackage` antes de jugarlo.
 * - `game_started` pasa la sesión a `in_progress` (con `startedAt` y
 *   `colyseusRoomId`); `game_ended` la cierra (`ended`/`aborted` + `endedAt`)
 *   y, si el desenlace completa el grupo, escribe `group.completedAt` y caduca
 *   las claves vivas de esos grupos cuando el evento tiene `on_group_complete`.
 *   Todo en una transacción.
 * - `createdAt` es el instante del hito en el servidor de partida (la escritura
 *   es asíncrona y puede llegar algo después).
 */
export function createPrismaEventRuntimeStore(
  prisma: PrismaClient,
): EventRuntimeStore & StoredProgressSource {
  return {
    async loadEventPackage(eventId): Promise<EventPackage | null> {
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: {
          status: true,
          roomVersionId: true,
          config: true,
          roomVersion: { select: { package: true } },
        },
      });
      if (!event || event.status !== "active") return null;
      return {
        eventId,
        roomVersionId: event.roomVersionId,
        roomPackage: parseRoomPackage(event.roomVersion.package),
        allowVideo: (event.config as unknown as { allowVideo?: boolean }).allowVideo === true,
      };
    },

    async recordMilestone(sessionId, milestone: ProgressMilestone) {
      const createdAt = new Date(milestone.at);
      switch (milestone.kind) {
        case "game_started":
          await prisma.$transaction([
            prisma.progressEvent.create({
              data: { sessionId, eventKind: "game_started", durationMs: 0, createdAt },
            }),
            prisma.$executeRaw`
              UPDATE "gameSession"
                 SET status = 'in_progress',
                     "startedAt" = COALESCE("startedAt", ${createdAt}),
                     "colyseusRoomId" = ${milestone.roomId}
               WHERE id = ${sessionId}::uuid AND status IN ('pending', 'in_progress')`,
          ]);
          return;
        case "solved":
        case "hint_used":
        case "door_opened":
          await prisma.progressEvent.create({
            data: {
              sessionId,
              groupId: milestone.groupId,
              playerId: milestone.userId,
              eventKind: milestone.kind,
              puzzleId: milestone.kind === "door_opened" ? null : milestone.puzzleId,
              objectId: milestone.kind === "door_opened" ? milestone.objectId : null,
              durationMs: Math.round(milestone.elapsedMs),
              hintsUsed: milestone.hintsUsed,
              createdAt,
            },
          });
          return;
        case "game_ended": {
          const status = milestone.result === "aborted" ? "aborted" : "ended";
          const groupIds = completesGroup(milestone.result) ? milestone.groupIds : [];
          await prisma.$transaction([
            prisma.progressEvent.create({
              data: {
                sessionId,
                eventKind: "game_ended",
                durationMs: Math.round(milestone.elapsedMs),
                hintsUsed: milestone.hintsUsed,
                result: milestone.result,
                createdAt,
              },
            }),
            prisma.$executeRaw`
              UPDATE "gameSession"
                 SET status = ${status}::"sessionStatus", "endedAt" = ${createdAt}
               WHERE id = ${sessionId}::uuid`,
            prisma.$executeRaw`
              UPDATE "group" SET "completedAt" = ${createdAt}
               WHERE "sessionId" = ${sessionId}::uuid
                 AND id = ANY(${groupIds}::uuid[])
                 AND "completedAt" IS NULL`,
            // La misma regla que `expireByGroupComplete` (5.5), acotada a estos grupos.
            prisma.$executeRaw`
              UPDATE "accessKey" k SET status = 'expired'
                FROM "event" e
               WHERE k."groupId" = ANY(${groupIds}::uuid[])
                 AND e.id = k."eventId"
                 AND e."expiryRules" @> '[{"type":"on_group_complete"}]'::jsonb
                 AND k.status::text = ANY(${[...LIVE_ACCESS_KEY_STATUSES]})`,
          ]);
          return;
        }
      }
    },

    async forEvent(eventId): Promise<SessionStoredProgress[]> {
      const [sessions, rows, totals] = await Promise.all([
        prisma.gameSession.findMany({
          where: { eventId },
          orderBy: [{ createdAt: "asc" }, { name: "asc" }],
          select: { id: true },
        }),
        prisma.progressEvent.findMany({
          where: { gameSession: { eventId } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            sessionId: true,
            eventKind: true,
            puzzleId: true,
            durationMs: true,
            hintsUsed: true,
            result: true,
            createdAt: true,
          },
        }),
        prisma.$queryRaw<Array<{ total: number | null }>>`
          SELECT jsonb_array_length(rv.package->'puzzles')::int AS total
            FROM "event" e JOIN "roomVersion" rv ON rv.id = e."roomVersionId"
           WHERE e.id = ${eventId}::uuid`,
      ]);
      const stored: StoredProgressRow[] = rows.map((row) => ({
        sessionId: row.sessionId,
        kind: row.eventKind,
        puzzleId: row.puzzleId,
        durationMs: row.durationMs,
        hintsUsed: row.hintsUsed,
        result: row.result as LiveResult | null,
        createdAt: row.createdAt,
      }));
      return storedProgressForSessions(
        eventId,
        sessions.map((session) => session.id),
        stored,
        totals[0]?.total ?? 0,
      );
    },
  };
}
