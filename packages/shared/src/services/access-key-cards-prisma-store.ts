import { Prisma, type PrismaClient } from "../../generated/client/client";
import { LIVE_ACCESS_KEY_STATUSES, type AccessKeyRow } from "./access-keys";
import type { AccessKeyCardStore, CardRoomMeta } from "./access-key-cards";
import { createPrismaEventStore } from "./events-prisma-store";

/** `package.meta` de la versión: solo lo que la tarjeta imprime. */
function roomMeta(pkg: Prisma.JsonValue): CardRoomMeta | null {
  const meta =
    pkg && typeof pkg === "object" && !Array.isArray(pkg)
      ? (pkg as Record<string, unknown>).meta
      : null;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  const languages = Array.isArray(m.languages)
    ? m.languages.filter((l): l is string => typeof l === "string")
    : [];
  return {
    title: typeof m.title === "string" ? m.title : "",
    languages,
    defaultLanguage:
      typeof m.defaultLanguage === "string" ? m.defaultLanguage : (languages[0] ?? ""),
  };
}

/** Implementación Prisma del puerto de lectura del export de tarjetas (ticket 5.7). */
export function createPrismaAccessKeyCardStore(prisma: PrismaClient): AccessKeyCardStore {
  const events = createPrismaEventStore(prisma);
  return {
    findEvent: (id) => events.findEvent(id),

    async findRoomMeta(roomVersionId) {
      const row = await prisma.roomVersion.findUnique({
        where: { id: roomVersionId },
        select: { package: true, room_roomVersion_roomIdToroom: { select: { title: true } } },
      });
      if (!row) return null;
      const meta = roomMeta(row.package);
      const title = meta?.title || row.room_roomVersion_roomIdToroom.title;
      return {
        title,
        languages: meta?.languages ?? [],
        defaultLanguage: meta?.defaultLanguage ?? "",
      };
    },

    async listEventKeys(eventId, { codes, liveOnly, limit }) {
      const rows = await prisma.accessKey.findMany({
        where: {
          eventId,
          ...(codes ? { code: { in: codes } } : {}),
          ...(liveOnly ? { status: { in: [...LIVE_ACCESS_KEY_STATUSES] } } : {}),
        },
        orderBy: [{ createdAt: "asc" }, { code: "asc" }],
        take: limit,
      });
      return rows.map((row): AccessKeyRow => ({
        code: row.code,
        eventId: row.eventId,
        sessionId: row.sessionId,
        groupId: row.groupId,
        email: row.email,
        keyType: row.keyType,
        status: row.status,
        singleUse: row.singleUse,
        requireConfirmation: row.requireConfirmation,
        regeneratedFrom: row.regeneratedFrom,
        seats: row.seats,
        redeemedCount: row.redeemedCount,
        sentAt: row.sentAt,
        confirmedAt: row.confirmedAt,
        activatedAt: row.activatedAt,
        usedAt: row.usedAt,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      }));
    },
  };
}
