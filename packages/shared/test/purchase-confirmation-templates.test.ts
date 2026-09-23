// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LOCALES } from "@escaperoom/config/locales";
import {
  PURCHASE_CONFIRMATION_KINDS,
  renderPurchaseConfirmationEmail,
} from "../src/mail/purchase-confirmation-templates";

const TERMS_URL = "https://app.example.com/es/legal/terms";

describe("plantilla de confirmación de compra", () => {
  it("renderiza los tres tipos en los seis idiomas, cada uno con el título, el importe y el enlace a términos", () => {
    const subjects = new Set<string>();
    for (const locale of LOCALES) {
      for (const kind of PURCHASE_CONFIRMATION_KINDS) {
        const email = renderPurchaseConfirmationEmail({
          locale,
          kind,
          itemTitle: "El Rey Aldric",
          amountCents: 1999,
          currency: "EUR",
          players: kind === "event_credits" ? 12 : null,
          termsUrl: TERMS_URL,
        });
        expect(email.text).toContain("El Rey Aldric");
        expect(email.html).toContain("El Rey Aldric");
        expect(email.text).toContain(TERMS_URL);
        expect(email.html).toContain(TERMS_URL);
        expect(email.html).toContain(`lang="${locale}"`);
        subjects.add(email.subject);
      }
    }
    // Ningún idioma/tipo reutiliza el asunto de otro.
    expect(subjects.size).toBe(LOCALES.length * PURCHASE_CONFIRMATION_KINDS.length);
  });

  it("incluye la renuncia al desistimiento (art. 103.m LGDCU) en los tres tipos", () => {
    for (const kind of PURCHASE_CONFIRMATION_KINDS) {
      const email = renderPurchaseConfirmationEmail({
        locale: "es",
        kind,
        itemTitle: "Sala",
        amountCents: 500,
        currency: "EUR",
        players: null,
        termsUrl: TERMS_URL,
      });
      expect(email.text).toContain("103.m)");
      expect(email.text).toContain("desistimiento");
    }
  });

  it("event_credits muestra el aforo comprado; room y room_license no", () => {
    const withPlayers = renderPurchaseConfirmationEmail({
      locale: "es",
      kind: "event_credits",
      itemTitle: "Jornada",
      amountCents: 1000,
      currency: "EUR",
      players: 25,
      termsUrl: TERMS_URL,
    });
    expect(withPlayers.text).toContain("25");

    const room = renderPurchaseConfirmationEmail({
      locale: "es",
      kind: "room",
      itemTitle: "Sala",
      amountCents: 500,
      currency: "EUR",
      players: 25,
      termsUrl: TERMS_URL,
    });
    expect(room.text).not.toContain("Aforo comprado");
  });

  it("formatea el importe en la moneda dada y escapa el HTML del título", () => {
    const email = renderPurchaseConfirmationEmail({
      locale: "es",
      kind: "room",
      itemTitle: "<img src=x onerror=alert(1)>",
      amountCents: 2599,
      currency: "EUR",
      players: null,
      termsUrl: TERMS_URL,
    });
    expect(email.text).toContain("25,99");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
  });

  it("el asunto no lleva saltos de línea aunque el título los tenga", () => {
    const email = renderPurchaseConfirmationEmail({
      locale: "en",
      kind: "room_license",
      itemTitle: "Evil\r\nBcc: x@y.z",
      amountCents: 100,
      currency: "EUR",
      players: null,
      termsUrl: TERMS_URL,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
