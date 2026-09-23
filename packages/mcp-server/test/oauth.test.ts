import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { createInMemoryRoomDraftStore, createRoomDraftService } from "@escaperoom/shared/services";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  AUTHORIZATION_SERVER_METADATA_PATH,
  createRateLimiter,
  DEFAULT_MAX_TOOL_RESPONSE_BYTES,
  MCP_CREATOR_SCOPE,
  type CreatorMcpDeps,
} from "../src";
import { call, errorCode } from "./fixtures/client";
import {
  ALDRIC_ROOM_ID,
  AUTHOR,
  BIG_ROOM_ID,
  createTestDeps,
  FOREIGN_ROOM_ID,
  loadAldric,
} from "./fixtures/drafts";
import {
  consent,
  startOAuthTestServer,
  TestOAuthClient,
  type OAuthTestServer,
} from "./fixtures/oauth-server";

/** Dueña de FOREIGN_ROOM_ID en los drafts de test. */
const OTHER_USER = "otra-persona";

const clients: Client[] = [];
afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.close();
});

/**
 * Flujo OAuth completo con el cliente del SDK de MCP: el primer intento da
 * 401 → descubre la metadata, se registra (DCR), prepara PKCE y "abre" la URL
 * de autorización; el creador consiente con su sesión y el cliente canjea el
 * código por un token con el que se conecta a `/mcp/creator`.
 */
async function connectWithOAuth(server: OAuthTestServer, userId: string) {
  const oauth = new TestOAuthClient();
  const first = new Client({ name: "oauth-test", version: "0.0.0" });
  await expect(
    first.connect(new StreamableHTTPClientTransport(server.http.url, { authProvider: oauth })),
  ).rejects.toThrow(UnauthorizedError);
  expect(oauth.authorizationUrl).toBeDefined();

  const back = await consent(oauth.authorizationUrl!, userId);
  const code = back.searchParams.get("code");
  expect(code).toBeTruthy();
  expect(back.searchParams.get("state")).toBe("estado-de-test");
  expect(back.searchParams.get("iss")).toBe(server.provider.issuer);

  const transport = new StreamableHTTPClientTransport(server.http.url, { authProvider: oauth });
  await transport.finishAuth(code!);
  const client = new Client({ name: "oauth-test", version: "0.0.0" });
  await client.connect(transport);
  clients.push(client);
  return { client, oauth };
}

/** POST JSON-RPC crudo a `/mcp/creator` con (o sin) Bearer. */
function rawCall(server: OAuthTestServer, token: string | null, name = "get_room", args = {}) {
  return fetch(server.http.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name, arguments: { roomId: ALDRIC_ROOM_ID, ...args } },
    }),
  });
}

function form(params: Record<string, string>) {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  } satisfies RequestInit;
}

