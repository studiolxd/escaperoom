// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryMailTransport } from "@escaperoom/shared/mail";
import { createContactService } from "@escaperoom/shared/services";

const mocks = vi.hoisted(() => ({
  consumeActionRateLimit: vi.fn(),
  getContactService: vi.fn(),
}));

vi.mock("@/server/actions/action-result", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeActionRateLimit: mocks.consumeActionRateLimit,
}));
vi.mock("@/server/services", () => ({ getContactService: mocks.getContactService }));

const VALID = { name: "Ada", email: "ada@example.com", message: "Hola, ¿cómo estáis?" };

describe("sendContactMessage (server action)", () => {
  beforeEach(() => {
    mocks.consumeActionRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
    mocks.getContactService.mockReset();
  });

  it("envía el mensaje y devuelve ok:true con el messageId", async () => {
    const transport = createMemoryMailTransport();
    mocks.getContactService.mockReturnValue(
      createContactService({ transport, to: "hello@studiolxd.com" }),
    );
    const { sendContactMessage } = await import("@/actions/contact");

    const result = await sendContactMessage(VALID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.messageId).toBeTruthy();
    expect(transport.sent).toHaveLength(1);
  });

  it("rechaza datos inválidos con VALIDATION_ERROR e issues por campo, sin enviar", async () => {
    const transport = createMemoryMailTransport();
    mocks.getContactService.mockReturnValue(
      createContactService({ transport, to: "hello@studiolxd.com" }),
    );
    const { sendContactMessage } = await import("@/actions/contact");

    const result = await sendContactMessage({ name: "", email: "x", message: "" } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.issues?.length).toBeGreaterThan(0);
    }
    expect(transport.sent).toHaveLength(0);
  });

  it("devuelve DELIVERY_UNAVAILABLE cuando el email no está configurado", async () => {
    mocks.getContactService.mockReturnValue(null);
    const { sendContactMessage } = await import("@/actions/contact");

    const result = await sendContactMessage(VALID);

    expect(result).toEqual({
      ok: false,
      error: { code: "DELIVERY_UNAVAILABLE", message: expect.any(String) },
    });
  });

  it("respeta el rate limit `contact-write`: RATE_LIMITED sin llamar al servicio", async () => {
    mocks.consumeActionRateLimit.mockResolvedValue({ ok: false, retryAfter: 30 });
    const transport = createMemoryMailTransport();
    const service = createContactService({ transport, to: "hello@studiolxd.com" });
    mocks.getContactService.mockReturnValue(service);
    const { sendContactMessage } = await import("@/actions/contact");

    const result = await sendContactMessage(VALID);

    expect(result).toEqual({ ok: false, error: { code: "RATE_LIMITED", message: expect.any(String) } });
    expect(mocks.consumeActionRateLimit).toHaveBeenCalledWith("contact-write");
    expect(transport.sent).toHaveLength(0);
  });
});
