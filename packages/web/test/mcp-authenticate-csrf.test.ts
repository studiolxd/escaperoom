import { describe, expect, it, vi } from "vitest";
import { ANONYMOUS_ACTOR, type Actor } from "@escaperoom/shared/services";
import { isSameOriginAsIssuer } from "../src/server/mcp-oauth";

/**
 * A-20/D-6: la identidad de `/mcp/creator` por cookie (sin `Authorization`)
 * exige que la petición venga del propio origen. `isSameOriginAsIssuer` es la
 * comprobación pura; se prueba aquí sin Postgres ni Better Auth.
 */

const services = vi.hoisted(() => ({
  resolveActor: vi.fn(
    async (): Promise<Actor> => ({ userId: "autora", organizationId: null, role: "member" }),
  ),
}));
vi.mock("@escaperoom/shared/db", () => ({ prisma: { verification: {} } }));
vi.mock("@/server/context", () => ({
  resolveActorFromRequest: services.resolveActor,
  resolveBrowserActorFromRequest: services.resolveActor,
}));

describe("isSameOriginAsIssuer (A-20/D-6)", () => {
  const ISSUER = "https://escaperoom.example";
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost/mcp/creator", { headers });

  it("acepta con Origin igual al issuer", () => {
    expect(isSameOriginAsIssuer(req({ origin: ISSUER }), ISSUER)).toBe(true);
  });

  it("rechaza con Origin de otro sitio, aunque Sec-Fetch-Site diga same-origin (Origin manda)", () => {
    expect(
      isSameOriginAsIssuer(
        req({ origin: "https://atacante.example", "sec-fetch-site": "same-origin" }),
        ISSUER,
      ),
    ).toBe(false);
  });

  it("sin Origin, acepta con Sec-Fetch-Site: same-origin", () => {
    expect(isSameOriginAsIssuer(req({ "sec-fetch-site": "same-origin" }), ISSUER)).toBe(true);
  });

  it("sin ninguna cabecera, rechaza (antes esto pasaba sin más)", () => {
    expect(isSameOriginAsIssuer(req({}), ISSUER)).toBe(false);
  });

  it("sin Origin y con Sec-Fetch-Site cross-site, rechaza", () => {
    expect(isSameOriginAsIssuer(req({ "sec-fetch-site": "cross-site" }), ISSUER)).toBe(false);
  });
});

describe("authenticateMcpRequest (A-20/D-6, integración con mocks)", () => {
  it("sin Authorization ni Origin/Sec-Fetch-Site same-origin, no llega a resolver la cookie de sesión", async () => {
    const { authenticateMcpRequest } = await import("../src/server/mcp-oauth");
    const request = new Request("http://localhost/mcp/creator", {
      headers: { cookie: "better-auth.session=abc" },
    });
    const actor = await authenticateMcpRequest(request);
    expect(actor).toBeNull();
    expect(services.resolveActor).not.toHaveBeenCalled();
  });

  it("sin Authorization pero con Sec-Fetch-Site: same-origin, resuelve la cookie de sesión", async () => {
    const { authenticateMcpRequest } = await import("../src/server/mcp-oauth");
    const request = new Request("http://localhost/mcp/creator", {
      headers: { cookie: "better-auth.session=abc", "sec-fetch-site": "same-origin" },
    });
    const actor = await authenticateMcpRequest(request);
    expect(actor).not.toBeNull();
    expect(actor).not.toEqual(ANONYMOUS_ACTOR);
  });
});
