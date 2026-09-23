import type { PackManifest } from "../pack";

/**
 * Palette del editor (specs/09 §3, pasos 1–2) derivada del manifiesto del pack
 * gráfico (`medieval-v1`): tiles pintables y sprites colocables. Es un catálogo
 * estático: no conoce el estado de la sala (specs/09 §4.1).
 */

/** Capas de tiles del editor: suelo, muro y decoración. */
export const EDITOR_LAYERS = ["ground", "walls", "decor"] as const;
export type EditorLayer = (typeof EDITOR_LAYERS)[number];

export interface PaletteTile {
  tileId: number;
  frame: string;
  collides: boolean;
  /** Capa en la que se pinta por defecto (muro si colisiona, suelo si no). */
  layer: EditorLayer;
  /** Miniatura para la UI (fuente del pack), si se conoce. */
  thumbnail?: string;
}

export interface PaletteSprite {
  sprite: string;
  frame: string;
  thumbnail?: string;
}

export interface EditorPalette {
  packId: string;
  tiles: PaletteTile[];
  sprites: PaletteSprite[];
}

/** Lo que la palette necesita del manifiesto (el manifest completo también vale). */
export type PaletteManifestInput = Pick<PackManifest, "id" | "tiles" | "sprites">;

export interface BuildEditorPaletteOptions {
  /** URL de la miniatura de un frame (p. ej. el SVG fuente del pack). */
  thumbnail?: (kind: "tiles" | "sprites", frame: string) => string | undefined;
}

/**
 * Tiles en orden numérico y sprites en orden alfabético. Los tiles que
 * colisionan se proponen para la capa de muros; el resto, para el suelo.
 */
export function buildEditorPalette(
  manifest: PaletteManifestInput,
  options: BuildEditorPaletteOptions = {},
): EditorPalette {
  const tiles = Object.entries(manifest.tiles)
    .map(([id, entry]) => ({ tileId: Number(id), entry }))
    .filter(({ tileId }) => Number.isInteger(tileId) && tileId > 0)
    .sort((a, b) => a.tileId - b.tileId)
    .map(({ tileId, entry }) => {
      const thumbnail = options.thumbnail?.("tiles", entry.frame);
      return {
        tileId,
        frame: entry.frame,
        collides: entry.collides,
        layer: (entry.collides ? "walls" : "ground") as EditorLayer,
        ...(thumbnail ? { thumbnail } : {}),
      };
    });

  const sprites = Object.entries(manifest.sprites)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sprite, entry]) => {
      const thumbnail = options.thumbnail?.("sprites", entry.frame);
      return { sprite, frame: entry.frame, ...(thumbnail ? { thumbnail } : {}) };
    });

  return { packId: manifest.id, tiles, sprites };
}