const pkce = () => {
  const verifier = randomBytes(40).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

describe("OAuth 2.1 del MCP del creador (4.7)", () => {
  let server: OAuthTestServer;
  let deps: CreatorMcpDeps;

  beforeAll(async () => {
    deps = await createTestDeps(null);
    server = await startOAuthTestServer(deps);
  });
  afterAll(async () => {
    await server?.close();
  });

  /** Registra un cliente público y devuelve su client_id. */
  async function register(redirectUri = "http://127.0.0.1:9999/cb") {
    const response = await fetch(server.provider.endpoints.register, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Manual", redirect_uris: [redirectUri] }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { client_id: string }).client_id;
  }

  function authorizeUrl(params: Record<string, string>) {
    const url = new URL(server.provider.endpoints.authorize);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  it("sin token: 401 con WWW-Authenticate que apunta a la metadata del recurso", async () => {
    const response = await rawCall(server, null);
    expect(response.status).toBe(401);
    const header = response.headers.get("www-authenticate") ?? "";
    expect(header).toMatch(/^Bearer /);
    const metadataUrl = header.match(/resource_metadata="([^"]+)"/)?.[1];
    expect(metadataUrl).toBe(
      `${server.http.url.origin}/.well-known/oauth-protected-resource/mcp/creator`,
    );

    const resource = (await (await fetch(metadataUrl!)).json()) as Record<string, unknown>;
    expect(resource).toMatchObject({
      resource: server.http.url.href,
      authorization_servers: [server.http.url.origin],
      scopes_supported: [MCP_CREATOR_SCOPE],
    });
    const as = (await (
      await fetch(new URL(AUTHORIZATION_SERVER_METADATA_PATH, server.http.url.origin))
    ).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      issuer: server.http.url.origin,
      authorization_endpoint: server.provider.endpoints.authorize,
      token_endpoint: server.provider.endpoints.token,
      registration_endpoint: server.provider.endpoints.register,
      revocation_endpoint: server.provider.endpoints.revoke,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
  });

  it("flujo completo con PKCE: el token funciona en /mcp/creator", async () => {
    const { client, oauth } = await connectWithOAuth(server, AUTHOR.userId);
    expect(oauth.savedTokens).toMatchObject({ token_type: "Bearer", scope: MCP_CREATOR_SCOPE });
    expect(oauth.savedTokens?.refresh_token).toBeTruthy();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("get_room");
    const room = await call(client, "get_room", { roomId: ALDRIC_ROOM_ID });
    expect(room.isError).toBe(false);
    expect(room.structured?.room).toMatchObject({ meta: { title: expect.anything() } });
  });

  it("el token de un creador no lee ni modifica el draft de otro (FORBIDDEN por tool)", async () => {
    const { client: author } = await connectWithOAuth(server, AUTHOR.userId);
    const { client: other } = await connectWithOAuth(server, OTHER_USER);

    const forbidden: Array<[Client, string, Record<string, unknown>]> = [
      [author, "get_room", { roomId: FOREIGN_ROOM_ID }],
      [author, "get_room_graph", { roomId: FOREIGN_ROOM_ID }],
      [author, "set_map", { roomId: FOREIGN_ROOM_ID, tileset: "robado" }],
      [other, "get_room", { roomId: ALDRIC_ROOM_ID }],
      [other, "get_puzzle", { roomId: ALDRIC_ROOM_ID, puzzleId: "p-candado-arca" }],
      [other, "validate", { roomId: ALDRIC_ROOM_ID }],
      [
        other,
        "define_item",
        { roomId: ALDRIC_ROOM_ID, item: { id: "robo", name: { es: { text: "Robo" } }, icon: "i" } },
      ],
      [other, "set_map", { roomId: ALDRIC_ROOM_ID, tileset: "robado" }],
    ];
    for (const [client, name, args] of forbidden) {
      const result = await call(client, name, args);
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(errorCode(result), name).toBe("FORBIDDEN");
    }
    // Su propio draft sí.
    expect((await call(author, "get_room_graph", { roomId: ALDRIC_ROOM_ID })).isError).toBe(false);
  });

  it("token caducado → 401 invalid_token; el refresh token rota y da uno nuevo", async () => {
    const { oauth } = await connectWithOAuth(server, AUTHOR.userId);
    const tokens = oauth.savedTokens!;
    expect((await rawCall(server, tokens.access_token)).status).toBe(200);

    server.clock.now += (tokens.expires_in! + 1) * 1000;
    try {
      const expired = await rawCall(server, tokens.access_token);
      expect(expired.status).toBe(401);
      expect(expired.headers.get("www-authenticate")).toMatch(/error="invalid_token"/);
      expect(expired.headers.get("www-authenticate")).toMatch(/resource_metadata="/);

      const refresh = (params: Record<string, string>) =>
        fetch(server.provider.endpoints.token, form(params));
      const refreshed = await refresh({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token!,
        client_id: oauth.client!.client_id,
      });
      expect(refreshed.status).toBe(200);
      const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
      expect(next.access_token).not.toBe(tokens.access_token);
      expect((await rawCall(server, next.access_token)).status).toBe(200);

      // El refresh usado ya no vale (rotación).
      const reused = await refresh({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token!,
        client_id: oauth.client!.client_id,
      });
      expect(reused.status).toBe(400);
      expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
    } finally {
      server.clock.now = Date.now();
    }
  });

  it("token revocado → 401, y su refresh tampoco sirve", async () => {
    const { oauth } = await connectWithOAuth(server, AUTHOR.userId);
    const tokens = oauth.savedTokens!;
    expect((await rawCall(server, tokens.access_token)).status).toBe(200);

    const revoked = await fetch(
      server.provider.endpoints.revoke,
      form({ token: tokens.access_token, client_id: oauth.client!.client_id }),
    );
    expect(revoked.status).toBe(200);

    const after = await rawCall(server, tokens.access_token);
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toMatch(/error="invalid_token"/);
    expect(((await after.json()) as { error: { message: string } }).error.message).toMatch(
      /revocado/,
    );

    const refreshed = await fetch(
      server.provider.endpoints.token,
      form({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token!,
        client_id: oauth.client!.client_id,
      }),
    );
    expect(refreshed.status).toBe(400);
  });

  it("un token inventado → 401 invalid_token", async () => {
    const response = await rawCall(server, "mcpat_inventado");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/error="invalid_token"/);
  });

  it("PKCE obligatorio y S256; el código es de un solo uso y ligado al cliente", async () => {
    const redirectUri = "http://127.0.0.1:9999/cb";
    const clientId = await register(redirectUri);
    const { verifier, challenge } = pkce();
    const base = {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state: "s",
    };

    // Sin PKCE o con "plain": error devuelto al cliente por su redirect_uri.
    const withoutS256: Array<Record<string, string>> = [
      {},
      { code_challenge: verifier, code_challenge_method: "plain" },
    ];
    for (const extra of withoutS256) {
      const back = await consent(authorizeUrl({ ...base, ...extra }), AUTHOR.userId);
      expect(back.origin + back.pathname).toBe(redirectUri);
      expect(back.searchParams.get("error")).toBe("invalid_request");
      expect(back.searchParams.get("state")).toBe("s");
    }

    // Recurso ajeno.
    const wrongResource = await consent(
      authorizeUrl({
        ...base,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://otro.example/mcp",
      }),
      AUTHOR.userId,
    );
    expect(wrongResource.searchParams.get("error")).toBe("invalid_target");

    const approved = await consent(
      authorizeUrl({ ...base, code_challenge: challenge, code_challenge_method: "S256" }),
      AUTHOR.userId,
    );
    const code = approved.searchParams.get("code")!;
    const exchange = (params: Record<string, string>) =>
      fetch(server.provider.endpoints.token, form(params));

    const wrongVerifier = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: pkce().verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    });
    expect(wrongVerifier.status).toBe(400);
    expect(await wrongVerifier.json()).toMatchObject({ error: "invalid_grant" });

    // El intento fallido consumió el código: ni con el verifier correcto.
    const reused = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    });
    expect(reused.status).toBe(400);

    // Código nuevo, canjeado por OTRO cliente → invalid_grant.
    const again = await consent(
      authorizeUrl({ ...base, code_challenge: challenge, code_challenge_method: "S256" }),
      AUTHOR.userId,
    );
    const otherClient = await register();
    const stolen = await exchange({
      grant_type: "authorization_code",
      code: again.searchParams.get("code")!,
      code_verifier: verifier,
      client_id: otherClient,
    });
    expect(stolen.status).toBe(400);
  });

  it("redirect_uri no registrada o cliente desconocido: no se redirige", async () => {
    const clientId = await register("http://127.0.0.1:9999/cb");
    const { challenge } = pkce();
    const params = {
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
    };
    const foreign = await fetch(
      authorizeUrl({ ...params, client_id: clientId, redirect_uri: "https://malo.example/cb" }),
      { redirect: "manual" },
    );
    expect(foreign.status).toBe(400);
    const unknown = await fetch(authorizeUrl({ ...params, client_id: "no-existe" }), {
      redirect: "manual",
    });
    expect(unknown.status).toBe(400);
  });

  it("el creador puede denegar: access_denied al cliente", async () => {
    const redirectUri = "http://127.0.0.1:9999/cb";
    const clientId = await register(redirectUri);
    const back = await consent(
      authorizeUrl({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: pkce().challenge,
        code_challenge_method: "S256",
      }),
      AUTHOR.userId,
      "deny",
    );
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
  });

  it("el registro dinámico rechaza redirect_uri inseguras", async () => {
    for (const uri of ["http://malo.example/cb", "javascript:alert(1)"]) {
      const response = await fetch(server.provider.endpoints.register, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Malo", redirect_uris: [uri] }),
      });
      expect(response.status, uri).toBe(400);
    }
  });

  it("clientes confidenciales: client_secret_basic obligatorio en el token", async () => {
    const redirectUri = "https://cliente.example/cb";
    const registered = (await (
      await fetch(server.provider.endpoints.register, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Confidencial",
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      })
    ).json()) as { client_id: string; client_secret: string };
    expect(registered.client_secret).toBeTruthy();

    const { verifier, challenge } = pkce();
    const approved = await consent(
      authorizeUrl({
        client_id: registered.client_id,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
      AUTHOR.userId,
    );
    const body = {
      grant_type: "authorization_code",
      code: approved.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    };
    const noSecret = await fetch(
      server.provider.endpoints.token,
      form({ ...body, client_id: registered.client_id }),
    );
    expect(noSecret.status).toBe(401);
    expect(await noSecret.json()).toMatchObject({ error: "invalid_client" });

    // El 401 de cliente no consume el código: con la cabecera Basic, sí.
    const basic = Buffer.from(`${registered.client_id}:${registered.client_secret}`).toString(
      "base64",
    );
    const ok = await fetch(server.provider.endpoints.token, {
      ...form(body),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
      },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ token_type: "Bearer" });
  });
});

