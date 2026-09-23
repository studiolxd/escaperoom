import { createMemoryMailTransport } from "@escaperoom/shared/mail";
import { createContactService } from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createContactHandler } from "../src/server/rest/contact";

function request(body: unknown): Request {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contact", () => {
  it("envía el mensaje y responde 200 con ok:true", async () => {
    const transport = createMemoryMailTransport();
    const contact = createContactService({ transport, to: "hello@studiolxd.com" });
    const handler = createContactHandler({ contact });

    const response = await handler(
      request({ name: "Ada", email: "ada@example.com", message: "Hola" }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; messageId: string };
    expect(json.ok).toBe(true);
    expect(json.messageId).toBeTruthy();
    expect(transport.sent).toHaveLength(1);
  });

  it("responde 422 con datos inválidos", async () => {
    const transport = createMemoryMailTransport();
    const contact = createContactService({ transport, to: "hello@studiolxd.com" });
    const handler = createContactHandler({ contact });

    const response = await handler(request({ name: "", email: "x", message: "" }));

    expect(response.status).toBe(422);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(transport.sent).toHaveLength(0);
  });

  it("responde 503 cuando el email no está configurado", async () => {
    const handler = createContactHandler({ contact: null });

    const response = await handler(
      request({ name: "Ada", email: "ada@example.com", message: "Hola" }),
    );

    expect(response.status).toBe(503);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("DELIVERY_UNAVAILABLE");
  });

  it("responde 400 con un cuerpo que no es JSON", async () => {
    const transport = createMemoryMailTransport();
    const contact = createContactService({ transport, to: "hello@studiolxd.com" });
    const handler = createContactHandler({ contact });

    const response = await handler(
      new Request("http://localhost/api/contact", { method: "POST", body: "no-es-json" }),
    );

    expect(response.status).toBe(400);
  });
});
