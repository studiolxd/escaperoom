import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  ANONYMOUS_ACTOR,
  buildDraftDoc,
  buildForkSeedUpdate,
  createFakePaymentGateway,
  createInMemoryRoomDraftStore,
  createInMemoryRoomLicenseStore,
  createRoomDraftService,
  createRoomLicenseService,
  RoomLicenseError,
  splitLicenseAmount,
  type Actor,
  type LicenseRoomRef,
  type PaymentGateway,
  type RoomPackageDocBuilder,
} from "../src/services";

const ORIGIN = "11111111-1111-4111-8111-111111111111";
const VERSION_1 = "22222222-2222-4222-8222-222222222221";
const VERSION_2 = "22222222-2222-4222-8222-222222222222";
const PRIVATE_ROOM = "11111111-1111-4111-8111-111111111112";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

/**
 * Builder de test: el doc guarda el RoomPackage como JSON en un mapa. El mapeo
 * real (`roomPackageToDoc`, 3.1) se prueba en los tests de web; el servicio
 * solo depende del puerto.
 */
const jsonDoc: RoomPackageDocBuilder = (pkg) => {
  const doc = new Y.Doc();
  doc.getMap<string>("test-package").set("json", JSON.stringify(pkg));
  return doc;
};
const readJsonDoc = (doc: Y.Doc): RoomPackage =>
  JSON.parse(doc.getMap<string>("test-package").get("json") ?? "{}") as RoomPackage;

/** Paquete congelado de una versión (como lo deja la publicación de 3.9). */
function frozen(semver: string): RoomPackage {
  return {
    ...structuredClone(reyAldric),
    meta: {
      ...structuredClone(reyAldric.meta),
      id: ORIGIN,
      authorId: author.userId,
      version: semver,
    },
  };
}

function setup(
  room: Partial<LicenseRoomRef> = {},
  payments: PaymentGateway | null = createFakePaymentGateway(),
) {
  const drafts = createInMemoryRoomDraftStore([{ id: ORIGIN, authorId: author.userId }]);
  const store = createInMemoryRoomLicenseStore({
    users: [
      { id: author.userId, email: "autora@example.test" },
      { id: buyer.userId, email: "Compradora@Example.test" },
      { id: other.userId, email: "otra@example.test" },
    ],
    rooms: [
      {
        id: ORIGIN,
        authorId: author.userId,
        title: "La Maldición del Rey Aldric",
        status: "published",
        licensable: true,
        licensePriceCents: 1500,
        currency: "EUR",
        ...room,
      },
      {
        id: PRIVATE_ROOM,
        authorId: author.userId,
        title: "Borrador",
        status: "draft",
        licensable: true,
        licensePriceCents: 100,
        currency: "EUR",
      },
    ],
    versions: [
      { id: VERSION_1, roomId: ORIGIN, semver: "1.0.0", package: frozen("1.0.0") },
      { id: VERSION_2, roomId: ORIGIN, semver: "1.0.1", package: frozen("1.0.1") },
    ],
    drafts,
  });
  const licenses = createRoomLicenseService({ store, buildDoc: jsonDoc, payments });
  const draftService = createRoomDraftService({ store: drafts });
  return { store, drafts, licenses, draftService, payments };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof RoomLicenseError) return err.code;
    throw err;
  }
  throw new Error("se esperaba RoomLicenseError");
}

async function forkPackage(
  t: ReturnType<typeof setup>,
  actor: Actor,
  roomId: string,
): Promise<RoomPackage> {
  const doc = buildDraftDoc(await t.draftService.loadDraft(actor, roomId));
  try {
    return readJsonDoc(doc);
  } finally {
    doc.destroy();
  }
}

describe("splitLicenseAmount", () => {
  it("70 % creador / 30 % plataforma, sin perder céntimos", () => {
    expect(splitLicenseAmount(1500)).toEqual({ platformFeeCents: 450, creatorShareCents: 1050 });
    expect(splitLicenseAmount(99)).toEqual({ platformFeeCents: 30, creatorShareCents: 69 });
    expect(splitLicenseAmount(0)).toEqual({ platformFeeCents: 0, creatorShareCents: 0 });
  });
});

