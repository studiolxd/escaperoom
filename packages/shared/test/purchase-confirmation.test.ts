// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMemoryMailTransport } from "../src/mail";
import {
  createInMemoryPurchaseConfirmationStore,
  deliverPurchaseConfirmationEmail,
  type PurchaseConfirmationDetails,
} from "../src/services/purchase-confirmation";

const APP_URL = "https://app.example.com";

const roomDetails: PurchaseConfirmationDetails = {
  email: "jugadora@example.com",
  locale: "es",
  itemTitle: "El Rey Aldric",
  amountCents: 1999,
  currency: "EUR",
  players: null,
};

const eventDetails: PurchaseConfirmationDetails = {
  email: "organizador@example.com",
  locale: "en",
  itemTitle: "Jornada escolar",
  amountCents: 5000,
  currency: "EUR",
  players: 25,
};

describe("entrega del email de confirmación de compra (specs/18 §3-4)", () => {
  it("envía la confirmación de una compra de sala con el título, el importe y el enlace a términos en el idioma del comprador", async () => {
    const store = createInMemoryPurchaseConfirmationStore({ "room:p1": roomDetails });
    const transport = createMemoryMailTransport();
    const result = await deliverPurchaseConfirmationEmail(
      { store, transport, appUrl: APP_URL },
      { kind: "room", purchaseId: "p1" },
    );
    expect(result.status).toBe("sent");
    expect(transport.sent).toHaveLength(1);
    const mail = transport.sent[0]!;
    expect(mail.to).toBe("jugadora@example.com");
    expect(mail.text).toContain("El Rey Aldric");
    expect(mail.text).toContain(`${APP_URL}/es/legal/terms`);
  });

  it("envía la confirmación de créditos de evento con el aforo comprado, en el idioma del organizador", async () => {
    const store = createInMemoryPurchaseConfirmationStore({ "event_credits:e1": eventDetails });
    const transport = createMemoryMailTransport();
    const result = await deliverPurchaseConfirmationEmail(
      { store, transport, appUrl: APP_URL },
      { kind: "event_credits", eventId: "e1" },
    );
    expect(result.status).toBe("sent");
    expect(transport.sent[0]!.text).toContain("25");
    expect(transport.sent[0]!.text).toContain(`${APP_URL}/en/legal/terms`);
  });

  it("compra ya no encontrada (reembolsada o inexistente): omite el envío sin lanzar", async () => {
    const store = createInMemoryPurchaseConfirmationStore({});
    const transport = createMemoryMailTransport();
    const result = await deliverPurchaseConfirmationEmail(
      { store, transport, appUrl: APP_URL },
      { kind: "room_license", purchaseId: "no-existe" },
    );
    expect(result).toEqual({ status: "skipped", reason: "NOT_FOUND" });
    expect(transport.sent).toHaveLength(0);
  });

  it("fallo del transporte se propaga (BullMQ reintenta el job)", async () => {
    const store = createInMemoryPurchaseConfirmationStore({ "room:p2": roomDetails });
    const transport = createMemoryMailTransport();
    transport.failNext();
    await expect(
      deliverPurchaseConfirmationEmail(
        { store, transport, appUrl: APP_URL },
        { kind: "room", purchaseId: "p2" },
      ),
    ).rejects.toThrow();
  });
});
