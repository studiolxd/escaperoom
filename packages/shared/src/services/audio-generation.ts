import { createHash } from "node:crypto";
import { z } from "zod";
import {
  calculateAudioGenerationCost,
  CHARACTERS_PER_CREDIT,
  MAX_GENERATION_CHARACTERS,
} from "../audio/limits";
import { parseMp3 } from "../audio/mp3";
import { uploadAudioRef } from "../audio/refs";
import type { Actor } from "./actor";
import { requireUser } from "./common";
import { type AudioAssetRow, type AudioAssetStore, type AudioBlobStore } from "./audio-assets";
import { InsufficientCreditsError, type CreditsService } from "./credits";
import { ElevenLabsError, type ElevenLabsClient } from "./elevenlabs-client";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";

/**
 * Generación de audio por IA (ticket 4.9, specs/15 §2-4): coste en créditos →
 * comprobación de saldo → síntesis con ElevenLabs → subida a storage → alta en
 * `audioAsset` (misma tabla que la subida manual, ticket 3.11), `approved` y
 * disponible al instante (decisión de 2026-09-26, ADR-039) → cobro del
 * movimiento **solo si todo lo anterior tuvo éxito**. La referencia resultante
 * es `upload:<id>`, la misma que usan las subidas: el resto del sistema
 * (publicación, editor) no distingue el origen.
 *
 * La previsualización llama a ElevenLabs pero no toca el ledger ni almacena
 * nada (specs/15 §3): solo devuelve los bytes para escuchar antes de confirmar.
 *
 * El coste (`calculateAudioGenerationCost`) y el límite de caracteres viven en
 * `../audio/limits` (subpath seguro para cliente, `@escaperoom/shared/audio`)
 * y se re-exportan aquí para no romper a quien ya los importaba de este
 * módulo.
 */
export { calculateAudioGenerationCost, CHARACTERS_PER_CREDIT, MAX_GENERATION_CHARACTERS };

export type AudioGenerationErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "INSUFFICIENT_CREDITS";

export class AudioGenerationError extends Error {
  readonly code: AudioGenerationErrorCode;
  readonly issues: ReadableIssue[];
  constructor(code: AudioGenerationErrorCode, message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "AudioGenerationError";
    this.code = code;
    this.issues = issues;
  }
}

const TextInput = z
  .string()
  .trim()
  .min(1, "El texto no puede estar vacío")
  .max(MAX_GENERATION_CHARACTERS, `El texto no puede superar ${MAX_GENERATION_CHARACTERS} caracteres`);

export const AudioPreviewInput = z.object({ text: TextInput }).strict();

export const AudioGenerationConfirmInput = z
  .object({
    text: TextInput,
    /** `{dialogId|hintId}:{locale}` (specs/15 §2.1): a qué campo se destina el audio. */
    referenceId: z.string().trim().min(1).max(200),
  })
  .strict();

export type AudioPreviewResult = {
  costCredits: number;
  characterCount: number;
  /** Bytes del MP3 (sin almacenar): la UI los reproduce directamente. */
  audio: Uint8Array;
  contentType: string;
};

export type AudioGenerationResult = {
  asset: AudioAssetRow;
  ref: string;
  costCredits: number;
  balanceAfter: bigint;
};

/** Bytes cacheados de una previsualización, por hash de texto+voz (B-7). */
export type CachedAudioPreview = { audio: Uint8Array; contentType: string };

/**
 * Caché de previsualizaciones por hash de `texto + voz` (B-7): la preview es
 * gratis y no descuenta créditos, así que sin caché cada repetición del mismo
 * texto (el creador prueba, ajusta, prueba igual) es una llamada de pago a
 * ElevenLabs. `null` en `get` = no cacheado o caché no disponible (Redis
 * caído): se sintetiza igual, nunca bloquea la preview.
 */
export interface AudioPreviewCache {
  get(key: string): Promise<CachedAudioPreview | null>;
  set(key: string, value: CachedAudioPreview): Promise<void>;
}

/** Caché no-op: por defecto, si no se inyecta una real. */
export function createNoopAudioPreviewCache(): AudioPreviewCache {
  return {
    async get() {
      return null;
    },
    async set() {
      // no-op
    },
  };
}

function requireSession(actor: Actor): void {
  requireUser(actor, AudioGenerationError);
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AudioGenerationError("VALIDATION_ERROR", "Datos no válidos", toReadableIssues(parsed.error));
  }
  return parsed.data;
}

export type AudioGenerationConfig = { voiceId: string };

