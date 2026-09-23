import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import {
  buildEditorPalette,
  safeParsePackManifest,
  type EditorPalette,
  type PackManifest,
  type PaletteManifestInput,
} from "@escaperoom/game-runtime";
import { PACKS_PUBLIC_DIR, type RoomPreviewPack } from "./room-preview-pack";
import { findRepoRoot } from "./repo-root";

/**
 * Palette del editor (ticket 3.1) a partir del pack gráfico de la sala
 * (`medieval-v1`). Solo servidor: lee `public/packs/<tileset>/`.
 *
 * - Si existe `manifest.json` (generado con `pnpm pack:build`) y es válido, la
 *   palette sale de él y el runtime carga sus atlas (`pack`).
 * - Si no (p. ej. en CI, donde el manifiesto no se versiona), se deriva de las
 *   fuentes del pack: `tiles/tile-<n>.svg|png` con la colisión de
 *   `pack.config.json`, y `sprites/*.svg|png`. El runtime pinta entonces
 *   placeholders con el nombre de cada frame.
 *
 * Las miniaturas de la UI apuntan a las fuentes del pack (`/packs/<id>/…`).
 */

export const DEFAULT_TILESET = "medieval-v1";

const SOURCE_EXTENSIONS = [".svg", ".png"] as const;

export interface EditorPaletteResult {
  palette: EditorPalette;
  /** Pack con atlas para el runtime, si hay manifiesto generado. */
  pack?: RoomPreviewPack;
}

export interface ResolveEditorPaletteOptions {
  cwd?: string;
  /** Raíz de packs (por defecto `packages/web/public/packs` del repo). */
  packsRoot?: string;
}

function listSources(dir: string): Map<string, string> {
  const names = new Map<string, string>();
  if (!existsSync(dir)) return names;
  for (const file of readdirSync(dir).sort()) {
    const ext = extname(file);
    if (!(SOURCE_EXTENSIONS as readonly string[]).includes(ext)) continue;
    const name = file.slice(0, -ext.length);
    if (!names.has(name)) names.set(name, file);
  }
  return names;
}

function readManifest(packDir: string): PackManifest | undefined {
  const path = join(packDir, "manifest.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = safeParsePackManifest(JSON.parse(readFileSync(path, "utf8")) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Manifiesto mínimo (tiles + sprites) derivado de las fuentes del pack. */
export function manifestFromSources(packDir: string, packId: string): PaletteManifestInput {
  let collides: Record<string, boolean> = {};
  const configPath = join(packDir, "pack.config.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        collides?: Record<string, boolean>;
      };
      collides = config.collides ?? {};
    } catch {
      collides = {};
    }
  }

  const tiles: PaletteManifestInput["tiles"] = {};
  for (const name of listSources(join(packDir, "tiles")).keys()) {
    const match = /^tile-(\d+)$/.exec(name);
    if (!match || match[1] === "0") continue;
    tiles[match[1] as string] = { frame: name, collides: collides[match[1] as string] ?? false };
  }

  const sprites: PaletteManifestInput["sprites"] = {};
  for (const name of listSources(join(packDir, "sprites")).keys()) {
    sprites[name] = { frame: name };
  }

  return { id: packId, tiles, sprites };
}

export function resolveEditorPalette(
  tileset: string = DEFAULT_TILESET,
  options: ResolveEditorPaletteOptions = {},
): EditorPaletteResult {
  const packsRoot =
    options.packsRoot ?? join(findRepoRoot(options.cwd ?? process.cwd()), PACKS_PUBLIC_DIR);
  const packDir = join(packsRoot, tileset);
  const sources = {
    tiles: listSources(join(packDir, "tiles")),
    sprites: listSources(join(packDir, "sprites")),
  };
  const thumbnail = (kind: "tiles" | "sprites", frame: string) => {
    const file = sources[kind].get(frame);
    return file ? `/packs/${tileset}/${kind}/${file}` : undefined;
  };

  const manifest = readManifest(packDir);
  if (manifest) {
    return {
      palette: buildEditorPalette(manifest, { thumbnail }),
      pack: { manifest, baseUrl: `/packs/${tileset}` },
    };
  }
  return { palette: buildEditorPalette(manifestFromSources(packDir, tileset), { thumbnail }) };
}
