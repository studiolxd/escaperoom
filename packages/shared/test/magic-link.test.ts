import { LOCALES } from "@escaperoom/config/locales";
import { describe, expect, it } from "vitest";
import { createMemoryMailTransport } from "../src/mail/transport";
import { renderMagicLinkEmail, sendMagicLinkEmail } from "../src/mail/magic-link";

const URL = "https://app.example.com/api/auth/magic-link/verify?token=abc.def";

describe("renderMagicLinkEmail", () => {
  it("incluye el enlace en texto y HTML en los seis idiomas", () => {
    for (const locale of LOCALES) {
      const email = renderMagicLinkEmail(locale, URL);
      expect(email.text).toContain(URL);
      expect(email.html).toContain(`href="${URL}"`);
      expect(email.html).toContain(`lang="${locale}"`);
      expect(email.subject.length).toBeGreaterThan(0);
    }
  });
});

describe("sendMagicLinkEmail (A-1)", () => {
  it("envía por el transporte con el email y la URL de sesión", async () => {
    const transport = createMemoryMailTransport();
    await sendMagicLinkEmail({ transport }, { email: "ada@example.com", url: URL, locale: "en" });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe("ada@example.com");
    expect(transport.sent[0]?.text).toContain(URL);
  });

  it("A-1: falla en vez de fingir un envío si no hay transporte configurado", async () => {
    // Antes el magic link se imprimía en stdout (console.info) y la promesa
    // se resolvía igual, así que Better Auth respondía "enlace enviado"
    // aunque nadie recibiera nada. Ahora, sin transporte, lanza.
    await expect(
      sendMagicLinkEmail({ transport: null }, { email: "ada@example.com", url: URL }),
    ).rejects.toThrow();
  });

  it("propaga el fallo del transporte (SMTP caído, etc.)", async () => {
    const transport = createMemoryMailTransport();
    transport.failNext();
    await expect(
      sendMagicLinkEmail({ transport }, { email: "ada@example.com", url: URL }),
    ).rejects.toThrow();
  });
});
