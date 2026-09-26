// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  sent: [] as Array<{ type: string; input: Record<string, unknown> }>,
  respond: (async () => ({})) as (cmd: {
    type: string;
    input: Record<string, unknown>;
  }) => Promise<unknown>,
  presign: [] as Array<{ input: Record<string, unknown>; opts: Record<string, unknown> }>,
}));

function command(type: string) {
  return class {
    type = type;
    constructor(public input: Record<string, unknown>) {}
  };
}

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = vi.fn(async (cmd: { type: string; input: Record<string, unknown> }) => {
      s3.sent.push({ type: cmd.type, input: cmd.input });
      return s3.respond(cmd);
    });
    constructor(options: Record<string, unknown>) {
      s3.options.push(options);
    }
  },
  PutObjectCommand: command("Put"),
  GetObjectCommand: command("Get"),
  HeadObjectCommand: command("Head"),
  CopyObjectCommand: command("Copy"),
  DeleteObjectCommand: command("Delete"),
  DeleteObjectsCommand: command("DeleteMany"),
  ListObjectsV2Command: command("List"),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (
      _client: unknown,
      cmd: { input: Record<string, unknown> },
      opts: Record<string, unknown>,
    ) => {
      s3.presign.push({ input: cmd.input, opts });
      return "https://signed.example/object";
    },
  ),
}));

/** Cuerpo de respuesta del SDK a partir de bytes. */
function body(bytes: Uint8Array) {
  return {
    transformToByteArray: async () => bytes,
    transformToWebStream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          // En dos trozos: el digest debe acumular, no quedarse con el último.
          controller.enqueue(bytes.slice(0, 3));
          controller.enqueue(bytes.slice(3));
          controller.close();
        },
      }),
  };
}

import { createStorage } from "../src/storage/index";

const baseEnv = {
  STORAGE_PROVIDER: "s3" as const,
  STORAGE_BUCKET: "escaperoom-assets",
  STORAGE_REGION: "us-east-1",
  STORAGE_ENDPOINT: "http://localhost:9002",
  STORAGE_ACCESS_KEY_ID: "minioadmin",
  STORAGE_SECRET_ACCESS_KEY: "minioadmin",
};

