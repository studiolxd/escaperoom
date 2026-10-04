import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/services", () => ({ getIntroMediaService: () => ({}) }));
vi.mock("@escaperoom/kit/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { customModelUrls, withCustomModelUrls } = await import("@/server/model-url");

const model = {
  customModels: {
    arca: { ref: "r2://assets/rooms/r1/aaa.glb" },
    mesa: { ref: "r2://assets/rooms/r1/bbb.glb" },
    copia: { ref: "r2://assets/rooms/r1/aaa.glb" },
  },
};

function service(fail: string[] = []) {
  return {
    resolveMediaRef: vi.fn(async (_access: unknown, ref: string) => {
      if (fail.includes(ref)) throw new Error("no servible");
      return `key:${ref}`;
    }),
    signedUrl: vi.fn(async (key: string, opts?: { expiresIn?: number }) => `https://s/${key}?e=${opts?.expiresIn}`),
  };
}

describe("customModelUrls", () => {
  it("publicado: resuelve sin acceso de borrador, una vez por ref, con 6 h de vida", async () => {
    const svc = service();
    const urls = await customModelUrls(model, { kind: "published" }, svc);
    expect(urls).toEqual({
      "r2://assets/rooms/r1/aaa.glb": "https://s/key:r2://assets/rooms/r1/aaa.glb?e=21600",
      "r2://assets/rooms/r1/bbb.glb": "https://s/key:r2://assets/rooms/r1/bbb.glb?e=21600",
    });
    expect(svc.resolveMediaRef).toHaveBeenCalledTimes(2);
    expect(svc.resolveMediaRef.mock.calls.every((c) => c[0] === null)).toBe(true);
  });

  it("borrador: pasa el roomId como acceso", async () => {
    const svc = service();
    await customModelUrls(model, { kind: "draft", roomId: "r1" }, svc);
    expect(svc.resolveMediaRef.mock.calls.every((c) => (c[0] as { roomId: string }).roomId === "r1")).toBe(true);
  });

  it("una referencia que falla se omite y no lanza", async () => {
    const svc = service(["r2://assets/rooms/r1/bbb.glb"]);
    const urls = await customModelUrls(model, { kind: "published" }, svc);
    expect(Object.keys(urls)).toEqual(["r2://assets/rooms/r1/aaa.glb"]);
  });
});

describe("withCustomModelUrls", () => {
  it("sin pack3d o sin modelos propios no toca nada", async () => {
    expect(await withCustomModelUrls(undefined, model, { kind: "published" })).toBeUndefined();
    const pack = { packId: "medieval-v1" };
    expect(await withCustomModelUrls(pack, { customModels: {} }, { kind: "published" })).toBe(pack);
  });
});
