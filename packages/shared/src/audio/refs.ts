/**
 * Referencias de audio del borrador. Lo que el editor guarda en
 * `LocalizedText.audioUrl` (specs/08 §2.2) y en los efectos de sonido NO es una
 * URL firmada (caduca) sino una referencia estable a la fuente:
 *
 * - `library:<trackId>` — pista de la biblioteca incluida;
 * - `upload:<uuid>` — audio subido por el creador (`audioAsset`).
 *
 * La publicación (3.9) las resuelve a la clave del bucket al empaquetar los
 * assets; el formato RoomPackage no cambia (`audioUrl` sigue siendo un string).
 */

export type AudioRef =
  | { source: "library"; trackId: string }
  | { source: "upload"; assetId: string };

const LIBRARY_RE = /^library:([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const UPLOAD_RE = /^upload:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Interpreta una referencia; `null` si no tiene forma válida. */
export function parseAudioRef(value: string): AudioRef | null {
  const lib = LIBRARY_RE.exec(value);
  if (lib) return { source: "library", trackId: lib[1]! };
  const up = UPLOAD_RE.exec(value);
  if (up) return { source: "upload", assetId: up[1]!.toLowerCase() };
  return null;
}

export function formatAudioRef(ref: AudioRef): string {
  return ref.source === "library" ? `library:${ref.trackId}` : `upload:${ref.assetId}`;
}

export const libraryAudioRef = (trackId: string): string => `library:${trackId}`;
export const uploadAudioRef = (assetId: string): string => `upload:${assetId}`;
