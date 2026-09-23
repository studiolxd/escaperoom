import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  authenticateOAuthBearer,
  createOAuthProvider,
  createRateLimiter,
  handleCreatorMcpRequest,
  MCP_ENDPOINT,
} from "@escaperoom/mcp-server";
import {
  ANONYMOUS_ACTOR,
  createCatalogService,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createPrismaOAuthStore, type VerificationDelegate } from "../src/server/mcp-oauth-store";
import { createMcpOAuthHandlers } from "../src/server/rest/mcp-oauth";

const ORIGIN = "http://localhost:3000";
const REDIRECT_URI = "http://127.0.0.1:7777/callback";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_ROOM_ID = "33333333-3333-4333-8333-333333333333";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };

/** Delegado `verification` de Prisma en memoria (misma semántica que el usado por el store). */
function fakeVerification() {
  const rows: Array<{
    id: string;
    identifier: string;
    value: string;
    expiresAt: Date;
    createdAt: Date;
  }> = [];
  const delegate: VerificationDelegate = {
    async findFirst({ where }) {
      const matches = rows
        .filter((r) => r.identifier === where.identifier && r.expiresAt > where.expiresAt.gt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return matches[0] ?? null;
    },
    async create({ data }) {
      rows.push({ ...data, createdAt: new Date() });
      return data;
    },
    async deleteMany({ where }) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        if ("id" in where ? row.id === where.id : row.identifier === where.identifier) {
          rows.splice(i, 1);
        }
      }
      return { count: before - rows.length };
    },
  };
  return { rows, delegate };
}

function setup() {
  const { rows, delegate } = fakeVerification();
  const provider = createOAuthProvider({
    store: createPrismaOAuthStore(delegate),
    issuer: ORIGIN,
    resource: new URL(MCP_ENDPOINT, ORIGIN),
  });
  const sessions: Record<string, Actor> = { autora: author };
  const handlers = createMcpOAuthHandlers({
    provider: () => provider,
    resolveActor: async (req) =>
      sessions[req.headers.get("x-test-session") ?? ""] ?? ANONYMOUS_ACTOR,
    registerLimiter: createRateLimiter({ limit: 2, windowSeconds: 3600 }),
  });
  return { rows, provider, handlers };
}

