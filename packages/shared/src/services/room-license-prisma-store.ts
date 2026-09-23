import type { PrismaClient } from "../../generated/client";
import type { RoomPackage } from "../schemas";
import type {
  ForkRoomRow,
  LicensePurchaseRow,
  LicenseVersionRef,
  RoomLicenseStore,
} from "./room-license";

type PurchaseRow = {
  id: string;
  userId: string;
  roomVersionId: string | null;
  resultingRoomId: string | null;
  amountCents: number;
  currency: string;
  platformFeeCents: number;
  creatorShareCents: number | null;
  stripePaymentIntentId: string | null;
  stripeTransferId: string | null;
  status: LicensePurchaseRow["status"];
  createdAt: Date;
};

function toPurchase(row: PurchaseRow): LicensePurchaseRow {
  return {
    id: row.id,
    userId: row.userId,
    // `chkPurchaseTarget` garantiza `roomVersionId` en `room_license`.
    roomVersionId: row.roomVersionId ?? "",
    resultingRoomId: row.resultingRoomId,
    amountCents: row.amountCents,
    currency: row.currency,
    platformFeeCents: row.platformFeeCents,
    creatorShareCents: row.creatorShareCents,
    paymentRef: row.stripePaymentIntentId,
    transferRef: row.stripeTransferId,
    status: row.status,
    createdAt: row.createdAt,
  };
}

const versionSelect = { id: true, roomId: true, semver: true, package: true } as const;

function toVersion(row: {
  id: string;
  roomId: string;
  semver: string;
  package: unknown;
}): LicenseVersionRef {
  // El `package` se escribió validado y congelado al publicar (3.9).
  return { ...row, package: row.package as RoomPackage };
}

/** Señal interna para deshacer la transacción del fork si la compra ya no estaba `pending`. */
class AlreadySettled extends Error {}

/**
 * Implementación Prisma del puerto de licencias. Las columnas existen desde
 * `0005_rooms` (`licensable`, `licensePriceCents`, `forkedFrom*`) y
 * `0007_purchases` (`room_license`, `resultingRoomId`): no hace falta migración.
 * La referencia de la pasarela (checkout abierto y, al confirmar, el pago) se
 * guarda en `stripePaymentIntentId`: la exige `chkPurchasePaidNeedsStripe`
 * cuando `amountCents > 0`, también con la compra aún `pending`.
 */
export function createPrismaRoomLicenseStore(prisma: PrismaClient): RoomLicenseStore {
  return {
    async findUserIdByEmail(email) {
      // `email` es `citext`: la comparación ya ignora mayúsculas.
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      return user?.id ?? null;
    },
    async findRoom(roomId) {
      return prisma.room.findFirst({
        where: { id: roomId, deletedAt: null },
        select: {
          id: true,
          authorId: true,
          title: true,
          status: true,
          licensable: true,
          licensePriceCents: true,
          currency: true,
        },
      });
    },
    async findLatestVersion(roomId) {
      const row = await prisma.roomVersion.findFirst({
        where: { roomId },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        select: versionSelect,
      });
      return row ? toVersion(row) : null;
    },
    async findVersion(versionId) {
      const row = await prisma.roomVersion.findUnique({
        where: { id: versionId },
        select: versionSelect,
      });
      return row ? toVersion(row) : null;
    },
    async findPurchase(id) {
      const row = await prisma.purchase.findFirst({ where: { id, purchaseType: "room_license" } });
      return row ? toPurchase(row) : null;
    },
    async findForkRoom(roomId): Promise<ForkRoomRow | null> {
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room?.forkedFromRoomId || !room.forkedFromVersionId) return null;
      return {
        id: room.id,
        authorId: room.authorId,
        title: room.title,
        currency: room.currency,
        status: room.status,
        forkedFromRoomId: room.forkedFromRoomId,
        forkedFromVersionId: room.forkedFromVersionId,
        createdAt: room.createdAt,
      };
    },
    async findOwnedLicense(userId, roomVersionId) {
      const row = await prisma.purchase.findFirst({
        where: { userId, roomVersionId, purchaseType: "room_license", status: "succeeded" },
        orderBy: { createdAt: "asc" },
      });
      return row ? toPurchase(row) : null;
    },
    async findCreatorAccountForVersion(roomVersionId) {
      const version = await prisma.roomVersion.findUnique({
        where: { id: roomVersionId },
        select: {
          room_roomVersion_roomIdToroom: {
            select: { authorId: true, user: { select: { stripeAccountId: true } } },
          },
        },
      });
      if (!version) return null;
      const room = version.room_roomVersion_roomIdToroom;
      return { authorId: room.authorId, stripeAccountId: room.user.stripeAccountId };
    },
    async attachTransfer(purchaseId, transferRef) {
      const row = await prisma.purchase
        .update({ where: { id: purchaseId }, data: { stripeTransferId: transferRef } })
        .catch(() => null);
      return row ? toPurchase(row) : null;
    },
    async markFailed(purchaseId) {
      const { count } = await prisma.purchase.updateMany({
        where: { id: purchaseId, purchaseType: "room_license", status: "pending" },
        data: { status: "failed" },
      });
      if (count === 0) return null;
      const row = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
      return toPurchase(row);
    },
    async insertPendingPurchase({ paymentRef, ...purchase }) {
      const row = await prisma.purchase.create({
        data: {
          ...purchase,
          purchaseType: "room_license",
          status: "pending",
          stripePaymentIntentId: paymentRef,
        },
      });
      return toPurchase(row);
    },
    async createFork({ room, initialUpdate, settlement }) {
      try {
        return await prisma.$transaction(async (tx) => {
          const created = await tx.room.create({
            data: {
              id: room.id,
              authorId: room.authorId,
              title: room.title,
              currency: room.currency,
              status: "draft",
              licensable: false,
              forkedFromRoomId: room.forkedFromRoomId,
              forkedFromVersionId: room.forkedFromVersionId,
            },
          });
          await tx.roomUpdate.create({
            data: {
              roomId: room.id,
              updateData: Buffer.from(initialUpdate),
              authorId: room.authorId,
            },
          });
          let purchase: PurchaseRow;
          if (settlement.kind === "insert") {
            purchase = await tx.purchase.create({
              data: {
                ...settlement.purchase,
                purchaseType: "room_license",
                status: "succeeded",
                resultingRoomId: room.id,
              },
            });
          } else {
            // Escritura condicional: con dos confirmaciones concurrentes, la
            // segunda espera el lock de la fila y ya no la ve `pending`.
            const { count } = await tx.purchase.updateMany({
              where: { id: settlement.purchaseId, purchaseType: "room_license", status: "pending" },
              data: {
                status: "succeeded",
                resultingRoomId: room.id,
                stripePaymentIntentId: settlement.paymentRef,
              },
            });
            if (count === 0) throw new AlreadySettled();
            purchase = await tx.purchase.findUniqueOrThrow({
              where: { id: settlement.purchaseId },
            });
          }
          return {
            room: {
              ...room,
              status: created.status,
              createdAt: created.createdAt,
            },
            purchase: toPurchase(purchase),
          };
        });
      } catch (err) {
        if (err instanceof AlreadySettled) return null;
        throw err;
      }
    },
  };
}
