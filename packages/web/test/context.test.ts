import { describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

/**
 * A-10 (sesión resuelta una sola vez por petición) y A-11 (un fallo de
 * infraestructura no se disfraza de "sin sesión") de la auditoría 2026-09-24.
 */
describe("context: resolveActorFromHeaders/resolveActorFromRequest", () => {
  it("sin sesión (auth.api.getSession devuelve null) resuelve el actor anónimo, sin lanzar", async () => {
    getSession.mockReset().mockResolvedValueOnce(null);
    const { resolveActorFromHeaders } = await import("../src/server/context");
    const actor = await resolveActorFromHeaders(new Headers());
    expect(actor.role).toBe("anonymous");
  });

  it("A-11: un fallo de infraestructura se propaga (no se trata como anónimo)", async () => {
    getSession.mockReset().mockRejectedValueOnce(new Error("Postgres caído"));
    const { resolveActorFromHeaders } = await import("../src/server/context");
    await expect(resolveActorFromHeaders(new Headers())).rejects.toThrow("Postgres caído");
  });

  it("A-10: resolveActorFromRequest resuelve la sesión una sola vez por Request, se llame las veces que se llame", async () => {
    getSession.mockReset().mockResolvedValueOnce({
      user: { id: "u1" },
      session: { activeOrganizationId: null },
    });
    const { resolveActorFromRequest } = await import("../src/server/context");
    const request = new Request("http://localhost/api/x", { headers: { cookie: "a=b" } });

    const [first, second] = await Promise.all([
      resolveActorFromRequest(request),
      resolveActorFromRequest(request),
    ]);

    expect(first).toEqual(second);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("A-10: dos Request distintas sí resuelven sesión cada una (sin fuga entre peticiones)", async () => {
    getSession.mockReset();
    getSession.mockResolvedValueOnce({ user: { id: "u1" }, session: { activeOrganizationId: null } });
    getSession.mockResolvedValueOnce({ user: { id: "u2" }, session: { activeOrganizationId: null } });
    const { resolveActorFromRequest } = await import("../src/server/context");

    const a = await resolveActorFromRequest(new Request("http://localhost/api/x"));
    const b = await resolveActorFromRequest(new Request("http://localhost/api/x"));

    expect(a.userId).toBe("u1");
    expect(b.userId).toBe("u2");
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
