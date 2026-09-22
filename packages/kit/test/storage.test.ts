// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = vi.fn(async () => ({}));
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
  it("exposes the resolved config", () => {
    const storage = createStorage({ ...baseEnv, STORAGE_ENDPOINT: "" });
    expect(storage.provider).toBe("s3");
    expect(storage.bucket).toBe("escaperoom-assets");
    expect(storage.region).toBe("us-east-1");
    expect(storage.endpoint).toBeUndefined();
  });

  it("signs upload and read URLs when a bucket is configured", async () => {
    const storage = createStorage(baseEnv);
    await expect(
      storage.getUploadUrl({ key: "uploads/u1/x.png", contentType: "image/png" }),
    ).resolves.toBe("https://signed.example/object");
    await expect(storage.getSignedReadUrl("uploads/u1/x.png")).resolves.toBe(
      "https://signed.example/object",
    );
  });

  it("throws when STORAGE_BUCKET is missing (no bucket, no signed URL)", async () => {
    const storage = createStorage({ ...baseEnv, STORAGE_BUCKET: undefined });
    await expect(storage.getSignedReadUrl("k")).rejects.toThrow(/STORAGE_BUCKET/);
    await expect(storage.getUploadUrl({ key: "k", contentType: "image/png" })).rejects.toThrow(
      /STORAGE_BUCKET/,
    );
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
