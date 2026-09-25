import { request as httpRequest } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_ENDPOINT, startHttpServer, type RunningHttpServer } from "../src";
import { AUTHOR, createTestDeps } from "./fixtures/drafts";
import { toolsetContract } from "./fixtures/toolset-contract";

/** Cabecera de TEST que hace de sesión (en web: Better Auth; en 4.7: OAuth). */
const TEST_USER_HEADER = "x-test-user";

describe("transporte HTTP streamable", () => {
  let http: RunningHttpServer;
  let client: Client;

  beforeAll(async () => {
    http = await startHttpServer({
      port: 0,
      authenticate: async (request) => {
        const userId = request.headers.get(TEST_USER_HEADER);
        return userId ? { userId, organizationId: null, role: "member" } : null;
      },
      createDeps: () => deps,
    });
    const deps = await createTestDeps(null);
    client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(http.url, {
        requestInit: { headers: { [TEST_USER_HEADER]: AUTHOR.userId } },
      }),
    );
  });
  afterAll(async () => {
    await client?.close();
    await http?.close();
  });

  it("escucha en un puerto libre en /mcp/creator", () => {
    expect(http.url.pathname).toBe(MCP_ENDPOINT);
    expect(Number(http.url.port)).toBeGreaterThan(0);
  });

  toolsetContract(() => client);

  it("sin identidad responde 401 con WWW-Authenticate (enganche de OAuth, 4.7)", async () => {
    const response = await fetch(http.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);

    const anonymous = new Client({ name: "http-anon", version: "0.0.0" });
    await expect(anonymous.connect(new StreamableHTTPClientTransport(http.url))).rejects.toThrow();
  });

  // A-20/D-6: sin enableDnsRebindingProtection/allowedHosts, una petición con
  // el `Host` de otro dominio (DNS rebinding) llegaba igual al servidor.
  // `fetch()` no deja sobrescribir `Host` (lo fija por la URL); se usa
  // `node:http` directo, como haría un atacante que controla el DNS.
  it("rechaza una petición con un Host distinto del propio (protección DNS rebinding)", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: http.url.hostname,
          port: http.url.port,
          path: http.url.pathname,
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            [TEST_USER_HEADER]: AUTHOR.userId,
            host: "atacante.example",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    });
    expect(status).toBe(403);
  });
});