async function register(handlers: ReturnType<typeof setup>["handlers"]) {
  const response = await handlers.register(
    new Request(`${ORIGIN}/api/mcp/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: JSON.stringify({ client_name: "Claude de test", redirect_uris: [REDIRECT_URI] }),
    }),
  );
  expect(response.status).toBe(201);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  return ((await response.json()) as { client_id: string }).client_id;
}

function pkce() {
  const verifier = randomBytes(40).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeParams(clientId: string, challenge: string) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: `${ORIGIN}${MCP_ENDPOINT}`,
  });
}

/** POST del formulario de consentimiento. */
function decide(
  handlers: ReturnType<typeof setup>["handlers"],
  params: URLSearchParams,
  opts: { decision?: string; session?: string; origin?: string | null } = {},
) {
  const body = new URLSearchParams(params);
  body.set("decision", opts.decision ?? "approve");
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.session) headers["x-test-session"] = opts.session;
  return handlers.decide(
    new Request(`${ORIGIN}/api/mcp/oauth/authorize`, { method: "POST", headers, body }),
  );
}

describe("OAuth del MCP en la web (4.7)", () => {
  it("metadata del servidor de autorización y del recurso protegido", async () => {
    const { handlers } = setup();
    const as = await handlers
      .authorizationServerMetadata(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))
      .json();
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/api/mcp/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/mcp/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/mcp/oauth/register`,
      code_challenge_methods_supported: ["S256"],
    });
    const resource = await handlers
      .protectedResourceMetadata(
        new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp/creator`),
      )
      .json();
    expect(resource).toMatchObject({
      resource: `${ORIGIN}/mcp/creator`,
      authorization_servers: [ORIGIN],
    });
  });

  it("GET authorize lleva a la pantalla de consentimiento en el idioma del usuario", async () => {
    const { handlers } = setup();
    const clientId = await register(handlers);
    const params = authorizeParams(clientId, pkce().challenge);
    const url = `${ORIGIN}/api/mcp/oauth/authorize?${params}`;

    const byDefault = await handlers.authorize(new Request(url));
    expect(byDefault.status).toBe(302);
    const location = new URL(byDefault.headers.get("location")!);
    expect(location.pathname).toBe("/es/oauth/consent");
    expect(location.searchParams.get("client_id")).toBe(clientId);

    const english = await handlers.authorize(
      new Request(url, { headers: { cookie: "NEXT_LOCALE=en" } }),
    );
    expect(new URL(english.headers.get("location")!).pathname).toBe("/en/oauth/consent");

    // Sin PKCE: error devuelto al cliente, sin pasar por el consentimiento.
    params.delete("code_challenge");
    const noPkce = await handlers.authorize(
      new Request(`${ORIGIN}/api/mcp/oauth/authorize?${params}`),
    );
    const back = new URL(noPkce.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT_URI);
    expect(back.searchParams.get("error")).toBe("invalid_request");
  });

  it("consentimiento → código → token (PKCE) que abre /mcp/creator solo sobre sus drafts", async () => {
    const { handlers, provider, rows } = setup();
    const clientId = await register(handlers);
    const { verifier, challenge } = pkce();
    const approved = await decide(handlers, authorizeParams(clientId, challenge), {
      session: "autora",
    });
    expect(approved.status).toBe(303);
    const back = new URL(approved.headers.get("location")!);
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;
    expect(code).toBeTruthy();

    const tokenResponse = await handlers.token(
      new Request(`${ORIGIN}/api/mcp/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          resource: `${ORIGIN}${MCP_ENDPOINT}`,
        }),
      }),
    );
    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.headers.get("cache-control")).toBe("no-store");
    const tokens = (await tokenResponse.json()) as { access_token: string };

    // En `verification` solo hay hashes: ni el código ni el token en claro.
    expect(rows.every((r) => r.identifier.startsWith("mcp-oauth:"))).toBe(true);
    expect(rows.some((r) => r.identifier.includes(tokens.access_token))).toBe(false);
    expect(rows.some((r) => r.value.includes(tokens.access_token))).toBe(false);

    const store = createInMemoryRoomDraftStore([
      { id: ROOM_ID, authorId: author.userId },
      { id: FOREIGN_ROOM_ID, authorId: "otra-persona" },
    ]);
    const mcp = (roomId: string, token: string | null) =>
      handleCreatorMcpRequest(
        new Request(`${ORIGIN}${MCP_ENDPOINT}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "get_room_graph", arguments: { roomId } },
          }),
        }),
        {
          authenticate: (req) => authenticateOAuthBearer(provider, req),
          resourceMetadataUrl: provider.protectedResourceMetadataUrl,
          createDeps: () => ({
            catalog: createCatalogService({
              rooms: createInMemoryRoomPackageRepository(
                JSON.parse(
                  readFileSync(
                    new URL(
                      "../../../docs/reference/roompackage-rey-aldric.v1.json",
                      import.meta.url,
                    ),
                    "utf8",
                  ),
                ) as unknown,
              ),
            }),
            drafts: createRoomDraftService({ store }),
          }),
        },
      );

    const anonymous = await mcp(ROOM_ID, null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp/creator"`,
    );

    const foreign = (await (await mcp(FOREIGN_ROOM_ID, tokens.access_token)).json()) as {
      result: { isError: boolean; structuredContent: { error: { code: string } } };
    };
    expect(foreign.result.isError).toBe(true);
    expect(foreign.result.structuredContent.error.code).toBe("FORBIDDEN");
  });

  it("el formulario exige sesión y mismo origen; denegar devuelve access_denied", async () => {
    const { handlers } = setup();
    const clientId = await register(handlers);
    const params = authorizeParams(clientId, pkce().challenge);

    const crossSite = await decide(handlers, params, {
      session: "autora",
      origin: "https://malo.example",
    });
    expect(crossSite.status).toBe(403);
    const noOrigin = await decide(handlers, params, { session: "autora", origin: null });
    expect(noOrigin.status).toBe(403);

    // Un token (Bearer) nunca consiente por el humano, aunque haya sesión.
    const withBearer = await handlers.decide(
      new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          "x-test-session": "autora",
          authorization: "Bearer mcpat_cualquiera",
        },
        body: new URLSearchParams({ ...Object.fromEntries(params), decision: "approve" }),
      }),
    );
    expect(withBearer.status).toBe(403);

    const noSession = await decide(handlers, params);
    expect(noSession.status).toBe(303);
    expect(new URL(noSession.headers.get("location")!).pathname).toBe("/es/oauth/consent");

    const denied = await decide(handlers, params, { session: "autora", decision: "deny" });
    const back = new URL(denied.headers.get("location")!);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
  });

  it("el registro dinámico está limitado por IP", async () => {
    const { handlers } = setup();
    await register(handlers);
    await register(handlers);
    const third = await handlers.register(
      new Request(`${ORIGIN}/api/mcp/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      }),
    );
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });
});
