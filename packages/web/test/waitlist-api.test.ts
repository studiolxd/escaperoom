import { createInMemoryWaitlistStore, createWaitlistService } from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createWaitlistHandler } from "../src/server/rest/waitlist";

function request(body: unknown) {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/waitlist (ticket 6.7)", () => {
  it("crea el alta y responde 201", async () => {
    const handler = createWaitlistHandler({
      waitlist: createWaitlistService({ store: createInMemoryWaitlistStore() }),
    });
    const res = await handler.postJoin(request({ email: "ada@example.com", locale: "en" }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; created: boolean };
    expect(json).toEqual({ ok: true, created: true });
  });

  it("es idempotente: repetir el email responde 200", async () => {
    const service = createWaitlistService({ store: createInMemoryWaitlistStore() });
    const handler = createWaitlistHandler({ waitlist: service });
    await handler.postJoin(request({ email: "ada@example.com" }));
    const res = await handler.postJoin(request({ email: "ADA@example.com" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as { created: boolean }).toEqual({ ok: true, created: false });
  });

  it("rechaza un email inválido con 400", async () => {
    const handler = createWaitlistHandler({
      waitlist: createWaitlistService({ store: createInMemoryWaitlistStore() }),
    });
    const res = await handler.postJoin(request({ email: "no-es-un-email" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("rechaza un cuerpo que no es JSON con 400", async () => {
    const handler = createWaitlistHandler({
      waitlist: createWaitlistService({ store: createInMemoryWaitlistStore() }),
    });
    const res = await handler.postJoin(
      new Request("http://localhost/api/waitlist", { method: "POST", body: "no-json" }),
    );
    expect(res.status).toBe(400);
  });
});
