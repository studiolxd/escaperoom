import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  buildDraftDoc,
  createFakePaymentGateway,
  createInMemoryRoomDraftStore,
  createInMemoryRoomLicenseStore,
  createRoomDraftService,
  createRoomLicenseService,
  type Actor,
  type LicenseRoomRef,
  type PaymentGateway,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createRoomLicenseHandlers } from "../src/server/rest/room-license";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const creator: Actor = { userId: "creadora", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const ORIGIN = "20000000-0000-4000-8000-000000000001";
const VERSION = "10000000-0000-4000-8000-000000000001";
/** Asset ya publicado del original: se referencia, no se copia. */
const PUBLISHED_AUDIO = `r2://assets/rooms/${ORIGIN}/${"a".repeat(64)}.mp3`;

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

/** `package` congelado de la versión 1.0.0 del original (como lo deja 3.9). */
const published: RoomPackage = (() => {
  const pkg = structuredClone(reyAldric);
  pkg.meta = { ...pkg.meta, id: ORIGIN, authorId: author.userId, version: "1.0.0" };
  const intro = pkg.dialogs[0]!;
  intro.text = { es: { ...intro.text.es!, audioUrl: PUBLISHED_AUDIO } };
  return pkg;
})();

type ForkJson = {
  purchase: {
    id: string;
    status: string;
    amountCents: number;
    resultingRoomId: string | null;
    roomVersionId: string;
  };
  room: {
    id: string;
    title: string;
    status: string;
    forkedFromRoomId: string;
    forkedFromVersionId: string;
  };
};
type CheckoutJson = { purchase: ForkJson["purchase"]; checkoutUrl: string };
type ErrorJson = { error: { code: string; message: string; resultingRoomId?: string } };

/** Handlers REST con stores en memoria y el mapeo real doc ⇄ RoomPackage (3.1). */
function setup(
  room: Partial<LicenseRoomRef> = {},
  payments: PaymentGateway | null = createFakePaymentGateway(),
) {
  const drafts = createInMemoryRoomDraftStore([{ id: ORIGIN, authorId: author.userId }]);
  const store = createInMemoryRoomLicenseStore({
    users: [
      { id: author.userId, email: "autora@example.test" },
      { id: creator.userId, email: "creadora@example.test" },
      { id: other.userId, email: "otra@example.test" },
    ],
    rooms: [
      {
        id: ORIGIN,
        authorId: author.userId,
        title: "La Maldición del Rey Aldric",
        status: "published",
        licensable: true,
        licensePriceCents: 1200,
        currency: "EUR",
        ...room,
      },
    ],
    versions: [{ id: VERSION, roomId: ORIGIN, semver: "1.0.0", package: published }],
    drafts,
  });
  const licenses = createRoomLicenseService({
    store,
    buildDoc: (pkg) => roomPackageToDoc(pkg),
    payments,
  });
  const draftService = createRoomDraftService({ store: drafts });
  const actors: Record<string, Actor> = { autora: author, creadora: creator, otra: other };
  const handlers = createRoomLicenseHandlers({
    licenses,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
    buildUrls: (roomId) => ({
      successUrl: `https://app.test/success?roomId=${roomId}`,
      cancelUrl: `https://app.test/cancel?roomId=${roomId}`,
    }),
  });
  const req = (path: string, init: { user?: string; body?: unknown; raw?: string } = {}) =>
    new Request(`http://localhost/api/rooms/${ORIGIN}/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(init.user ? { "x-test-user": init.user } : {}),
      },
      body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
  const ctx = { params: Promise.resolve({ roomId: ORIGIN }) };

  /** El draft de una sala, serializado con `roomDocToPackage`. */
  async function draftPackage(actor: Actor, roomId: string): Promise<RoomPackage> {
    const doc = buildDraftDoc(await draftService.loadDraft(actor, roomId));
    try {
      return roomDocToPackage(doc);
    } finally {
      doc.destroy();
    }
  }

  /** Aplica una edición sobre el draft de una sala como un update Yjs más. */
  async function edit(actor: Actor, roomId: string, change: (doc: Y.Doc) => void) {
    const doc = buildDraftDoc(await draftService.loadDraft(actor, roomId));
    const before = Y.encodeStateVector(doc);
    change(doc);
    await draftService.appendUpdate(actor, roomId, Y.encodeStateAsUpdate(doc, before));
    doc.destroy();
  }

  return {
    store,
    licenses,
    draftService,
    draftPackage,
    edit,
    gift: (body: unknown, user?: string, raw?: string) =>
      handlers.postGiftCopy(req("gift-copy", { user, body, raw }), ctx),
    checkout: (body: unknown, user?: string) =>
      handlers.postLicenseCheckout(req("license-checkout", { user, body }), ctx),
  };
}

async function errorCode(res: Response, status: number): Promise<string> {
  expect(res.status).toBe(status);
  return ((await res.json()) as ErrorJson).error.code;
}

describe("POST /api/rooms/:roomId/gift-copy", () => {
  it("201: draft propio del receptor, equivalente al paquete publicado y con linaje", async () => {
    const t = setup();
    const res = await t.gift({ recipientEmail: "creadora@example.test" }, "autora");
    expect(res.status).toBe(201);
    const { room, purchase } = (await res.json()) as ForkJson;
    expect(room).toMatchObject({
      title: "La Maldición del Rey Aldric",
      status: "draft",
      forkedFromRoomId: ORIGIN,
      forkedFromVersionId: VERSION,
    });
    expect(purchase).toMatchObject({
      status: "succeeded",
      amountCents: 0,
      roomVersionId: VERSION,
      resultingRoomId: room.id,
    });

    // `roomDocToPackage` del fork = el paquete publicado (salvo meta.id/authorId del fork).
    const forkPkg = await t.draftPackage(creator, room.id);
    expect(forkPkg).toEqual({
      ...published,
      meta: { ...published.meta, id: room.id, authorId: creator.userId },
    });
    // El asset publicado del original se referencia tal cual (no se copia).
    expect(forkPkg.dialogs[0]!.text.es!.audioUrl).toBe(PUBLISHED_AUDIO);
    // La sala del fork es del receptor, con el linaje guardado.
    expect(t.store.rooms.get(room.id)).toMatchObject({
      authorId: creator.userId,
      status: "draft",
      licensable: false,
      forkedFromRoomId: ORIGIN,
      forkedFromVersionId: VERSION,
    });
  });

  it("editar el fork no cambia el original ni su versión publicada, y viceversa", async () => {
    const t = setup();
    // El original tiene su propio draft (sembrado igual que el editor al abrir un paquete).
    await t.draftService.appendUpdate(
      author,
      ORIGIN,
      Y.encodeStateAsUpdate(roomPackageToDoc(published)),
    );
    const res = await t.gift({ recipientEmail: "creadora@example.test" }, "autora");
    const { room } = (await res.json()) as ForkJson;

    await t.edit(creator, room.id, (doc) => doc.getMap("meta").set("title", "Mi versión"));
    await t.edit(author, ORIGIN, (doc) => doc.getMap("meta").set("difficulty", 3));

    const fork = await t.draftPackage(creator, room.id);
    const origin = await t.draftPackage(author, ORIGIN);
    expect(fork.meta).toMatchObject({ title: "Mi versión", difficulty: published.meta.difficulty });
    expect(origin.meta).toMatchObject({ title: published.meta.title, difficulty: 3 });
    expect((await t.store.findVersion(VERSION))?.package).toEqual(published);
  });

  it("un no-autor no puede regalar (403); sin sesión 401", async () => {
    const t = setup();
    const body = { recipientEmail: "otra@example.test" };
    expect(await errorCode(await t.gift(body, "creadora"), 403)).toBe("FORBIDDEN");
    expect(await errorCode(await t.gift(body), 401)).toBe("UNAUTHORIZED");
    expect(t.store.purchases).toEqual([]);
  });

  it("errores de entrada: JSON roto 400, email no válido 422, desconocido 404, repetido 409", async () => {
    const t = setup();
    expect(await errorCode(await t.gift(undefined, "autora", "{"), 400)).toBe("BAD_REQUEST");
    expect(await errorCode(await t.gift({ recipientEmail: "x" }, "autora"), 422)).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await errorCode(await t.gift({ recipientEmail: "nadie@example.test" }, "autora"), 404),
    ).toBe("RECIPIENT_NOT_FOUND");
    expect(
      await errorCode(await t.gift({ recipientEmail: "autora@example.test" }, "autora"), 422),
    ).toBe("INVALID_RECIPIENT");

    const first = (await (
      await t.gift({ recipientEmail: "otra@example.test" }, "autora")
    ).json()) as ForkJson;
    const again = await t.gift({ recipientEmail: "otra@example.test" }, "autora");
    expect(again.status).toBe(409);
    const json = (await again.json()) as ErrorJson;
    expect(json.error).toMatchObject({
      code: "LICENSE_ALREADY_OWNED",
      resultingRoomId: first.room.id,
    });
  });
});

describe("POST /api/rooms/:roomId/license-checkout", () => {
  it("sin pago confirmado no crea el fork; con el pago (fake) confirmado, sí", async () => {
    const payments = createFakePaymentGateway();
    const t = setup({}, payments);
    const res = await t.checkout(undefined, "creadora");
    expect(res.status).toBe(200);
    const { purchase, checkoutUrl } = (await res.json()) as CheckoutJson;
    expect(checkoutUrl).toMatch(/^https:\/\/checkout\.example\.test\//);
    expect(purchase).toMatchObject({
      status: "pending",
      amountCents: 1200,
      resultingRoomId: null,
    });
    expect(payments.licenseCalls).toHaveLength(1);
    expect([...t.store.rooms.values()].some((r) => r.authorId === creator.userId)).toBe(false);

    // Lo que hará el webhook de 5.1 al recibir el pago.
    const { room } = await t.licenses.confirmLicensePayment(purchase.id, {
      paymentRef: "pi_fake_123",
    });
    expect(room).toMatchObject({
      authorId: creator.userId,
      status: "draft",
      forkedFromRoomId: ORIGIN,
      forkedFromVersionId: VERSION,
    });
    expect(await t.draftPackage(creator, room.id)).toEqual({
      ...published,
      meta: { ...published.meta, id: room.id, authorId: creator.userId },
    });
    expect(t.store.purchases[0]).toMatchObject({
      status: "succeeded",
      resultingRoomId: room.id,
      paymentRef: "pi_fake_123",
      platformFeeCents: 360,
      creatorShareCents: 840,
    });
  });

  it("sala sin licencias → 422 LICENSE_NOT_AVAILABLE con mensaje claro", async () => {
    const res = await setup({ licensable: false }).checkout({}, "creadora");
    expect(res.status).toBe(422);
    const { error } = (await res.json()) as ErrorJson;
    expect(error.code).toBe("LICENSE_NOT_AVAILABLE");
    expect(error.message).toMatch(/licencia/);
  });

  it("licencia gratuita: 201 con el fork inmediato", async () => {
    const res = await setup({ licensePriceCents: 0 }).checkout({}, "creadora");
    expect(res.status).toBe(201);
    const { room, purchase } = (await res.json()) as ForkJson;
    expect(room.status).toBe("draft");
    expect(purchase).toMatchObject({ status: "succeeded", amountCents: 0 });
  });

  it("permisos y estados: 401, autor 409, sin pasarela 501", async () => {
    const t = setup();
    expect(await errorCode(await t.checkout({}), 401)).toBe("UNAUTHORIZED");
    expect(await errorCode(await t.checkout({}, "autora"), 409)).toBe("LICENSE_OWN_ROOM");
    expect(await errorCode(await t.checkout({ roomVersionId: "x" }, "creadora"), 422)).toBe(
      "VALIDATION_ERROR",
    );
    const noGateway = setup({}, null);
    expect(await errorCode(await noGateway.checkout({}, "creadora"), 501)).toBe(
      "PAYMENT_GATEWAY_UNAVAILABLE",
    );
    expect(noGateway.store.purchases).toEqual([]);
  });
});
