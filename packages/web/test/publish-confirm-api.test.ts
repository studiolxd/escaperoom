import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  createInMemoryPublishedAssetStorage,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPublishStore,
  createPublishConfirmationService,
  createRoomPublishService,
  createUnavailablePublishAssetSource,
  type Actor,
} from "@escaperoom/shared/services";
import { createHash, randomBytes } from "node:crypto";
import {
  authenticateOAuthBearer,
  createInMemoryOAuthStore,
  createOAuthProvider,
  resolveHttpAuth,
} from "@escaperoom/mcp-server";
import { describe, expect, it } from "vitest";
import { createPublishConfirmHandlers } from "../src/server/rest/publish-confirm";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

type ErrorJson = { error: { code: string; message: string } };

/**
 * `POST /api/publish-confirm` (ticket 4.5) con stores en memoria. El "draft"
 * es un RoomPackage mutable que devuelve el serializador (como en
 * room-publish-api.test.ts).
 */
function setup(opts: { disabled?: boolean; resolveActor?: (req: Request) => Promise<Actor> } = {}) {
  let draft: RoomPackage = structuredClone(reyAldric);
  const store = createInMemoryRoomPublishStore([
    { id: ROOM_ID, authorId: author.userId, status: "draft" },
  ]);
  const publish = createRoomPublishService({
    store,
    drafts: createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]),
    serializer: () => structuredClone(draft),
    assets: createUnavailablePublishAssetSource(),
    storage: createInMemoryPublishedAssetStorage(),
  });
  const confirmations = createPublishConfirmationService({
    publish,
    config: { secret: "secreto-de-test", ttlSeconds: 600 },
  });
  const actors: Record<string, Actor> = { autora: author, otro: intruder };
  const handlers = createPublishConfirmHandlers({
    confirmations: opts.disabled ? null : confirmations,
    resolveActor:
      opts.resolveActor ??
      (async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR),
  });

  return {
    store,
    confirmations,
    editDraft(fn: (pkg: RoomPackage) => void) {
      draft = structuredClone(draft);
      fn(draft);
    },
    post: (body: unknown, user?: string, extra: Record<string, string> = {}) =>
      handlers.postConfirm(
        new Request("http://localhost/api/publish-confirm", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(user ? { "x-test-user": user } : {}),
            ...extra,
          },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
  };
}

// Cada paso vuelve a correr el validador (~0,3 s en el Rey Aldric; CI es más lento).
describe("POST /api/publish-confirm (confirmación humana, ticket 4.5)", { timeout: 30_000 }, () => {
  it("el autor confirma con su sesión y se crea la versión (201)", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "Estreno" });
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);

    const res = await api.post({ token }, "autora", { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { version: { semver: string; changelog: string } };
    expect(body.version).toMatchObject({ semver: "1.0.0", changelog: "Estreno" });
    expect(await api.store.listVersions(ROOM_ID)).toHaveLength(1);

    // Reutilizar el enlace no publica otra vez.
    const again = await api.post({ token }, "autora");
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe("VERSION_CHANGED");
  });

  it("si el draft cambió desde la solicitud responde 409 DRAFT_CHANGED y no publica", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    api.editDraft((pkg) => (pkg.meta.title = "Otro título"));
    const res = await api.post({ token }, "autora");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorJson).error.code).toBe("DRAFT_CHANGED");
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);
  });

  it("solo el autor con sesión: 401 sin sesión, 403 con otra cuenta", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    const anonymous = await api.post({ token });
    expect(anonymous.status).toBe(401);
    const other = await api.post({ token }, "otro");
    expect(other.status).toBe(403);
    expect(((await other.json()) as ErrorJson).error.code).toBe("FORBIDDEN");
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);
  });

  it("rechaza peticiones de otros sitios, tokens inválidos y cuerpos sin token", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    const crossSite = await api.post({ token }, "autora", { "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect(((await crossSite.json()) as ErrorJson).error.code).toBe("CROSS_SITE");

    const invalid = await api.post({ token: `${token}x` }, "autora");
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as ErrorJson).error.code).toBe("INVALID_TOKEN");

    for (const body of [{}, "no es json", { token: 3 }]) {
      const res = await api.post(body, "autora");
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorJson).error.code).toBe("VALIDATION_ERROR");
    }
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);
  });

  it("un draft que pasa a rojo tras la solicitud tampoco se publica (409 DRAFT_CHANGED)", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    api.editDraft((pkg) => (pkg.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = []));
    const res = await api.post({ token }, "autora");
    // La huella ya no coincide: el draft cambió (se comprueba antes que el validador).
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorJson).error.code).toBe("DRAFT_CHANGED");
  });

  it("un token Bearer OAuth válido del creador (el del MCP) no confirma: 403 y no publica", async () => {
    // Token OAuth real de la autora (4.7), obtenido por el flujo completo con PKCE.
    const origin = "http://localhost";
    const provider = createOAuthProvider({
      store: createInMemoryOAuthStore(),
      issuer: origin,
      resource: `${origin}/mcp/creator`,
    });
    const redirectUri = "http://127.0.0.1:7777/cb";
    const registered = await provider.handleRegister(
      new Request(`${origin}/api/mcp/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Agente", redirect_uris: [redirectUri] }),
      }),
    );
    const { client_id } = (await registered.json()) as { client_id: string };
    const verifier = randomBytes(40).toString("base64url");
    const parsed = await provider.parseAuthorizationRequest(
      new URLSearchParams({
        response_type: "code",
        client_id,
        redirect_uri: redirectUri,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      }),
    );
    if (!parsed.ok) throw new Error(parsed.description);
    const code = (await provider.approve(parsed.request, author)).searchParams.get("code")!;
    const tokenResponse = await provider.handleToken(
      new Request(`${origin}/api/mcp/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id,
        }),
      }),
    );
    const { access_token } = (await tokenResponse.json()) as { access_token: string };
    const bearer = { authorization: `Bearer ${access_token}`, "sec-fetch-site": "same-origin" };

    // Peor caso: aunque el resolvedor aceptara el token (es válido y es de la autora)…
    const acceptsBearer = async (req: Request): Promise<Actor> => {
      const auth = resolveHttpAuth(await authenticateOAuthBearer(provider, req));
      return auth.ok ? auth.actor : ANONYMOUS_ACTOR;
    };
    const probe = await acceptsBearer(
      new Request(`${origin}/mcp/creator`, { headers: { authorization: bearer.authorization } }),
    );
    expect(probe.userId).toBe(author.userId);

    const api = setup({ resolveActor: acceptsBearer });
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    // …el agente no confirma su propia publicación.
    const res = await api.post({ token }, undefined, bearer);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorJson).error.code).toBe("BEARER_NOT_ALLOWED");
    // Ni con la cookie de sesión de la autora a la vez.
    const both = await api.post({ token }, "autora", bearer);
    expect(both.status).toBe(403);
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);

    // La misma confirmación, desde el navegador de la autora (sin Bearer), sí publica.
    const browser = setup();
    const human = await browser.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    const ok = await browser.post({ token: human.token }, "autora", {
      "sec-fetch-site": "same-origin",
    });
    expect(ok.status).toBe(201);
  });

  it("sin configuración responde 503", async () => {
    const api = setup({ disabled: true });
    const res = await api.post({ token: "x~y" }, "autora");
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorJson).error.code).toBe("PUBLISH_CONFIRM_DISABLED");
  });
});
