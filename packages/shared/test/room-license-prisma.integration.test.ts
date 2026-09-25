import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { PrismaClient } from "../generated/client";
import type { RoomPackage } from "../src/schemas";
import {
  buildDraftDoc,
  createFakePaymentGateway,
  createPrismaRoomDraftStore,
  createPrismaRoomLicenseStore,
  createRoomDraftService,
  createRoomLicenseService,
  RoomLicenseError,
  type Actor,
} from "../src/services";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test room-license-prisma
//
// Comprueba que `createPrismaRoomLicenseStore` respeta los CHECK de `purchase`
// (`room_license` con `roomVersionId`, pago > 0 con referencia), que el fork
// nace en `draft` con linaje y su primer `roomUpdate`, y que la confirmación
// del pago es idempotente también con dos confirmaciones concurrentes.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as RoomPackage;

const TAG = `it510${randomUUID().slice(0, 8)}`;
const actor = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });

/** Builder de test (JSON en un mapa): el mapeo real de 3.1 se prueba en web. */
const jsonDoc = (pkg: RoomPackage) => {
  const doc = new Y.Doc();
  doc.getMap<string>("test-package").set("json", JSON.stringify(pkg));
  return doc;
};

describe.skipIf(!process.env.DATABASE_URL)("licencias sobre Postgres (integración)", () => {
  let prisma: PrismaClient;
  const userIds = { autora: `${TAG}-autora`, compradora: `${TAG}-compradora` };
  let originId = "";
  let versionId = "";

  function services() {
    const drafts = createPrismaRoomDraftStore(prisma);
    return {
      licenses: createRoomLicenseService({
        store: createPrismaRoomLicenseStore(prisma),
        buildDoc: jsonDoc,
        payments: createFakePaymentGateway(),
      }),
      drafts: createRoomDraftService({ store: drafts }),
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.createMany({
      data: Object.entries(userIds).map(([name, id]) => ({
        id,
        name,
        email: `${id}@test.local`,
      })),
    });
    const room = await prisma.room.create({
      data: {
        authorId: userIds.autora,
        title: TAG,
        status: "published",
        licensable: true,
        licensePriceCents: 1000,
      },
    });
    const version = await prisma.roomVersion.create({
      data: {
        roomId: room.id,
        semver: "1.0.0",
        assetsHash: "sha256:test",
        publishedBy: userIds.autora,
        package: { ...fixture, meta: { ...fixture.meta, id: room.id } } as object,
      },
    });
    originId = room.id;
    versionId = version.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    const users = Object.values(userIds);
    const forks = await prisma.room.findMany({
      where: { forkedFromRoomId: originId },
      select: { id: true },
    });
    await prisma.purchase.deleteMany({ where: { userId: { in: users } } });
    await prisma.room.deleteMany({ where: { id: { in: forks.map((f) => f.id) } } });
    await prisma.roomVersion.deleteMany({ where: { roomId: originId } });
    await prisma.room.deleteMany({ where: { id: originId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("gift-copy: fork en draft con linaje, primer roomUpdate y compra a 0 sin referencia de pago", async () => {
    const { licenses, drafts } = services();
    const { room, purchase } = await licenses.giftCopy(actor(userIds.autora), originId, {
      recipientEmail: `${userIds.compradora.toUpperCase()}@TEST.LOCAL`,
    });
    const row = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(row).toMatchObject({
      authorId: userIds.compradora,
      status: "draft",
      licensable: false,
      forkedFromRoomId: originId,
      forkedFromVersionId: versionId,
    });
    expect(purchase).toMatchObject({ status: "succeeded", amountCents: 0, paymentRef: null });
    const doc = buildDraftDoc(await drafts.loadDraft(actor(userIds.compradora), room.id));
    const pkg = JSON.parse(doc.getMap<string>("test-package").get("json")!) as RoomPackage;
    expect(pkg.meta).toMatchObject({ id: room.id, authorId: userIds.compradora });
    await expect(
      licenses.giftCopy(actor(userIds.autora), originId, {
        recipientEmail: `${userIds.compradora}@test.local`,
      }),
    ).rejects.toMatchObject({ code: "LICENSE_ALREADY_OWNED" });
    // Libera la versión para el test de compra.
    await prisma.purchase.deleteMany({ where: { userId: userIds.compradora } });
  });

  it("license-checkout: pendiente sin fork; confirmaciones concurrentes → un único fork", async () => {
    const { licenses } = services();
    const before = await prisma.room.count({ where: { forkedFromRoomId: originId } });
    const result = await licenses.startLicenseCheckout(actor(userIds.compradora), originId, {}, {
      successUrl: "https://app.test/success",
      cancelUrl: "https://app.test/cancel",
    });
    if (result.status !== "pending") throw new Error("se esperaba pending");
    expect(await prisma.room.count({ where: { forkedFromRoomId: originId } })).toBe(before);

    const settled = await Promise.allSettled([
      licenses.confirmLicensePayment(result.purchase.id, { paymentRef: `pi_${TAG}` }),
      licenses.confirmLicensePayment(result.purchase.id, { paymentRef: `pi_${TAG}` }),
    ]);
    const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    for (const s of settled) {
      if (s.status === "rejected") expect(s.reason).toBeInstanceOf(RoomLicenseError);
    }
    expect(ok.length).toBeGreaterThan(0);
    expect(new Set(ok.map((r) => r.room.id)).size).toBe(1);
    expect(await prisma.room.count({ where: { forkedFromRoomId: originId } })).toBe(before + 1);
    const purchase = await prisma.purchase.findUniqueOrThrow({
      where: { id: result.purchase.id },
    });
    expect(purchase).toMatchObject({
      purchaseType: "room_license",
      status: "succeeded",
      resultingRoomId: ok[0]!.room.id,
      stripePaymentIntentId: `pi_${TAG}`,
      platformFeeCents: 300,
      creatorShareCents: 700,
    });
  });
});
