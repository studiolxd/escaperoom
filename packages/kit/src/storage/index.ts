import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readStorageEnv, type KitStorageEnv } from "../env";

// STORAGE_* se leen con `storageSchema` de @escaperoom/env (ver ../env): la
// configuración del bucket/credenciales es la misma que valida cada app, así
// que adoptarlo no exige cablear nada. Las apps pueden pasar su env ya parseado
// con `createStorage`.
//
// El bucket PRIVADO es el supuesto: las lecturas se sirven con URLs firmadas de
// vida corta.

export type GetUploadUrlOptions = {
  key: string;
  contentType: string;
  /** Upload URL TTL in seconds (default: 300 = 5 minutes) */
  expiresIn?: number;
};

export type Storage = {
  provider: KitStorageEnv["STORAGE_PROVIDER"];
  bucket: string | undefined;
  region: string;
  endpoint: string | undefined;
  /** Presigned PUT URL for direct browser-to-storage uploads. */
  getUploadUrl(opts: GetUploadUrlOptions): Promise<string>;
  /** Short-lived presigned GET URL for a private object. */
  getSignedReadUrl(key: string, opts?: { expiresIn?: number }): Promise<string>;
  /** Batch version, keyed by the input key. */
  getSignedReadUrls(
    keys: readonly string[],
    opts?: { expiresIn?: number },
  ): Promise<Map<string, string>>;
  /** Uploads an object directly to the bucket from the server. */
  putObject(opts: { key: string; body: Buffer; contentType: string }): Promise<void>;
  /** Downloads an object as a Buffer. */
  getObjectBuffer(key: string): Promise<{ buffer: Buffer; contentType: string }>;
  /** Deletes one object. */
  deleteObject(key: string): Promise<void>;
  /** Deletes every object under a prefix; returns the number removed. */
  deleteObjectsByPrefix(prefix: string): Promise<number>;
  /** Signed URL for a stored key, else the fallback (e.g. an OAuth avatar). */
  resolveStoredImageUrl(
    input: { key: string | null | undefined; fallbackUrl: string | null | undefined },
    opts?: { expiresIn?: number },
  ): Promise<string | null>;
};

const DEFAULT_READ_TTL_SECONDS = 3600;

export function createStorage(env: KitStorageEnv): Storage {
  const bucket = env.STORAGE_BUCKET;

  let client: S3Client | null = null;

  function getClient(): S3Client {
    if (client) return client;
    client = new S3Client({
      region: env.STORAGE_REGION,
      ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
      credentials:
        env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.STORAGE_ACCESS_KEY_ID,
              secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
            }
          : undefined,
      // Path-style whenever there is a custom endpoint (MinIO, R2 or any
      // S3-compatible), where virtual-hosted style can't resolve the bucket.
      // Without an endpoint (AWS S3) it stays off, which is the default.
      forcePathStyle: Boolean(env.STORAGE_ENDPOINT) || env.STORAGE_PROVIDER === "r2",
      // AWS SDK v3 adds CRC32 checksums by default; R2 does not support them
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    return client;
  }

  function requireBucket(): string {
    if (!bucket) throw new Error("STORAGE_BUCKET is not set");
    return bucket;
  }

  async function getUploadUrl(opts: GetUploadUrlOptions): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: requireBucket(),
      Key: opts.key,
      ContentType: opts.contentType,
    });
    return getSignedUrl(getClient(), command, { expiresIn: opts.expiresIn ?? 300 });
  }

  async function getSignedReadUrl(key: string, opts: { expiresIn?: number } = {}): Promise<string> {
    const command = new GetObjectCommand({ Bucket: requireBucket(), Key: key });
    return getSignedUrl(getClient(), command, {
      expiresIn: opts.expiresIn ?? DEFAULT_READ_TTL_SECONDS,
    });
  }

  async function getSignedReadUrls(
    keys: readonly string[],
    opts: { expiresIn?: number } = {},
  ): Promise<Map<string, string>> {
    const unique = Array.from(new Set(keys));
    const urls = await Promise.all(unique.map((k) => getSignedReadUrl(k, opts)));
    return new Map(unique.map((k, i) => [k, urls[i]!]));
  }

  async function putObject(opts: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: requireBucket(),
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    });
    await getClient().send(command);
  }

  async function getObjectBuffer(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const command = new GetObjectCommand({ Bucket: requireBucket(), Key: key });
    const response: GetObjectCommandOutput = await getClient().send(command);
    if (!response.Body) throw new Error("Empty response body from storage");
    const buffer = Buffer.from(await response.Body.transformToByteArray());
    return { buffer, contentType: response.ContentType ?? "application/octet-stream" };
  }

  async function deleteObject(key: string): Promise<void> {
    await getClient().send(new DeleteObjectCommand({ Bucket: requireBucket(), Key: key }));
  }

  /**
   * Deletes every object under a prefix. Pages through ListObjectsV2 and
   * batch-deletes 1000 keys at a time — the S3 API maximum. Returns the number
   * of objects removed.
   */
  async function deleteObjectsByPrefix(prefix: string): Promise<number> {
    const b = requireBucket();
    // An empty prefix would enumerate (and delete) the whole bucket
    if (!prefix || prefix === "/") throw new Error("Refusing to delete without a prefix");

    const c = getClient();
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const page = await c.send(
        new ListObjectsV2Command({
          Bucket: b,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k);

      if (keys.length > 0) {
        await c.send(
          new DeleteObjectsCommand({
            Bucket: b,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += keys.length;
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
  }

  async function resolveStoredImageUrl(
    input: { key: string | null | undefined; fallbackUrl: string | null | undefined },
    opts: { expiresIn?: number } = {},
  ): Promise<string | null> {
    if (input.key) return getSignedReadUrl(input.key, opts);
    return input.fallbackUrl ?? null;
  }

  return {
    provider: env.STORAGE_PROVIDER,
    bucket,
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT || undefined,
    getUploadUrl,
    getSignedReadUrl,
    getSignedReadUrls,
    putObject,
    getObjectBuffer,
    deleteObject,
    deleteObjectsByPrefix,
    resolveStoredImageUrl,
  };
}

/**
 * Default instance bound to the process environment's storage fragment. A
 * consumer with its own parsed env should call `createStorage(env.storage)`.
 */
export const storage: Storage = createStorage(readStorageEnv());
