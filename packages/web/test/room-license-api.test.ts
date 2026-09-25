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
import { MemorySlidingWindowStore } from "@escaperoom/kit/rate-limit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { consumeGiftCopyRecipientLimit, RATE_LIMIT_POLICIES } from "../src/server/rate-limit";
import { createRoomLicenseHandlers } from "../src/server/rest/room-license";
import type { RoomLicenseService } from "@escaperoom/shared/services";

const quotaServices = vi.hoisted(() => ({ licenses: null as RoomLicenseService | null }));
vi.mock("@/server/services", () => ({ getRoomLicenseService: () => quotaServices.licenses }));
vi.mock("@/server/context", () => ({
  resolveActorFromRequest: async () => ({ userId: "autora", organizationId: null, role: "member" }),
}));

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

/** Sala del fork del receptor creada por un gift-copy sobre ORIGIN (B-10: la respuesta ya no la trae). */
function findFork(store: ReturnType<typeof createInMemoryRoomLicenseStore>, recipientId: string) {
  for (const [id, room] of store.rooms) {
    if (room.forkedFromRoomId === ORIGIN && room.authorId === recipientId) {
      return { id, room };
    }
  }
  return null;
}

describe("POST /api/rooms/:roomId/gift-copy", () => {
  it("202 genérico: draft propio del receptor, equivalente al paquete publicado y con linaje (B-10)", async () => {
    const t = setup();
    const res = await t.gift({ recipientEmail: "creadora@example.test" }, "autora");
    expect(res.status).toBe(202);
    // B-10: la respuesta nunca revela si el destinatario existía ni los datos del fork.
    expect(await res.json()).toEqual({
      message: "Si existe una cuenta con ese email, verá la copia al iniciar sesión.",
    });

    const found = findFork(t.store, creator.userId);
    expect(found).not.toBeNull();
    const { id: roomId, room } = found!;
    expect(room).toMatchObject({
      title: "La Maldición del Rey Aldric",
      status: "draft",
      forkedFromRoomId: ORIGIN,
      forkedFromVersionId: VERSION,
      authorId: creator.userId,
      licensable: false,
    });
    const purchase = t.store.purchases.find((p) => p.resultingRoomId === roomId);
    expect(purchase).toMatchObject({ status: "succeeded", amountCents: 0, roomVersionId: VERSION });

    // `roomDocToPackage` del fork = el paquete publicado (salvo meta.id/authorId del fork).
    const forkPkg = await t.draftPackage(creator, roomId);
    expect(forkPkg).toEqual({
      ...published,
      meta: { ...published.meta, id: roomId, authorId: creator.userId },
    });
    // El asset publicado del original se referencia tal cual (no se copia).
    expect(forkPkg.dialogs[0]!.text.es!.audioUrl).toBe(PUBLISHED_AUDIO);
  });

  it("editar el fork no cambia el original ni su versión publicada, y viceversa", async () => {
    const t = setup();
    // El original tiene su propio draft (sembrado igual que el editor al abrir un paquete).
    await t.draftService.appendUpdate(
      author,
      ORIGIN,
      Y.encodeStateAsUpdate(roomPackageToDoc(published)),
    );
    await t.gift({ recipientEmail: "creadora@example.test" }, "autora");
    const { id: roomId } = findFork(t.store, creator.userId)!;

    await t.edit(creator, roomId, (doc) => doc.getMap("meta").set("title", "Mi versión"));
    await t.edit(author, ORIGIN, (doc) => doc.getMap("meta").set("difficulty", 3));

    const fork = await t.draftPackage(creator, roomId);
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

  it("errores de entrada: JSON roto 400, email no válido 422, propio email 422, repetido 409", async () => {
    const t = setup();
    expect(await errorCode(await t.gift(undefined, "autora", "{"), 400)).toBe("BAD_REQUEST");
    expect(await errorCode(await t.gift({ recipientEmail: "x" }, "autora"), 422)).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await errorCode(await t.gift({ recipientEmail: "autora@example.test" }, "autora"), 422),
    ).toBe("INVALID_RECIPIENT");

    await t.gift({ recipientEmail: "otra@example.test" }, "autora");
    const { id: firstRoomId } = findFork(t.store, other.userId)!;
    const again = await t.gift({ recipientEmail: "otra@example.test" }, "autora");
    expect(again.status).toBe(409);
    const json = (await again.json()) as ErrorJson;
    expect(json.error).toMatchObject({
      code: "LICENSE_ALREADY_OWNED",
      resultingRoomId: firstRoomId,
    });
  });

  // B-10: un destinatario sin cuenta responde EXACTAMENTE igual que uno que sí
  // la tiene — antes 404 RECIPIENT_NOT_FOUND vs 201 dejaba adivinar qué
  // emails están registrados.
  it("B-10: un destinatario sin cuenta responde 202 con el mismo mensaje genérico, sin crear nada", async () => {
    const t = setup();
    const withAccount = await t.gift({ recipientEmail: "creadora@example.test" }, "autora");
    const withoutAccount = await t.gift({ recipientEmail: "nadie@example.test" }, "autora");

    const GENERIC = { message: "Si existe una cuenta con ese email, verá la copia al iniciar sesión." };
    expect(withoutAccount.status).toBe(withAccount.status);
    expect(await withAccount.json()).toEqual(GENERIC);
    expect(await withoutAccount.json()).toEqual(GENERIC);
    expect(findFork(t.store, "nadie@example.test")).toBeNull();
    expect(t.store.purchases).toHaveLength(1); // solo la del destinatario real
  });

  // B-10: cuota por destinatario, sea cual sea el remitente (protege la
  // cuenta objetivo de que la llenen de copias no pedidas).
  it("B-10: agota la cuota del destinatario tras varios regalos, exista o no la cuenta", async () => {
    const t = setup();
    const email = "cuota-test@example.test"; // único en este archivo: aísla el limitador compartido
    let blocked = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await t.gift({ recipientEmail: email }, "autora");
      if (res.status === 429) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe("consumeGiftCopyRecipientLimit (B-10)", () => {
  it("normaliza mayúsculas/espacios: mismo email, misma cuota", async () => {
    const store = new MemorySlidingWindowStore();
    const first = await consumeGiftCopyRecipientLimit("Persona@Example.test", store);
    const second = await consumeGiftCopyRecipientLimit("  persona@example.test  ", store);
    expect(first.ok).toBe(true);
    expect(second.remaining).toBe((first.remaining ?? 1) - 1);
  });

  it("no guarda el email en claro en la clave del store", async () => {
    const seenKeys: string[] = [];
    const store = new MemorySlidingWindowStore();
    const spyingStore = {
      hit: (key: string, limit: number, windowSeconds: number) => {
        seenKeys.push(key);
        return store.hit(key, limit, windowSeconds);
      },
      peek: (key: string, limit: number, windowSeconds: number) => store.peek(key, limit, windowSeconds),
    };
    await consumeGiftCopyRecipientLimit("nadie-en-particular@example.test", spyingStore);
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).not.toContain("nadie-en-particular");
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

// B-10: cuota "gift-copy" por remitente, cableada de verdad en el route.ts.
describe("POST /api/rooms/:roomId/gift-copy — cuota por remitente (route module real)", () => {
  let POST: (request: Request, ctx: { params: Promise<{ roomId: string }> }) => Promise<Response>;

  beforeAll(async () => {
    const drafts = createInMemoryRoomDraftStore([{ id: ORIGIN, authorId: author.userId }]);
    const store = createInMemoryRoomLicenseStore({
      users: [
        { id: author.userId, email: "autora@example.test" },
        { id: creator.userId, email: "creadora@example.test" },
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
        },
      ],
      versions: [{ id: VERSION, roomId: ORIGIN, semver: "1.0.0", package: published }],
      drafts,
    });
    quotaServices.licenses = createRoomLicenseService({
      store,
      buildDoc: (pkg) => roomPackageToDoc(pkg),
      payments: createFakePaymentGateway(),
    });
    ({ POST } = await import("../src/app/api/rooms/[roomId]/gift-copy/route"));
  });

  function req(ip: string): Request {
    return new Request(`http://localhost/api/rooms/${ORIGIN}/gift-copy`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ recipientEmail: "creadora@example.test" }),
    });
  }

  it(`agota alguna cuota (remitente o destinatario) y responde 429`, async () => {
    const ip = "203.0.113.88";
    const ctx = { params: Promise.resolve({ roomId: ORIGIN }) };
    const { limit } = RATE_LIMIT_POLICIES["gift-copy"].ip;
    let blocked = false;
    for (let i = 0; i < limit + 5 && !blocked; i += 1) {
      const res = await POST(req(ip), ctx);
      if (res.status === 429) blocked = true;
    }
    expect(blocked).toBe(true);
  });
});