describe("buildForkSeedUpdate", () => {
  it("siembra el paquete con meta.id y meta.authorId del fork y deja el resto intacto", () => {
    const update = buildForkSeedUpdate(jsonDoc, frozen("1.0.0"), {
      roomId: "fork",
      authorId: "nueva",
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const pkg = readJsonDoc(doc);
    expect(pkg.meta).toMatchObject({ id: "fork", authorId: "nueva", version: "1.0.0" });
    expect({ ...pkg, meta: undefined }).toEqual({ ...frozen("1.0.0"), meta: undefined });
  });
});

describe("gift-copy", () => {
  it("el autor regala la última versión: draft propio del receptor con linaje y compra a 0", async () => {
    const t = setup();
    const { room, purchase } = await t.licenses.giftCopy(author, ORIGIN, {
      recipientEmail: "  compradora@EXAMPLE.test ",
    });
    expect(room).toMatchObject({
      authorId: buyer.userId,
      status: "draft",
      title: "La Maldición del Rey Aldric",
      forkedFromRoomId: ORIGIN,
      forkedFromVersionId: VERSION_2,
    });
    expect(room.id).not.toBe(ORIGIN);
    expect(purchase).toMatchObject({
      userId: buyer.userId,
      roomVersionId: VERSION_2,
      resultingRoomId: room.id,
      amountCents: 0,
      platformFeeCents: 0,
      paymentRef: null,
      status: "succeeded",
    });
    const pkg = await forkPackage(t, buyer, room.id);
    expect(pkg).toEqual({
      ...frozen("1.0.1"),
      meta: { ...frozen("1.0.1").meta, id: room.id, authorId: buyer.userId },
    });
  });

  it("admite una versión concreta de la sala", async () => {
    const t = setup();
    const { room } = await t.licenses.giftCopy(author, ORIGIN, {
      recipientEmail: "otra@example.test",
      roomVersionId: VERSION_1,
    });
    expect(room.forkedFromVersionId).toBe(VERSION_1);
    expect((await forkPackage(t, other, room.id)).meta.version).toBe("1.0.0");
  });

  it("no exige licensable: regalar es decisión del autor", async () => {
    const t = setup({ licensable: false, licensePriceCents: null });
    const { room } = await t.licenses.giftCopy(author, ORIGIN, {
      recipientEmail: "otra@example.test",
    });
    expect(room.authorId).toBe(other.userId);
  });

  it("errores: 401, no-autor 403, email desconocido, a sí mismo, repetido, retirada", async () => {
    const t = setup();
    const body = { recipientEmail: "compradora@example.test" };
    expect(await codeOf(t.licenses.giftCopy(ANONYMOUS_ACTOR, ORIGIN, body))).toBe("UNAUTHORIZED");
    expect(await codeOf(t.licenses.giftCopy(buyer, ORIGIN, body))).toBe("FORBIDDEN");
    expect(
      await codeOf(t.licenses.giftCopy(author, ORIGIN, { recipientEmail: "nadie@example.test" })),
    ).toBe("RECIPIENT_NOT_FOUND");
    expect(
      await codeOf(t.licenses.giftCopy(author, ORIGIN, { recipientEmail: "autora@example.test" })),
    ).toBe("INVALID_RECIPIENT");
    expect(await codeOf(t.licenses.giftCopy(author, ORIGIN, { recipientEmail: "x" }))).toBe(
      "VALIDATION_ERROR",
    );
    expect(await codeOf(t.licenses.giftCopy(author, "no-uuid", body))).toBe("NOT_FOUND");
    expect(
      await codeOf(
        t.licenses.giftCopy(author, ORIGIN, { ...body, roomVersionId: crypto.randomUUID() }),
      ),
    ).toBe("ROOM_VERSION_UNAVAILABLE");
    // Una sala sin versiones publicadas no tiene nada que copiar.
    expect(await codeOf(t.licenses.giftCopy(author, PRIVATE_ROOM, body))).toBe(
      "ROOM_VERSION_UNAVAILABLE",
    );

    await t.licenses.giftCopy(author, ORIGIN, body);
    expect(await codeOf(t.licenses.giftCopy(author, ORIGIN, body))).toBe("LICENSE_ALREADY_OWNED");

    const removed = setup({ status: "removed" });
    expect(await codeOf(removed.licenses.giftCopy(author, ORIGIN, body))).toBe(
      "LICENSE_NOT_AVAILABLE",
    );
  });
});

describe("license-checkout", () => {
  it("con precio: compra pendiente + checkout en la pasarela, SIN fork hasta confirmar el pago", async () => {
    const payments = createFakePaymentGateway();
    const t = setup({}, payments);
    const result = await t.licenses.startLicenseCheckout(buyer, ORIGIN);
    expect(result.status).toBe("pending");
    if (result.status !== "pending") return;
    expect(result.checkoutUrl).toMatch(/^https:\/\/checkout\.example\.test\//);
    expect(result.purchase).toMatchObject({
      userId: buyer.userId,
      roomVersionId: VERSION_2,
      amountCents: 1500,
      platformFeeCents: 450,
      creatorShareCents: 1050,
      status: "pending",
      resultingRoomId: null,
    });
    expect(payments.licenseCalls).toEqual([
      {
        purchaseId: result.purchase.id,
        buyerId: buyer.userId,
        roomId: ORIGIN,
        roomVersionId: VERSION_2,
        title: "La Maldición del Rey Aldric",
        amountCents: 1500,
        currency: "EUR",
      },
    ]);
    // Sin pago confirmado no hay fork.
    expect([...t.store.rooms.values()].filter((r) => r.authorId === buyer.userId)).toEqual([]);

    const done = await t.licenses.confirmLicensePayment(result.purchase.id, {
      paymentRef: "pi_fake_1",
    });
    expect(done.room).toMatchObject({
      authorId: buyer.userId,
      status: "draft",
      forkedFromRoomId: ORIGIN,
      forkedFromVersionId: VERSION_2,
    });
    expect(done.purchase).toMatchObject({
      status: "succeeded",
      resultingRoomId: done.room.id,
      paymentRef: "pi_fake_1",
    });
    expect((await forkPackage(t, buyer, done.room.id)).meta.version).toBe("1.0.1");

    // Idempotente: el webhook puede repetirse sin crear otro fork.
    const again = await t.licenses.confirmLicensePayment(result.purchase.id, {
      paymentRef: "pi_fake_1",
    });
    expect(again.room.id).toBe(done.room.id);
    expect([...t.store.rooms.values()].filter((r) => r.authorId === buyer.userId)).toHaveLength(1);

    // Ya tiene esa versión: no se vuelve a cobrar.
    expect(await codeOf(t.licenses.startLicenseCheckout(buyer, ORIGIN))).toBe(
      "LICENSE_ALREADY_OWNED",
    );
  });

  it("confirmaciones concurrentes crean un único fork", async () => {
    const t = setup();
    const result = await t.licenses.startLicenseCheckout(buyer, ORIGIN);
    if (result.status !== "pending") throw new Error("se esperaba pending");
    const [a, b] = await Promise.all([
      t.licenses.confirmLicensePayment(result.purchase.id, { paymentRef: "pi_1" }),
      t.licenses.confirmLicensePayment(result.purchase.id, { paymentRef: "pi_1" }),
    ]);
    expect(a.room.id).toBe(b.room.id);
    expect([...t.store.rooms.values()].filter((r) => r.authorId === buyer.userId)).toHaveLength(1);
  });

  it("licencia a precio 0: fork inmediato sin pasarela", async () => {
    const payments = createFakePaymentGateway();
    const t = setup({ licensePriceCents: 0 }, payments);
    const result = await t.licenses.startLicenseCheckout(buyer, ORIGIN, {
      roomVersionId: VERSION_1,
    });
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.room).toMatchObject({ authorId: buyer.userId, forkedFromVersionId: VERSION_1 });
    expect(payments.licenseCalls).toEqual([]);
  });

  it("sala sin licencias → LICENSE_NOT_AVAILABLE; resto de errores", async () => {
    expect(
      await codeOf(setup({ licensable: false }).licenses.startLicenseCheckout(buyer, ORIGIN)),
    ).toBe("LICENSE_NOT_AVAILABLE");
    expect(
      await codeOf(setup({ licensePriceCents: null }).licenses.startLicenseCheckout(buyer, ORIGIN)),
    ).toBe("LICENSE_NOT_AVAILABLE");
    expect(
      await codeOf(setup({ status: "archived" }).licenses.startLicenseCheckout(buyer, ORIGIN)),
    ).toBe("LICENSE_NOT_AVAILABLE");
    expect(
      await codeOf(setup({ status: "removed" }).licenses.startLicenseCheckout(buyer, ORIGIN)),
    ).toBe("NOT_FOUND");

    const t = setup();
    expect(await codeOf(t.licenses.startLicenseCheckout(ANONYMOUS_ACTOR, ORIGIN))).toBe(
      "UNAUTHORIZED",
    );
    expect(await codeOf(t.licenses.startLicenseCheckout(author, ORIGIN))).toBe("LICENSE_OWN_ROOM");
    expect(await codeOf(t.licenses.startLicenseCheckout(buyer, PRIVATE_ROOM))).toBe("NOT_FOUND");
    expect(
      await codeOf(t.licenses.startLicenseCheckout(buyer, ORIGIN, { roomVersionId: "x" })),
    ).toBe("VALIDATION_ERROR");
    expect(await codeOf(t.licenses.startLicenseCheckout(buyer, ORIGIN, { extra: true }))).toBe(
      "VALIDATION_ERROR",
    );

    const noGateway = setup({}, null);
    expect(await codeOf(noGateway.licenses.startLicenseCheckout(buyer, ORIGIN))).toBe(
      "PAYMENT_GATEWAY_UNAVAILABLE",
    );
    expect(noGateway.store.purchases).toEqual([]);
  });

  it("confirmLicensePayment: compra inexistente o no pendiente", async () => {
    const t = setup();
    expect(
      await codeOf(t.licenses.confirmLicensePayment(crypto.randomUUID(), { paymentRef: "pi" })),
    ).toBe("NOT_FOUND");
    const result = await t.licenses.startLicenseCheckout(buyer, ORIGIN);
    if (result.status !== "pending") throw new Error("se esperaba pending");
    t.store.purchases[0]!.status = "failed";
    expect(
      await codeOf(t.licenses.confirmLicensePayment(result.purchase.id, { paymentRef: "pi" })),
    ).toBe("PURCHASE_NOT_PENDING");
  });
});

describe("independencia del fork", () => {
  it("editar el fork no toca el original ni su versión, y viceversa", async () => {
    const t = setup();
    const { room } = await t.licenses.giftCopy(author, ORIGIN, {
      recipientEmail: "compradora@example.test",
    });
    const versionBefore = await t.store.findVersion(VERSION_2);

    // Edición en el fork (un update Yjs más sobre SU doc).
    const forkDoc = buildDraftDoc(await t.draftService.loadDraft(buyer, room.id));
    const sv = Y.encodeStateVector(forkDoc);
    forkDoc
      .getMap<string>("test-package")
      .set("json", JSON.stringify({ ...readJsonDoc(forkDoc), extra: "del fork" }));
    await t.draftService.appendUpdate(buyer, room.id, Y.encodeStateAsUpdate(forkDoc, sv));

    // Edición en el original.
    const originDoc = new Y.Doc();
    originDoc.getMap<string>("otra").set("k", "del original");
    await t.draftService.appendUpdate(author, ORIGIN, Y.encodeStateAsUpdate(originDoc));

    expect(await forkPackage(t, buyer, room.id)).toMatchObject({ extra: "del fork" });
    const forkState = buildDraftDoc(await t.draftService.loadDraft(buyer, room.id));
    expect(forkState.getMap("otra").size).toBe(0);
    const originState = buildDraftDoc(await t.draftService.loadDraft(author, ORIGIN));
    expect(originState.getMap("test-package").size).toBe(0);
    expect(await t.store.findVersion(VERSION_2)).toEqual(versionBefore);

    // Permisos: cada uno solo edita lo suyo.
    await expect(t.draftService.loadDraft(author, room.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(t.draftService.loadDraft(buyer, ORIGIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
