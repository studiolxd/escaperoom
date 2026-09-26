import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client";
import { createPrismaClient } from "../src/db";
import type { PendingConfirmationsWindow } from "../src/services";
import { createPrismaPurchaseConfirmationStore } from "../src/services";

/** Las mismas sentencias UPDATE de la migración 20260924220000 (backfill), leídas del fichero real. */
const BACKFILL_STATEMENTS = readFileSync(
  fileURLToPath(
    new URL(
      "../prisma/migrations/20260924220000_purchase_confirmation_outbox/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)
  .split(";")
  .map((s) =>
    s
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter((s) => s.toUpperCase().startsWith("UPDATE"));

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test purchase-confirmation-prisma
//
// Comprueba el outbox mínimo (E-11, con la ventana acotada de la revisión de
// PR #119): markConfirmationSent persiste la marca en Postgres;
// findPendingConfirmations distingue "pending" (dentro de la ventana, se
// reencola) de "abandoned" (más viejo que abandonCutoff, no se reencola más)
// y respeta `limit`. Solo cubre `room`/`room_license` (vía `purchase`):
// `event_credits` usa la misma consulta contra `event.confirmationSentAt`
// (con `config.payment.paidAt` como referencia en vez de `createdAt`), sin
// lógica adicional que justifique duplicar aquí el fixture (organizador +
// roomVersion + evento).
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `it114${randomUUID().slice(0, 8)}`;

/** Ventana con límites explícitos por defecto amplios (no interfieren salvo que el test los estreche). */
function window(overrides: Partial<PendingConfirmationsWindow> = {}): PendingConfirmationsWindow {
  return {
    recentCutoff: new Date(Date.now() + 60_000), // futuro: cualquier createdAt real cae "dentro".
    abandonCutoff: new Date("2000-01-01T00:00:00Z"), // muy en el pasado: nada cae "abandonado" por defecto.
    abandonWindowStart: new Date(0), // epoch: por defecto no recorta "abandoned" por abajo.
    limit: 100,
    ...overrides,
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "outbox del email de confirmación de compra sobre Postgres (integración, E-11)",
  () => {
    let prisma: PrismaClient;
    const userId = `${TAG}-user`;
    let roomId = "";
    let roomVersionId = "";
    let semverSeq = 0;

    /**
     * B-16 (`uxPurchaseOwnedRoom`): como máximo una `purchase` `room`
     * `succeeded` por `(userId, roomVersionId)`. Este fichero prueba el
     * barrido de confirmación, no esa regla de negocio, así que cada
     * `purchase` `room` `succeeded` que necesite un test usa SU PROPIA
     * versión — nunca comparte `roomVersionId` con otra ya `succeeded`.
     */
    async function newRoomVersion(): Promise<string> {
      semverSeq += 1;
      const version = await prisma.roomVersion.create({
        data: {
          roomId,
          semver: `1.0.${semverSeq}`,
          package: {},
          assetsHash: "test",
          publishedBy: userId,
        },
      });
      return version.id;
    }

    beforeAll(async () => {
      prisma = createPrismaClient();
      await prisma.user.create({
        data: { id: userId, name: "Compradora de prueba", email: `${TAG}@escaperoom.local` },
      });
      // Fixture mínimo: chkPurchaseTarget exige roomVersionId para room/room_license.
      const room = await prisma.room.create({
        data: { authorId: userId, title: `Sala de prueba ${TAG}` },
      });
      roomId = room.id;
    });

    beforeEach(async () => {
      roomVersionId = await newRoomVersion();
    });

    afterEach(async () => {
      await prisma.purchase.deleteMany({ where: { userId } });
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.purchase.deleteMany({ where: { userId } });
      await prisma.roomVersion.deleteMany({ where: { roomId } });
      await prisma.room.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("findPendingConfirmations encuentra una succeeded sin confirmationSentAt y deja de hacerlo tras markConfirmationSent", async () => {
      const store = createPrismaPurchaseConfirmationStore(prisma);

      const purchase = await prisma.purchase.create({
        data: {
          userId,
          purchaseType: "room",
          roomVersionId,
          amountCents: 1999,
          status: "succeeded",
          stripePaymentIntentId: `pi_${TAG}`,
        },
      });

      const before = await store.findPendingConfirmations(window());
      expect(before.pending).toContainEqual({ kind: "room", purchaseId: purchase.id });
      expect(before.abandoned).not.toContainEqual({ kind: "room", purchaseId: purchase.id });

      await store.markConfirmationSent({ kind: "room", purchaseId: purchase.id });

      const confirmed = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(confirmed.confirmationSentAt).not.toBeNull();

      const after = await store.findPendingConfirmations(window());
      expect(after.pending).not.toContainEqual({ kind: "room", purchaseId: purchase.id });
    });

    it("una compra demasiado reciente (dentro del margen de gracia) no cuenta como pendiente todavía", async () => {
      const store = createPrismaPurchaseConfirmationStore(prisma);
      const purchase = await prisma.purchase.create({
        data: {
          userId,
          purchaseType: "room",
          roomVersionId,
          amountCents: 500,
          status: "succeeded",
          stripePaymentIntentId: `pi_reciente_${TAG}`,
        },
      });
      // recentCutoff en el pasado: la compra (createdAt ~ ahora) queda FUERA
      // de la ventana — el webhook todavía no ha tenido tiempo de intentarlo.
      const result = await store.findPendingConfirmations(
        window({ recentCutoff: new Date(Date.now() - 60_000) }),
      );
      expect(result.pending).not.toContainEqual({ kind: "room", purchaseId: purchase.id });
      expect(result.abandoned).not.toContainEqual({ kind: "room", purchaseId: purchase.id });
    });

    it("E-11 (revisión PR #119): una compra vieja sin confirmar es 'abandoned', no 'pending' — deja de reencolarse", async () => {
      const store = createPrismaPurchaseConfirmationStore(prisma);
      const oldDate = new Date("2020-01-01T00:00:00Z");
      const purchase = await prisma.purchase.create({
        data: {
          userId,
          purchaseType: "room",
          roomVersionId,
          amountCents: 500,
          status: "succeeded",
          stripePaymentIntentId: `pi_vieja_${TAG}`,
          createdAt: oldDate,
        },
      });
      // abandonCutoff posterior a oldDate: la compra queda antes del corte → abandonada.
      const result = await store.findPendingConfirmations(
        window({ abandonCutoff: new Date("2021-01-01T00:00:00Z") }),
      );
      expect(result.abandoned).toContainEqual({ kind: "room", purchaseId: purchase.id });
      expect(result.pending).not.toContainEqual({ kind: "room", purchaseId: purchase.id });
    });

    it("E-11 (revisión PR #119): una compra abandonada en una pasada anterior no vuelve a reportarse en 'abandoned'", async () => {
      const store = createPrismaPurchaseConfirmationStore(prisma);
      // Cruzó el umbral de abandono hace mucho: un barrido anterior ya la
      // reportó (o debería haberlo hecho). No debe volver a aparecer.
      const veryOldDate = new Date("2015-01-01T00:00:00Z");
      const purchase = await prisma.purchase.create({
        data: {
          userId,
          purchaseType: "room",
          roomVersionId,
          amountCents: 500,
          status: "succeeded",
          stripePaymentIntentId: `pi_muy_vieja_${TAG}`,
          createdAt: veryOldDate,
        },
      });
      // abandonCutoff/abandonWindowStart simulan un barrido reciente: el
      // intervalo [2021-01-01, 2021-01-08) no contiene 2015-01-01, así que la
      // fila ya "pasó de largo" ese bucket en pasadas anteriores.
      const result = await store.findPendingConfirmations(
        window({
          abandonCutoff: new Date("2021-01-08T00:00:00Z"),
          abandonWindowStart: new Date("2021-01-01T00:00:00Z"),
        }),
      );
      expect(result.abandoned).not.toContainEqual({ kind: "room", purchaseId: purchase.id });
      expect(result.pending).not.toContainEqual({ kind: "room", purchaseId: purchase.id });
    });

    it("respeta el límite por bucket (no vuelca sin tope una tabla grande)", async () => {
      const store = createPrismaPurchaseConfirmationStore(prisma);
      const purchases = await Promise.all(
        Array.from({ length: 3 }, async (_, i) =>
          prisma.purchase.create({
            data: {
              userId,
              purchaseType: "room",
              roomVersionId: await newRoomVersion(),
              amountCents: 100,
              status: "succeeded",
              stripePaymentIntentId: `pi_limit_${TAG}_${i}`,
            },
          }),
        ),
      );
      const result = await store.findPendingConfirmations(window({ limit: 1 }));
      const relevant = result.pending.filter(
        (j) => j.kind === "room" && purchases.some((p) => p.id === j.purchaseId),
      );
      expect(relevant.length).toBeLessThanOrEqual(1);
    });

    it("E-11 (revisión PR #119): el backfill de la migración marca lo histórico como ya confirmado, no lo que sigue pendiente de pago", async () => {
      const succeeded = await prisma.purchase.create({
        data: {
          userId,
          purchaseType: "room",
          roomVersionId,
          amountCents: 700,
          status: "succeeded",
          stripePaymentIntentId: `pi_backfill_${TAG}`,
        },
      });
      const stillPending = await prisma.purchase.create({
        data: { userId, purchaseType: "room_license", roomVersionId, amountCents: 0, status: "pending" },
      });

      for (const statement of BACKFILL_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
      }

      const confirmedAfterBackfill = await prisma.purchase.findUniqueOrThrow({
        where: { id: succeeded.id },
      });
      expect(confirmedAfterBackfill.confirmationSentAt).not.toBeNull();

      const pendingAfterBackfill = await prisma.purchase.findUniqueOrThrow({
        where: { id: stillPending.id },
      });
      expect(pendingAfterBackfill.confirmationSentAt).toBeNull();

      // Tras el backfill, esta compra succeeded ya no aparece en el barrido
      // (es justo el punto: no reenviar el email a todo el histórico).
      const store = createPrismaPurchaseConfirmationStore(prisma);
      const result = await store.findPendingConfirmations(window());
      expect(result.pending).not.toContainEqual({ kind: "room", purchaseId: succeeded.id });
      expect(result.abandoned).not.toContainEqual({ kind: "room", purchaseId: succeeded.id });
    });

    it("una compra pending (no succeeded) nunca es pendiente de confirmación", async () => {
      const store = createPrismaPurchaseConfirmationStore(prisma);
      const purchase = await prisma.purchase.create({
        data: { userId, purchaseType: "room_license", roomVersionId, amountCents: 0, status: "pending" },
      });
      const result = await store.findPendingConfirmations(window());
      expect(result.pending).not.toContainEqual({ kind: "room_license", purchaseId: purchase.id });
      expect(result.abandoned).not.toContainEqual({ kind: "room_license", purchaseId: purchase.id });
    });
  },
);