describe("límites de coste (4.7)", () => {
  it("rate limit por token: superarlo da un error claro con Retry-After", async () => {
    const deps = await createTestDeps(null);
    const server = await startOAuthTestServer(deps, {
      rateLimiter: createRateLimiter({ limit: 3, windowSeconds: 60 }),
    });
    try {
      const { client, oauth } = await connectWithOAuth(server, AUTHOR.userId);
      for (let i = 0; i < 3; i++) {
        expect((await call(client, "get_room_graph", { roomId: ALDRIC_ROOM_ID })).isError).toBe(
          false,
        );
      }
      // listTools no cuenta: solo las llamadas a tools.
      await client.listTools();
      await expect(call(client, "get_room_graph", { roomId: ALDRIC_ROOM_ID })).rejects.toThrow(
        /Límite de uso del MCP superado: máximo 3 llamadas a tools cada 60 s por token/,
      );

      const raw = await rawCall(server, oauth.savedTokens!.access_token);
      expect(raw.status).toBe(429);
      expect(Number(raw.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await raw.json()).toMatchObject({
        id: 7,
        error: { data: { code: "RATE_LIMITED", limit: 3 } },
      });

      // Otro creador (otro token) tiene su propio cupo.
      const { client: other } = await connectWithOAuth(server, OTHER_USER);
      await expect(
        call(other, "get_room_graph", { roomId: FOREIGN_ROOM_ID }),
      ).resolves.toBeDefined();
    } finally {
      await server.close();
    }
  });

  it("get_room de una sala grande avisa de usar las vistas filtradas", async () => {
    // Drafts sembrados con la serialización real de 3.1: el Rey Aldric (mediana)
    // y una sala grande (el Aldric con 600 estatuas más).
    const aldric = parseRoomPackage(loadAldric());
    const big = parseRoomPackage({
      ...aldric,
      objects: [
        ...aldric.objects,
        ...Array.from({ length: 600 }, (_, i) => ({ ...aldric.objects[0]!, id: `estatua-${i}` })),
      ],
    });
    const store = createInMemoryRoomDraftStore([
      { id: ALDRIC_ROOM_ID, authorId: AUTHOR.userId },
      { id: BIG_ROOM_ID, authorId: AUTHOR.userId },
    ]);
    const drafts = createRoomDraftService({ store });
    for (const [roomId, pkg] of [
      [ALDRIC_ROOM_ID, aldric],
      [BIG_ROOM_ID, big],
    ] as const) {
      const doc = roomPackageToDoc(pkg);
      await drafts.appendUpdate(AUTHOR, roomId, Y.encodeStateAsUpdate(doc));
      doc.destroy();
    }
    const deps = { ...(await createTestDeps(null)), drafts, roomDocToPackage };
    const server = await startOAuthTestServer(deps);
    try {
      const { client } = await connectWithOAuth(server, AUTHOR.userId);
      const result = await call(client, "get_room", { roomId: BIG_ROOM_ID });
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("RESPONSE_TOO_LARGE");
      expect(result.text).toMatch(/supera el tope de 64 KB/);
      expect(result.text).toMatch(/get_room_graph/);
      expect(result.text).toMatch(/get_puzzle\(\{ roomId, puzzleId \}\)/);
      expect(result.text).toMatch(/get_rules_for\(\{ roomId, objectId \}\)/);
      const error = result.structured?.error as Record<string, unknown>;
      expect(error).toMatchObject({
        limit: DEFAULT_MAX_TOOL_RESPONSE_BYTES,
        alternatives: ["get_room_graph", "get_puzzle", "get_rules_for"],
      });
      expect(error.puzzleIds).toContain("p-candado-arca");
      expect(error.bytes as number).toBeGreaterThan(DEFAULT_MAX_TOOL_RESPONSE_BYTES);

      // Las vistas filtradas de la misma sala sí caben.
      expect((await call(client, "get_room_graph", { roomId: BIG_ROOM_ID })).isError).toBe(false);
      const puzzle = await call(client, "get_puzzle", {
        roomId: BIG_ROOM_ID,
        puzzleId: "p-candado-arca",
      });
      expect(puzzle.isError, puzzle.text).toBe(false);
      // Una sala mediana (el Rey Aldric) sigue cabiendo en get_room.
      expect((await call(client, "get_room", { roomId: ALDRIC_ROOM_ID })).isError).toBe(false);
    } finally {
      await server.close();
    }
  });
});
