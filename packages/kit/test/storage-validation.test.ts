// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  extensionFromMime,
  isUploadMime,
  sniffImageMime,
  UPLOAD_MAX_BYTES,
} from "../src/storage/validation";

describe("storage validation", () => {
  it("checks allowed MIME types", () => {
    expect(isUploadMime("image/png")).toBe(true);
    expect(isUploadMime("application/pdf")).toBe(true);
    expect(isUploadMime("image/svg+xml")).toBe(false);
  });

  it("maps MIME to a file extension", () => {
    expect(extensionFromMime("image/jpeg")).toBe("jpg");
    expect(extensionFromMime("application/pdf")).toBe("pdf");
    expect(extensionFromMime("application/octet-stream")).toBe("octet-stream");
  });

  it("sniffs image MIME from magic bytes, ignoring the declared type", () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(
      sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("image/webp");
    expect(sniffImageMime(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("caps uploads at 5 MiB", () => {
    expect(UPLOAD_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
