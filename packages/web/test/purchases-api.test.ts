import {
  ANONYMOUS_ACTOR,
  createFakePaymentGateway,
  createInMemoryPurchaseStore,
  createPurchaseService,
  type Actor,
  type PurchaseRoomRef,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createPurchaseHandlers } from "../src/server/rest/purchases";

const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };
const admin: Actor = { userId: "admin", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const ROOM = "20000000-0000-4000-8000-000000000001";
const VERSION = "10000000-0000-4000-8000-000000000001";

type PurchaseJson = { id: string; status: string; amountCents: number };
type CheckoutJson = { purchase: PurchaseJson; checkoutUrl: string };
type ErrorJson = { error: { code: string; message: string } };

function setup(room: Partial<PurchaseRoomRef> = {}) {
  const store = createInMemoryPurchaseStore({
    adminIds: [admin.userId],
    rooms: [
      {
        id: ROOM,
        authorId: "autora",
        title: "La Maldición del Rey Aldric",
        status: "published",
        saleIndividual: true,
        priceCents: 299,
        currency: "EUR",
        ...room,
      },
    ],
    versions: [{ id: VERSION, roomId: ROOM }],
  });
  const payments = createFakePaymentGateway();
  const purchases = createPurchaseService({ store, payments });
  const actors: Record<string, Actor> = { compradora: buyer, admin, otra: other };
  const handlers = createPurchaseHandlers({
    purchases,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
    buildUrls: () => ({ successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" }),
  });
  const checkout = (body: unknown, user?: string) =>
    handlers.postRoomCheckout(
      new Request("http://localhost/api/purchases/room-checkout", {
        method: "POST",
        headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const get = (id: string, user?: string) =>
    handlers.getPurchase(
      new Request(`http://localhost/api/purchases/${id}`, {
        headers: user ? { "x-test-user": user } : {},
      }),
      { params: Promise.resolve({ id }) },
    );
  return { store, purchases, checkout, get };
}

describe("POST /api/purchases/room-checkout", () => {
  it("401 sin sesión", async () => {
    const { checkout } = setup();
    const res = await checkout({ roomVersionId: VERSION });
    expect(res.status).toBe(401);
  });

  it("200 con la compra pendiente y la URL de Stripe", async () => {
    const { checkout } = setup();
    const res = await checkout({ roomVersionId: VERSION }, "compradora");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckoutJson;
    expect(body.purchase.status).toBe("pending");
    expect(body.purchase.amountCents).toBe(299);
    expect(body.checkoutUrl).toContain("checkout.example.test");
  });

  it("422 VALIDATION_ERROR con un roomVersionId inválido", async () => {
    const { checkout } = setup();
    const res = await checkout({ roomVersionId: "no-es-un-uuid" }, "compradora");
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("422 SALE_INDIVIDUAL_DISABLED si la sala no está a la venta individual", async () => {
    const { checkout } = setup({ saleIndividual: false });
    const res = await checkout({ roomVersionId: VERSION }, "compradora");
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe("SALE_INDIVIDUAL_DISABLED");
  });
});

describe("GET /api/purchases/:id", () => {
  it("200 para el comprador y un admin, 403 para un tercero, 404 si no existe", async () => {
    const { checkout, get } = setup();
    const created = (await (await checkout({ roomVersionId: VERSION }, "compradora")).json()) as CheckoutJson;

    const asBuyer = await get(created.purchase.id, "compradora");
    expect(asBuyer.status).toBe(200);

    const asAdmin = await get(created.purchase.id, "admin");
    expect(asAdmin.status).toBe(200);

    const asOther = await get(created.purchase.id, "otra");
    expect(asOther.status).toBe(403);

    const missing = await get("20000000-0000-4000-8000-000000000099", "compradora");
    expect(missing.status).toBe(404);
  });
});
