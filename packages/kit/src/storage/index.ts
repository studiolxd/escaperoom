import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
//
// R2 (producción) no admite presigned POST (formularios / POST policy, con
// `content-length-range` u otras condiciones): solo firma GET/HEAD/PUT/DELETE
// (https://developers.cloudflare.com/r2/api/s3/presigned-urls/). Por eso este
// módulo no expone un helper de subida directa desde el navegador vía POST
// policy — si hace falta subida directa, usar un PUT presignado (con
// `Content-Length` verificado en el propio objeto tras subir, ya que el PUT
// presignado no admite condiciones de tamaño) y NO añadir `createPresignedPost`
// ni equivalentes: fallaría en producción contra R2.

export type Storage = {
  provider: KitStorageEnv["STORAGE_PROVIDER"];
  bucket: string | undefined;
  region: string;
  endpoint: string | undefined;
  /** Short-lived presigned GET URL for a private object. */
  getSignedReadUrl(key: string, opts?: { expiresIn?: number }): Promise<string>;
  /** Batch version, keyed by the input key. */
  getSignedReadUrls(
    keys: readonly string[],
    opts?: { expiresIn?: number },
  ): Promise<Map<string, string>>;
  /**
   * PUT presignado para subir un objeto directamente desde el navegador (sin
   * pasar los bytes por el servidor). Firma `content-type` y, si se da,
   * `content-length`; aun así el tamaño real hay que comprobarlo después con
   * `headObject` (R2 no admite condiciones de tamaño en un PUT presignado).
   * `headers` son las cabeceras que el cliente DEBE enviar tal cual
   * (`Content-Length` la pone el navegador a partir del cuerpo).
   */
  getSignedUploadUrl(
    key: string,
    opts: { contentType: string; contentLength?: number; expiresIn?: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** Metadatos de un objeto (HEAD); `null` si no existe. */
  headObject(key: string): Promise<{ contentLength: number; contentType: string } | null>;
  /** Bytes `[start, end]` (ambos inclusive) de un objeto: GET con `Range`. */
  getObjectRange(key: string, start: number, end: number): Promise<Uint8Array>;
  /** Copia servidor-servidor dentro del bucket (sin descargar el objeto). */
  copyObject(opts: { fromKey: string; toKey: string; contentType?: string }): Promise<void>;
  /** SHA-256 (hex) y tamaño de un objeto, leyéndolo en streaming (sin cargarlo entero en memoria). */
  digestObject(key: string): Promise<{ sha256: string; byteSize: number; contentType: string }>;
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
const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60;

/** `NotFound`/404 del SDK (HEAD no trae cuerpo, así que el nombre varía). */
function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

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
      // Path-style whenever there is a custom endpoint (SeaweedFS, R2 or any
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

  async function getSignedUploadUrl(
    key: string,
    opts: { contentType: string; contentLength?: number; expiresIn?: number },
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const command = new PutObjectCommand({
      Bucket: requireBucket(),
      Key: key,
      ContentType: opts.contentType,
      ...(opts.contentLength !== undefined ? { ContentLength: opts.contentLength } : {}),
    });
    const signableHeaders = new Set(["content-type"]);
    if (opts.contentLength !== undefined) signableHeaders.add("content-length");
    const url = await getSignedUrl(getClient(), command, {
      expiresIn: opts.expiresIn ?? DEFAULT_UPLOAD_TTL_SECONDS,
      signableHeaders,
    });
    return { url, headers: { "Content-Type": opts.contentType } };
  }

  async function headObject(
    key: string,
  ): Promise<{ contentLength: number; contentType: string } | null> {
    try {
      const response = await getClient().send(
        new HeadObjectCommand({ Bucket: requireBucket(), Key: key }),
      );
      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? "application/octet-stream",
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function getObjectRange(key: string, start: number, end: number): Promise<Uint8Array> {
    if (!(start >= 0 && end >= start)) throw new Error(`Rango no válido: ${start}-${end}`);
    const response: GetObjectCommandOutput = await getClient().send(
      new GetObjectCommand({ Bucket: requireBucket(), Key: key, Range: `bytes=${start}-${end}` }),
    );
    if (!response.Body) throw new Error("Empty response body from storage");
    const bytes = await response.Body.transformToByteArray();
    // Un servidor que ignore `Range` devolvería el objeto entero: se recorta.
    return bytes.byteLength > end - start + 1 ? bytes.slice(0, end - start + 1) : bytes;
  }

  async function copyObject(opts: {
    fromKey: string;
    toKey: string;
    contentType?: string;
  }): Promise<void> {
    const b = requireBucket();
    await getClient().send(
      new CopyObjectCommand({
        Bucket: b,
        Key: opts.toKey,
        CopySource: `${b}/${opts.fromKey.split("/").map(encodeURIComponent).join("/")}`,
        ...(opts.contentType
          ? { ContentType: opts.contentType, MetadataDirective: "REPLACE" as const }
          : {}),
      }),
    );
  }

  async function digestObject(
    key: string,
  ): Promise<{ sha256: string; byteSize: number; contentType: string }> {
    const response: GetObjectCommandOutput = await getClient().send(
      new GetObjectCommand({ Bucket: requireBucket(), Key: key }),
    );
    if (!response.Body) throw new Error("Empty response body from storage");
    const hash = createHash("sha256");
    let byteSize = 0;
    const stream = response.Body.transformToWebStream();
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      byteSize += value.byteLength;
    }
    return {
      sha256: hash.digest("hex"),
      byteSize,
      contentType: response.ContentType ?? "application/octet-stream",
    };
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
    getSignedReadUrl,
    getSignedReadUrls,
    getSignedUploadUrl,
    headObject,
    getObjectRange,
    copyObject,
    digestObject,
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
