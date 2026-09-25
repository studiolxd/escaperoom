// Validación de subidas, adaptada de @slxd/kit/storage/validation (ADR-017):
// se conserva lo genérico (MIME permitidos, clave segura, sniff de imágenes) y
// se poda lo específico de avatar/logo de la suite.

export const UPLOAD_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
] as const;
export type UploadMime = (typeof UPLOAD_ALLOWED_MIME)[number];

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export function isUploadMime(value: string): value is UploadMime {
  return (UPLOAD_ALLOWED_MIME as readonly string[]).includes(value);
}

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

export function extensionFromMime(mime: string): string {
  return MIME_EXTENSION[mime] ?? mime.split("/")[1] ?? "bin";
}

/**
 * Detects the image MIME type from the file's magic bytes, ignoring the
 * client-declared type. Defence in depth: the declared MIME is attacker-
 * controlled, so we verify the actual content matches before storing it.
 * Returns null for anything that isn't one of the accepted image formats
 * (SVG included — it has no binary signature and stays unsupported).
 */
export function sniffImageMime(bytes: Uint8Array): UploadMime | null {
  // JPEG — FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF — "GIF8" (47 49 46 38), covers 87a and 89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  // WEBP — "RIFF"(52 49 46 46) …… "WEBP"(57 45 42 50) at offset 8
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
