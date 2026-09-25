import { describe, expect, it } from "vitest";
import {
  createFakeConnectGateway,
  createFakePaymentGateway,
  createInMemoryCreatorPayoutStore,
  processCreatorPayouts,
  type PendingCreatorPayout,
} from "../src/services";

/**
 * B-9: el reparto a creadores ya no se intenta en el camino crítico del
 * webhook (`confirmRoomCheckout`/`confirmLicensePayment`), sino en este
 * barrido periódico. Estas pruebas cubren su lógica de reintento: sin cuenta
 * conectada o con el onboarding incompleto se salta (se reintenta en el
 * siguiente barrido); con la cuenta lista, transfiere y lo persiste.
 */

const payout = (over: Partial<PendingCreatorPayout> = {}): PendingCreatorPayout => ({
  purchaseId: "purchase-1",
  purchaseType: "room",
  amountCents: 209,
  currency: "EUR",
  paymentIntentId: "pi_1",
  roomVersionId: "version-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

describe("creator payouts (B-9)", () => {
  it("transfiere y persiste stripeTransferId cuando la cuenta está completa", async () => {
    const store = createInMemoryCreatorPayoutStore({
      payouts: [payout()],
      accounts: { "version-1": "acct_1" },
    });
    const connect = createFakeConnectGateway();
    connect.accounts.set("acct_1", "complete");
    const payments = createFakePaymentGateway();

    const result = await processCreatorPayouts({ store, connect, payments });
    expect(result).toEqual({ attempted: 1, transferred: 1, skipped: 0, failed: 0 });
    expect(store.transferred.get("purchase-1")).toBe("fake_tr_1");
    expect(payments.transferCalls).toEqual([
      {
        purchaseId: "purchase-1",
        amountCents: 209,
        currency: "EUR",
        destinationAccountId: "acct_1",
        paymentIntentId: "pi_1",
      },
    ]);
  });

  it("se salta (sin transferir) si el creador no tiene cuenta conectada", async () => {
    const store = createInMemoryCreatorPayoutStore({ payouts: [payout()] });
    const result = await processCreatorPayouts({
      store,
      connect: createFakeConnectGateway(),
      payments: createFakePaymentGateway(),
    });
    expect(result).toEqual({ attempted: 1, transferred: 0, skipped: 1, failed: 0 });
    expect(store.transferred.size).toBe(0);
  });

  it("se salta (sin transferir) si el onboarding de Connect no está completo", async () => {
    const store = createInMemoryCreatorPayoutStore({
      payouts: [payout()],
      accounts: { "version-1": "acct_1" },
    });
    const connect = createFakeConnectGateway();
    connect.accounts.set("acct_1", "pending"); // onboarding a medias
    const result = await processCreatorPayouts({ store, connect, payments: createFakePaymentGateway() });
    expect(result).toEqual({ attempted: 1, transferred: 0, skipped: 1, failed: 0 });
  });

  it("un fallo de createTransfer no tumba el barrido: se cuenta como failed y sigue con el resto", async () => {
    const store = createInMemoryCreatorPayoutStore({
      payouts: [payout({ purchaseId: "p-fail" }), payout({ purchaseId: "p-ok", roomVersionId: "version-2" })],
      accounts: { "version-1": "acct_1", "version-2": "acct_2" },
    });
    const connect = createFakeConnectGateway();
    connect.accounts.set("acct_1", "complete");
    connect.accounts.set("acct_2", "complete");
    const payments = createFakePaymentGateway();
    const originalCreateTransfer = payments.createTransfer.bind(payments);
    payments.createTransfer = async (input) => {
      if (input.purchaseId === "p-fail") throw new Error("Stripe caído");
      return originalCreateTransfer(input);
    };

    const result = await processCreatorPayouts({ store, connect, payments });
    expect(result).toEqual({ attempted: 2, transferred: 1, skipped: 0, failed: 1 });
    expect(store.transferred.has("p-ok")).toBe(true);
    expect(store.transferred.has("p-fail")).toBe(false);
  });

  it("B-9 (revisión de PR #135): una compra pagable se procesa aunque haya más de 'limit' compras bloqueadas por delante", async () => {
    // 5 compras "bloqueadas" (creador sin cuenta conectada), todas más
    // antiguas que la pagable, y `limit: 3` — con el bug (orden por
    // `createdAt` sin más), las 3 primeras del barrido serían siempre las
    // mismas 3 bloqueadas: la pagable nunca entraría en la ventana.
    const blocked = Array.from({ length: 5 }, (_, i) =>
      payout({
        purchaseId: `blocked-${i}`,
        roomVersionId: `blocked-version-${i}`,
        createdAt: new Date(2026, 0, 1 + i),
      }),
    );
    const payable = payout({
      purchaseId: "payable",
      roomVersionId: "version-payable",
      createdAt: new Date(2026, 0, 10),
    });
    const store = createInMemoryCreatorPayoutStore({
      payouts: [...blocked, payable],
      accounts: { "version-payable": "acct_payable" },
    });
    const connect = createFakeConnectGateway();
    connect.accounts.set("acct_payable", "complete");
    const payments = createFakePaymentGateway();

    // Primer barrido: las 3 más antiguas (todas bloqueadas) agotan el `limit`.
    const first = await processCreatorPayouts({ store, connect, payments }, { limit: 3 });
    expect(first).toEqual({ attempted: 3, transferred: 0, skipped: 3, failed: 0 });
    expect(store.transferred.size).toBe(0);

    // Sin el `payoutAttemptAt`, un segundo barrido volvería a coger las
    // mismas 3 (siguen siendo las más antiguas por `createdAt`) y la pagable
    // seguiría sin intentarse jamás. Con `payoutAttemptAt`, esas 3 ya
    // intentadas rotan al fondo: el segundo barrido coge las 2 bloqueadas
    // restantes + la pagable, y esta SÍ se transfiere.
    const second = await processCreatorPayouts({ store, connect, payments }, { limit: 3 });
    expect(second.transferred).toBe(1);
    expect(store.transferred.has("payable")).toBe(true);
  });
});
