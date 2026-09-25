// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = vi.fn(async () => ({}));
    constructor(options: Record<string, unknown>) {
      s3.options.push(options);
    }
  },
  PutObjectCommand: class {},
  GetObjectCommand: class {},
  DeleteObjectCommand: class {},
  DeleteObjectsCommand: class {},
  ListObjectsV2Command: class {},
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://signed.example/object"),
}));

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
});
