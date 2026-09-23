import { describe, expect, it } from "vitest";
import { createMemoryMailTransport } from "../src/mail/transport";
import { ContactError, createContactService } from "../src/services/contact";

describe("createContactService", () => {
  it("envía el email al buzón de la empresa con Reply-To de quien escribe", async () => {
    const transport = createMemoryMailTransport();
    const service = createContactService({ transport, to: "hello@studiolxd.com" });

    const result = await service.submit({
      name: "Ada",
      email: "ada@example.com",
      message: "Hola, tengo una duda.",
    });

    expect(result.messageId).toBeTruthy();
    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0]!;
    expect(sent.to).toBe("hello@studiolxd.com");
    expect(sent.headers?.["Reply-To"]).toBe("ada@example.com");
    expect(sent.subject).toContain("Ada");
    expect(sent.text).toContain("ada@example.com");
    expect(sent.text).toContain("Hola, tengo una duda.");
  });

  it("rechaza datos inválidos sin llamar al transporte", async () => {
    const transport = createMemoryMailTransport();
    const service = createContactService({ transport, to: "hello@studiolxd.com" });

    await expect(
      service.submit({ name: "", email: "no-es-un-email", message: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(transport.sent).toHaveLength(0);
  });

  it("rechaza campos desconocidos (esquema estricto)", async () => {
    const transport = createMemoryMailTransport();
    const service = createContactService({ transport, to: "hello@studiolxd.com" });

    await expect(
      service.submit({
        name: "Ada",
        email: "ada@example.com",
        message: "Hola",
        honeypot: "spam",
      }),
    ).rejects.toBeInstanceOf(ContactError);
  });

  it("propaga un fallo del transporte como DELIVERY_FAILED", async () => {
    const transport = createMemoryMailTransport();
    transport.failNext();
    const service = createContactService({ transport, to: "hello@studiolxd.com" });

    await expect(
      service.submit({ name: "Ada", email: "ada@example.com", message: "Hola" }),
    ).rejects.toMatchObject({ code: "DELIVERY_FAILED" });
  });
});