describe("createStorage", () => {
  beforeEach(() => {
    s3.options.length = 0;
    s3.sent.length = 0;
    s3.presign.length = 0;
    s3.respond = async () => ({});
  });

  it("exposes the resolved config", () => {
    const storage = createStorage({ ...baseEnv, STORAGE_ENDPOINT: "" });
    expect(storage.provider).toBe("s3");
    expect(storage.bucket).toBe("escaperoom-assets");
    expect(storage.region).toBe("us-east-1");
    expect(storage.endpoint).toBeUndefined();
  });

  it("uses path-style addressing when a custom endpoint is set (SeaweedFS/S3-compatible)", async () => {
    const storage = createStorage(baseEnv);
    await storage.getSignedReadUrl("uploads/u1/x.png");
    expect(s3.options).toHaveLength(1);
    expect(s3.options[0]!.forcePathStyle).toBe(true);
    expect(s3.options[0]!.endpoint).toBe("http://localhost:9002");
  });

  it("keeps virtual-hosted style (forcePathStyle false) without a custom endpoint", async () => {
    const storage = createStorage({ ...baseEnv, STORAGE_ENDPOINT: "" });
    await storage.getSignedReadUrl("uploads/u1/x.png");
    expect(s3.options).toHaveLength(1);
    expect(s3.options[0]!.forcePathStyle).toBe(false);
    expect(s3.options[0]!.endpoint).toBeUndefined();
  });

  it("uses path-style for R2", async () => {
    const storage = createStorage({
      ...baseEnv,
      STORAGE_PROVIDER: "r2",
      STORAGE_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    });
    await storage.getSignedReadUrl("k");
    expect(s3.options[0]!.forcePathStyle).toBe(true);
  });

  it("signs read URLs when a bucket is configured", async () => {
    const storage = createStorage(baseEnv);
    await expect(storage.getSignedReadUrl("uploads/u1/x.png")).resolves.toBe(
      "https://signed.example/object",
    );
  });

  it("throws when STORAGE_BUCKET is missing (no bucket, no signed URL)", async () => {
    const storage = createStorage({ ...baseEnv, STORAGE_BUCKET: undefined });
    await expect(storage.getSignedReadUrl("k")).rejects.toThrow(/STORAGE_BUCKET/);
  });

  it("resolves a stored image to the fallback when there is no key", async () => {
    const storage = createStorage(baseEnv);
    await expect(
      storage.resolveStoredImageUrl({ key: null, fallbackUrl: "https://google/avatar" }),
    ).resolves.toBe("https://google/avatar");
    await expect(
      storage.resolveStoredImageUrl({ key: null, fallbackUrl: null }),
    ).resolves.toBeNull();
  });

  it("firma un PUT de subida directa con content-type y content-length", async () => {
    const storage = createStorage(baseEnv);
    const result = await storage.getSignedUploadUrl("uploads/intro/r/v.mp4", {
      contentType: "video/mp4",
      contentLength: 1234,
    });
    expect(result).toEqual({
      url: "https://signed.example/object",
      headers: { "Content-Type": "video/mp4" },
    });
    expect(s3.presign[0]!.input).toMatchObject({
      Bucket: "escaperoom-assets",
      Key: "uploads/intro/r/v.mp4",
      ContentType: "video/mp4",
      ContentLength: 1234,
    });
    expect([...(s3.presign[0]!.opts.signableHeaders as Set<string>)].sort()).toEqual([
      "content-length",
      "content-type",
    ]);
    expect(s3.presign[0]!.opts.expiresIn).toBe(900);
  });

  it("headObject devuelve tamaño y tipo, o null si no existe", async () => {
    const storage = createStorage(baseEnv);
    s3.respond = async () => ({ ContentLength: 42, ContentType: "video/webm" });
    await expect(storage.headObject("k")).resolves.toEqual({
      contentLength: 42,
      contentType: "video/webm",
    });
    s3.respond = async () => {
      throw Object.assign(new Error("not found"), { name: "NotFound" });
    };
    await expect(storage.headObject("k")).resolves.toBeNull();
    s3.respond = async () => {
      throw Object.assign(new Error("boom"), { name: "AccessDenied" });
    };
    await expect(storage.headObject("k")).rejects.toThrow("boom");
  });

  it("getObjectRange pide el rango y recorta si el servidor lo ignora", async () => {
    const storage = createStorage(baseEnv);
    s3.respond = async () => ({ Body: body(new Uint8Array([1, 2, 3, 4, 5, 6])) });
    await expect(storage.getObjectRange("k", 0, 3)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(s3.sent[0]).toMatchObject({ type: "Get", input: { Key: "k", Range: "bytes=0-3" } });
    await expect(storage.getObjectRange("k", 5, 2)).rejects.toThrow(/Rango/);
  });

  it("copyObject copia dentro del bucket (CopySource codificado)", async () => {
    const storage = createStorage(baseEnv);
    await storage.copyObject({ fromKey: "a b/c.mp4", toKey: "d/e.mp4", contentType: "video/mp4" });
    expect(s3.sent[0]).toEqual({
      type: "Copy",
      input: {
        Bucket: "escaperoom-assets",
        Key: "d/e.mp4",
        CopySource: "escaperoom-assets/a%20b/c.mp4",
        ContentType: "video/mp4",
        MetadataDirective: "REPLACE",
      },
    });
  });

  it("digestObject calcula el SHA-256 en streaming", async () => {
    const storage = createStorage(baseEnv);
    const bytes = new TextEncoder().encode("hola escaperoom");
    s3.respond = async () => ({ Body: body(bytes), ContentType: "text/plain" });
    const { createHash } = await import("node:crypto");
    await expect(storage.digestObject("k")).resolves.toEqual({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
      contentType: "text/plain",
    });
  });
});
