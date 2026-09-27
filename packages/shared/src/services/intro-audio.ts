import { findLibraryTrack, parseAudioRef } from "../audio";
import type { AudioAssetStore, AudioBlobStore } from "./audio-assets";

/**
 * Narración de la introducción de la sala (encargo "audio de la
 * introducción"): usa la MISMA referencia estable que `LocalizedText.audioUrl`
 * de diálogos/pistas (`library:<id>` / `upload:<uuid>`, o la clave publicada
 * `r2://…` que escribe `room-publish`), así que se resuelve contra el mismo
 * `audioAsset` (subidas propias y generación con ElevenLabs) y la misma
 * biblioteca incluida — no contra `introMediaAsset` (ese es solo para el
 * vídeo/subtítulos, con su propio esquema de referencia `media:<uuid>`).
 */

/** Cómo se autoriza la resolución de una referencia de audio de la introducción:
 * - `{ kind: "published" }`: cualquier jugador de una versión publicada; solo
 *   se sirven claves publicadas (`r2://…`).
 * - `{ kind: "draft"; roomAuthorId }`: playtest de un borrador que QUIEN LLAMA
 *   ya ha autorizado — además, las subidas `upload:` de ESE autor y cualquier
 *   pista de la biblioteca (`library:`, siempre pública).
 */
export type IntroAudioAccess = { kind: "published" } | { kind: "draft"; roomAuthorId: string };

const PUBLISHED_REF_PREFIX = "r2://";

/**
 * Clave del bucket de una referencia de audio de la introducción, con la
 * autorización de `access`; `null` si la referencia no es válida, no está
 * disponible o no pertenece al autor de la sala (nunca lanza: sin audio, la
 * introducción se sigue mostrando, solo sin narración).
 */
export function createIntroAudioKeyResolver(deps: { store: Pick<AudioAssetStore, "findAsset"> }) {
  return async function resolveIntroAudioKey(
    access: IntroAudioAccess,
    ref: string,
  ): Promise<string | null> {
    if (ref.startsWith(PUBLISHED_REF_PREFIX)) {
      return access.kind === "published" ? ref.slice(PUBLISHED_REF_PREFIX.length) : null;
    }
    if (access.kind !== "draft") return null;
    const parsed = parseAudioRef(ref);
    if (!parsed) return null;
    if (parsed.source === "library") {
      return findLibraryTrack(parsed.trackId)?.storageKey ?? null;
    }
    const asset = await deps.store.findAsset(parsed.assetId);
    if (!asset || asset.status !== "approved" || asset.ownerId !== access.roomAuthorId) {
      return null;
    }
    return asset.storageKey;
  };
}

/**
 * `(ref) => URL firmada | null` para `resolveIntroModel`: nunca lanza — una
 * narración que no se puede servir hace que la introducción se muestre igual,
 * solo sin audio.
 */
export function createIntroAudioUrlResolver(
  access: IntroAudioAccess,
  deps: {
    store: Pick<AudioAssetStore, "findAsset">;
    blobs: Pick<AudioBlobStore, "signedReadUrl">;
  },
): (ref: string) => Promise<string | null> {
  const resolveKey = createIntroAudioKeyResolver(deps);
  return async (ref) => {
    const key = await resolveKey(access, ref);
    if (!key) return null;
    return deps.blobs.signedReadUrl(key).catch(() => null);
  };
}
