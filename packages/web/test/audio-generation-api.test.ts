import {
  ANONYMOUS_ACTOR,
  createAudioGenerationService,
  createCreditsService,
  createFakeElevenLabsClient,
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  createInMemoryCreditAccountStore,
  type Actor,
} from "@escaperoom/shared/services";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_POLICIES } from "../src/server/rate-limit";
import { createAudioGenerationHandlers } from "../src/server/rest/audio-generation";
import type { AudioGenerationService } from "@escaperoom/shared/services";

const quotaServices = vi.hoisted(() => ({ generation: null as AudioGenerationService | null }));
vi.mock("@/server/services", () => ({ getAudioGenerationService: () => quotaServices.generation }));
vi.mock("@/server/context", () => ({
  resolveActorFromRequest: async () => ({ userId: "ana", organizationId: null, role: "member" }),
}));

const ana: Actor = { userId: "ana", organizationId: null, role: "member" };

type ErrorJson = { error: { code: string; message: string } };
type PreviewJson = { costCredits: number; audioBase64: string };
type ConfirmJson = { ref: string; costCredits: number; balanceAfter: number; asset: { status: string } };

function setup(opts: { balance?: bigint; elevenlabsFails?: boolean; disabled?: boolean } = {}) {
  const creditStore = createInMemoryCreditAccountStore();
  const credits = createCreditsService({ store: creditStore });
  const blobs = createInMemoryAudioBlobStore();
  const audioStore = createInMemoryAudioAssetStore();
  const elevenlabs = createFakeElevenLabsClient({
    fail: opts.elevenlabsFails ? () => true : undefined,
  });
  const generation = opts.disabled
    ? null
    : createAudioGenerationService({
        elevenlabs,
        credits,
        store: audioStore,
        blobs,
        config: { voiceId: "voice-default" },
      });

  const actors: Record<string, Actor> = { ana };
  const handlers = createAudioGenerationHandlers({
    generation,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });

  function request(path: string, user: string | undefined, body: unknown): Request {
    return new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: JSON.stringify(body),
    });
  }

  return { creditStore, handlers, request };
}

describe("POST /api/audio/generate/preview", () => {
  it("devuelve el coste y el audio sin cobrar", async () => {
    const { creditStore, handlers, request } = setup();
    const account = await creditStore.ensureAccountForActor(ana);
    account.balanceCredits = 10n;

    const res = await handlers.preview(request("/api/audio/generate/preview", "ana", { text: "hola" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewJson;
    expect(body.costCredits).toBe(1);
    expect(body.audioBase64.length).toBeGreaterThan(0);
    expect(account.balanceCredits).toBe(10n);
  });

  it("sin sesión → 401", async () => {
    const { handlers, request } = setup();
    const res = await handlers.preview(
      request("/api/audio/generate/preview", undefined, { text: "hola" }),
    );
    expect(res.status).toBe(401);
  });

  it("sin ELEVENLABS_API_KEY configurada → 503", async () => {
    const { handlers, request } = setup({ disabled: true });
    const res = await handlers.preview(request("/api/audio/generate/preview", "ana", { text: "hola" }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe("PROVIDER_UNAVAILABLE");
  });
});

describe("POST /api/audio/generate/confirm", () => {
  it("cobra créditos y da de alta el audio pendiente de moderación", async () => {
    const { creditStore, handlers, request } = setup();
    const account = await creditStore.ensureAccountForActor(ana);
    account.balanceCredits = 5n;

    const res = await handlers.confirm(
      request("/api/audio/generate/confirm", "ana", {
        text: "Bienvenido al calabozo",
        referenceId: "dialog-1:es",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as ConfirmJson;
    expect(body.costCredits).toBe(1);
    expect(body.balanceAfter).toBe(4);
    expect(body.asset.status).toBe("pending");
    expect(body.ref).toMatch(/^upload:/);
  });

  it("saldo insuficiente → 402, sin cobrar", async () => {
    const { creditStore, handlers, request } = setup();
    const account = await creditStore.ensureAccountForActor(ana);
    account.balanceCredits = 0n;

    const res = await handlers.confirm(
      request("/api/audio/generate/confirm", "ana", { text: "hola", referenceId: "dialog-1:es" }),
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(account.balanceCredits).toBe(0n);
  });

  it("fallo del proveedor → 502, sin cobrar", async () => {
    const { creditStore, handlers, request } = setup({ elevenlabsFails: true });
    const account = await creditStore.ensureAccountForActor(ana);
    account.balanceCredits = 5n;

    const res = await handlers.confirm(
      request("/api/audio/generate/confirm", "ana", { text: "hola", referenceId: "dialog-1:es" }),
    );
    expect(res.status).toBe(502);
    expect(account.balanceCredits).toBe(5n);
  });
});

// B-7: sin cuota, la preview (gratis, sin cobrar créditos) era ilimitada.
describe("POST /api/audio/generate/preview — cuota (route module real)", () => {
  let POST: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    const { createAudioGenerationService, createCreditsService, createFakeElevenLabsClient, createInMemoryAudioAssetStore, createInMemoryAudioBlobStore, createInMemoryCreditAccountStore } =
      await import("@escaperoom/shared/services");
    const creditStore = createInMemoryCreditAccountStore();
    const credits = createCreditsService({ store: creditStore });
    const account = await creditStore.ensureAccountForActor({
      userId: "ana",
      organizationId: null,
      role: "member",
    });
    account.balanceCredits = 1_000_000n;
    quotaServices.generation = createAudioGenerationService({
      elevenlabs: createFakeElevenLabsClient(),
      credits,
      store: createInMemoryAudioAssetStore(),
      blobs: createInMemoryAudioBlobStore(),
      config: { voiceId: "voice-default" },
    });
    ({ POST } = await import("../src/app/api/audio/generate/preview/route"));
  });

  function req(ip: string): Request {
    return new Request("http://localhost/api/audio/generate/preview", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ text: "Hola creador" }),
    });
  }

  it(`agota la cuota "audio-preview" y responde 429`, async () => {
    const ip = "203.0.113.77";
    const { limit } = RATE_LIMIT_POLICIES["audio-preview"].ip;
    for (let i = 0; i < limit; i += 1) {
      expect((await POST(req(ip))).status).toBe(200);
    }
    const blocked = await POST(req(ip));
    expect(blocked.status).toBe(429);
  });
});