export function createAudioGenerationService(deps: {
  elevenlabs: ElevenLabsClient;
  credits: CreditsService;
  store: AudioAssetStore;
  blobs: AudioBlobStore;
  config: AudioGenerationConfig;
  /** Caché de previsualizaciones por hash de texto+voz (B-7). Sin ella, no cachea. */
  previewCache?: AudioPreviewCache;
  now?: () => Date;
  newId?: () => string;
}) {
  const { elevenlabs, credits, store, blobs, config } = deps;
  const previewCache = deps.previewCache ?? createNoopAudioPreviewCache();
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());

  /** Clave de caché: hash de texto+voz, no el texto en claro (B-7). */
  function previewCacheKey(text: string): string {
    return createHash("sha256").update(config.voiceId).update("\u0000").update(text).digest("hex");
  }

  async function synthesize(text: string): Promise<Uint8Array> {
    try {
      const { bytes } = await elevenlabs.synthesize({ text, voiceId: config.voiceId });
      return bytes;
    } catch (err) {
      if (err instanceof ElevenLabsError) {
        throw new AudioGenerationError("PROVIDER_ERROR", `ElevenLabs: ${err.message}`);
      }
      throw err;
    }
  }

  return {
    /** Coste sin efectos secundarios: lo usa la UI para mostrarlo antes de generar. */
    estimateCost(text: string): number {
      return calculateAudioGenerationCost(text.trim().length);
    },

    /**
     * Previsualización: sintetiza con ElevenLabs y devuelve los bytes SIN
     * almacenar ni cobrar (specs/15 §3). Si el saldo no llega, falla antes de
     * llamar a ElevenLabs (no malgasta la llamada de un creador que no podrá
     * confirmar).
     */
    async preview(actor: Actor, input: unknown): Promise<AudioPreviewResult> {
      requireSession(actor);
      const { text } = parseOrThrow(AudioPreviewInput, input);
      const costCredits = calculateAudioGenerationCost(text.length);
      if (!(await credits.hasSufficientBalance(actor, BigInt(costCredits)))) {
        throw new AudioGenerationError(
          "INSUFFICIENT_CREDITS",
          `Hacen falta ${costCredits} créditos para generar este audio`,
        );
      }
      const cacheKey = previewCacheKey(text);
      const cached = await previewCache.get(cacheKey);
      if (cached) {
        return { costCredits, characterCount: text.length, ...cached };
      }
      const audio = await synthesize(text);
      const contentType = "audio/mpeg";
      await previewCache.set(cacheKey, { audio, contentType });
      return { costCredits, characterCount: text.length, audio, contentType };
    },

    /**
     * Confirmación: sintetiza, sube a storage, da de alta el `audioAsset`
     * (`approved`, disponible al instante) y SOLO entonces cobra el
     * movimiento de créditos. Si falla cualquier paso antes del cobro, no se
     * descuenta nada; si el cobro falla (saldo agotado entre la comprobación y
     * el cobro, carrera de dos generaciones a la vez), se deshace la subida.
     */
    async confirm(actor: Actor, input: unknown): Promise<AudioGenerationResult> {
      requireSession(actor);
      const { text, referenceId } = parseOrThrow(AudioGenerationConfirmInput, input);
      const costCredits = calculateAudioGenerationCost(text.length);
      if (!(await credits.hasSufficientBalance(actor, BigInt(costCredits)))) {
        throw new AudioGenerationError(
          "INSUFFICIENT_CREDITS",
          `Hacen falta ${costCredits} créditos para generar este audio`,
        );
      }

      const bytes = await synthesize(text);
      const mp3 = parseMp3(bytes);
      const durationMs = mp3?.durationMs ?? 0;

      const id = newId();
      const storageKey = `generated/audio/${actor.userId}/${id}.mp3`;
      await blobs.put(storageKey, bytes, "audio/mpeg");

      let asset: AudioAssetRow;
      try {
        asset = await store.insertAsset({
          id,
          ownerId: actor.userId,
          organizationId: actor.organizationId,
          storageKey,
          originalFilename: `${id}.mp3`,
          contentType: "audio/mpeg",
          byteSize: bytes.byteLength,
          durationMs,
          rightsDeclaredAt: now(),
          source: "ai_generated",
          generationText: text,
          generationVoiceId: config.voiceId,
          generationCreditsCost: costCredits,
        });
      } catch (err) {
        await blobs.delete(storageKey).catch(() => undefined);
        throw err;
      }

      try {
        const { balanceAfter } = await credits.consume(actor, BigInt(costCredits), {
          referenceType: "audio_generation",
          referenceId,
          metadata: { assetId: asset.id, characterCount: text.length },
        });
        return { asset, ref: uploadAudioRef(asset.id), costCredits, balanceAfter };
      } catch (err) {
        // El asset ya está insertado (y ya disponible) pero, si no se puede
        // cobrar, no debe quedar disponible ni facturarse: se deshace.
        await blobs.delete(storageKey).catch(() => undefined);
        await store.deleteAsset(asset.id).catch(() => undefined);
        if (err instanceof InsufficientCreditsError) {
          throw new AudioGenerationError("INSUFFICIENT_CREDITS", err.message);
        }
        throw err;
      }
    },
  };
}

export type AudioGenerationService = ReturnType<typeof createAudioGenerationService>;
