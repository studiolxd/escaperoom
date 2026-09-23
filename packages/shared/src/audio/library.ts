import { z } from "zod";

/**
 * Biblioteca de audio incluida (specs/15 §1): música ambiental por tema,
 * efectos y voces del narrador base, sin coste ni problemas de licencia.
 *
 * El repo solo guarda el MANIFIESTO (licencia, créditos, duración y clave de
 * almacenamiento); los binarios viven en el bucket bajo `library/audio/`. Las
 * entradas marcadas `placeholder` son de ejemplo hasta cargar las pistas
 * definitivas: el catálogo y el editor ya funcionan con ellas.
 */

export const AUDIO_KINDS = ["music", "sfx", "voice"] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

export const AudioLibraryTrackSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id en kebab-case"),
    kind: z.enum(AUDIO_KINDS),
    /** Título por idioma de UI; `en` es obligatorio como fallback. */
    title: z.object({ en: z.string().min(1) }).catchall(z.string().min(1)),
    /** Temas de sala a los que encaja (filtro del selector). */
    themes: z.array(z.string().min(1)),
    /** Idioma hablado (solo voces). */
    locale: z.string().optional(),
    durationMs: z.number().int().positive(),
    license: z.object({
      /** Identificador SPDX (`CC0-1.0`, `CC-BY-4.0`…). */
      spdx: z.string().min(1),
      url: z.url(),
      /** `true` si la licencia exige atribución visible (créditos de la sala). */
      attributionRequired: z.boolean(),
    }),
    credits: z.object({ author: z.string().min(1), source: z.string().min(1) }),
    /** Clave del objeto en el bucket (lo que resuelve la publicación, 3.9). */
    storageKey: z.string().regex(/^library\/audio\/[a-z0-9-]+\.mp3$/),
    placeholder: z.boolean().default(false),
  })
  .strict();

export type AudioLibraryTrack = z.output<typeof AudioLibraryTrackSchema>;

const PLACEHOLDER_CREDITS = {
  author: "EscapeRoom (placeholder)",
  source: "Pista de ejemplo pendiente de sustituir por la definitiva",
};
const CC0 = {
  spdx: "CC0-1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attributionRequired: false,
};

/** Manifiesto de la biblioteca incluida (validado al cargar el módulo). */
export const AUDIO_LIBRARY: readonly AudioLibraryTrack[] = z.array(AudioLibraryTrackSchema).parse([
  {
    id: "music-dungeon-ambience",
    kind: "music",
    title: { es: "Ambiente de mazmorra", en: "Dungeon ambience" },
    themes: ["medieval", "mystery"],
    durationMs: 120_000,
    license: CC0,
    credits: PLACEHOLDER_CREDITS,
    storageKey: "library/audio/music-dungeon-ambience.mp3",
    placeholder: true,
  },
  {
    id: "sfx-door-creak",
    kind: "sfx",
    title: { es: "Puerta que cruje", en: "Creaking door" },
    themes: ["medieval", "horror"],
    durationMs: 2_000,
    license: CC0,
    credits: PLACEHOLDER_CREDITS,
    storageKey: "library/audio/sfx-door-creak.mp3",
    placeholder: true,
  },
  {
    id: "sfx-success-chime",
    kind: "sfx",
    title: { es: "Acierto", en: "Success chime" },
    themes: ["any"],
    durationMs: 1_500,
    license: CC0,
    credits: PLACEHOLDER_CREDITS,
    storageKey: "library/audio/sfx-success-chime.mp3",
    placeholder: true,
  },
]);

const BY_ID = new Map(AUDIO_LIBRARY.map((t) => [t.id, t]));

export function findLibraryTrack(id: string): AudioLibraryTrack | undefined {
  return BY_ID.get(id);
}

/** Título de una pista en el idioma de la UI, con `en` como fallback. */
export function libraryTrackTitle(track: AudioLibraryTrack, uiLocale: string): string {
  return track.title[uiLocale] ?? track.title.en;
}
