import { Prisma, type PrismaClient } from "../../generated/client/client";
import { createPrismaAccessKeyStore } from "./access-keys-prisma-store";
import type { InvitationStore } from "./invitations";

/**
 * Implementación Prisma del puerto de invitaciones (ticket 5.6) sobre `accessKey`
 * (`0013_access_key_sent_at`), `event`, `roomVersion`/`room` y `user`. Las
 * escrituras de estado reutilizan el store de claves de 5.5 (escritura
 * condicional por `status` + `redeemedCount`).
 *
 * Una clave rotada (`expired` con una sucesora que la cita en `regeneratedFrom`)
 * no cuenta como invitación aparte: la sucesora hereda su email.
 */
export function createPrismaInvitationStore(prisma: PrismaClient): InvitationStore {
  const keys = createPrismaAccessKeyStore(prisma);

  return {
    findEvent: (id) => keys.findEvent(id),
    findKey: (code) => keys.findKey(code),
    updateKey: (code, expected, patch) => keys.updateKey(code, expected, patch),

    async describeEvent(eventId) {
      const row = await prisma.event.findUnique({
        where: { id: eventId },
        select: {
          title: true,
          user: { select: { locale: true } },
          roomVersion: { select: { room_roomVersion_roomIdToroom: { select: { title: true } } } },
        },
      });
      if (!row) return null;
      return {
        roomTitle: row.roomVersion.room_roomVersion_roomIdToroom.title || row.title,
        organizerLocale: row.user.locale,
      };
    },

    async invitationStats(eventId) {
      const [row] = await prisma.$queryRaw<
        Array<{
          invited: number;
          sent: number;
          confirmed: number;
          pending: number;
          expired: number;
        }>
      >(Prisma.sql`
        SELECT count(*)::int                                                          AS invited,
               count(*) FILTER (WHERE k."sentAt" IS NOT NULL)::int                    AS sent,
               count(*) FILTER (WHERE k."confirmedAt" IS NOT NULL)::int               AS confirmed,
               count(*) FILTER (
                 WHERE k.status IN ('generated', 'sent', 'pending_confirmation'))::int AS pending,
               count(*) FILTER (
                 WHERE k.status = 'expired' AND k."confirmedAt" IS NULL)::int          AS expired
          FROM "accessKey" k
         WHERE k."eventId" = ${eventId}::uuid
           AND k.email IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "accessKey" r WHERE r."regeneratedFrom" = k.code)`);
      return row ?? { invited: 0, sent: 0, confirmed: 0, pending: 0, expired: 0 };
    },

    async listPendingConfirmation(eventId, limit) {
      const rows = await prisma.accessKey.findMany({
        where: { eventId, status: "pending_confirmation", email: { not: null } },
        orderBy: [{ createdAt: "asc" }, { code: "asc" }],
        take: limit,
        select: { code: true },
      });
      return rows.map((r) => r.code);
    },
  };
}
