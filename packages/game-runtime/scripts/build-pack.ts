import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { loadRoomPackage, toRuntimeModel, type RuntimeModel } from "../src/loader";
import {
  buildAtlasJson,
  packAtlas,
  type AtlasFrameInput,
  type PackedAtlas,
} from "../src/pack/atlas";
import { decodePng, encodePng } from "../src/pack/png";
import { checkSvgAspect, rasterizeSvg } from "../src/pack/svg";
import {
  DEFAULT_PACK_PROJECTION,
  defaultAvatarAnims,
  formatPackIssues,
  validateAtlasFrames,
  validatePackAgainstModel,
  validatePackManifest,
  type PackAnim,
  type PackManifest,
  type PackValidationIssue,
} from "../src/pack";

/**
 * `pack:build` — empaqueta una carpeta de PNG renombrados en atlas + manifest
 * (specs/26 §9). La carpeta del pack tiene esta forma:
 *
 *   packages/web/public/packs/<packId>/
 *     pack.config.json          (opcional: proyección, collides, version…)
 *     tiles/    tile-1.png, tile-2.svg, …   (suelo y tiles del mapa)
 *     sprites/  cuadro-rey.png, …           (objetos, estados, decoración)
 *     icons/    icon-llave-bronce.png, …    (iconos de inventario)
 *     avatar/   avatar-n-idle-1.png, …      (atlas de avatar)
 *     fx/       fx-spark-1.png, …           (brillo reutilizable)
 *
 * Acepta fuentes en `.png` y en `.svg` (los SVG se rasterizan con `sharp` al
 * tamaño de lienzo que indique `pack.config.sizes` o `svgSizes`).
 *
 * Genera `atlas-<kind>.png`, `atlas-<kind>.json` y `manifest.json` dentro de la
 * carpeta, y valida el resultado contra el `RoomPackage` del Rey Aldric (o el
 * que se pase con `--room`). Uso:
 *
 *   pnpm pack:build medieval-v1
 *   pnpm pack:build medieval-v1 --check
 *   pnpm pack:build --pack ./packages/web/public/packs/medieval-v1 --room docs/reference/roompackage-rey-aldric.v1.json
 */

const KINDS = ["tiles", "sprites", "icons", "avatar", "fx"] as const;
type Kind = (typeof KINDS)[number];

const DEFAULT_ROOM = "docs/reference/roompackage-rey-aldric.v1.json";
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

interface PackConfig {
  id?: string;
  version?: string;
  packageFormat?: string;
  projection?: { tileWidth: number; tileHeight: number; scale: number };
  /** tileId → ¿colisiona? El manifiesto lo declara explícitamente. */
  collides?: Record<string, boolean>;
  /** Ancho máximo de cada atlas. */
  atlasMaxWidth?: number;
  padding?: number;
  /** Animaciones explícitas que sustituyen a las derivadas de los nombres. */
  anims?: PackAnim[];
}

interface CliOptions {
  packDir: string;
  roomPath: string;
  check: boolean;
  allowMissing: boolean;
}

function findRepoRoot(start: string): string {
  let current = resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`No se encontró la raíz del monorepo (pnpm-workspace.yaml) desde "${start}".`);
}

function parseArgs(argv: string[]): CliOptions {
  const repoRoot = findRepoRoot(process.cwd());
  let packDir: string | undefined;
  let roomPath = join(repoRoot, DEFAULT_ROOM);
  let check = false;
  let allowMissing = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      check = true;
    } else if (arg === "--allow-missing") {
      allowMissing = true;
    } else if (arg === "--pack") {
      packDir = resolve(repoRoot, argv[++i] ?? "");
    } else if (arg === "--room") {
      roomPath = resolve(repoRoot, argv[++i] ?? "");
    } else if (arg && !arg.startsWith("--")) {
      packDir = join(repoRoot, "packages/web/public/packs", arg);
    }
  }

  if (!packDir) {
    throw new Error(
      "Falta el pack. Uso: pnpm pack:build <packId> (o --pack <carpeta>) [--room <json>] [--check].",
    );
  }

  return { packDir, roomPath, check, allowMissing };
}

async function readConfig(packDir: string): Promise<PackConfig> {
  const configPath = join(packDir, "pack.config.json");
  if (!existsSync(configPath)) {
    return {};
  }
  return JSON.parse(await readFile(configPath, "utf8")) as PackConfig;
}

function isImageEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".png") || lower.endsWith(".svg");
}

async function readKindFrames(
  packDir: string,
  kind: Kind,
): Promise<{ frames: AtlasFrameInput[]; issues: PackValidationIssue[] }> {
  const dir = join(packDir, kind);
  if (!existsSync(dir)) {
    return { frames: [], issues: [] };
  }

  const entries = (await readdir(dir)).filter(isImageEntry).sort();
  const frames: AtlasFrameInput[] = [];
  const issues: PackValidationIssue[] = [];

  for (const entry of entries) {
    const isSvg = entry.toLowerCase().endsWith(".svg");
    const frame = basename(entry, isSvg ? ".svg" : ".png");
    let decoded;
    if (isSvg) {
      const svg = await readFile(join(dir, entry), "utf8");
      const aspectIssue = checkSvgAspect(svg, frame);
      if (aspectIssue) {
        issues.push({ path: `${kind}/${entry}`, message: aspectIssue, severity: "warning" });
      }
      decoded = await rasterizeSvg(svg, frame);
    } else {
      decoded = decodePng(await readFile(join(dir, entry)));
    }
    frames.push({ frame, width: decoded.width, height: decoded.height, rgba: decoded.rgba });
  }

  return { frames, issues };
}

function frameIndex(frame: string): number {
  const match = frame.match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

/** Deriva las animaciones del avatar de los nombres de frame presentes. */
function deriveAvatarAnims(frames: string[], overrides: PackAnim[]): PackAnim[] {
  const anims: PackAnim[] = [];
  for (const base of defaultAvatarAnims()) {
    const override = overrides.find((anim) => anim.key === base.key);
    if (override) {
      anims.push(override);
      continue;
    }
    const matched = frames
      .filter((frame) => frame.startsWith(`${base.key}-`))
      .sort((a, b) => frameIndex(a) - frameIndex(b));
    if (matched.length > 0) {
      anims.push({ ...base, frames: matched });
    }
  }
  return anims;
}

function buildManifest(
  config: PackConfig,
  packId: string,
  atlases: { key: Kind; atlas: PackedAtlas }[],
  framesByKind: Record<Kind, string[]>,
  issues: PackValidationIssue[],
): PackManifest {
  const tiles: PackManifest["tiles"] = {};
  for (const frame of framesByKind.tiles) {
    const match = frame.match(/^tile-(\d+)$/);
    if (!match) {
      issues.push({
        path: `tiles/${frame}.png`,
        message: `el nombre "${frame}" no sigue el patrón "tile-<id>"; no se incluirá en manifest.tiles.`,
        severity: "error",
      });
      continue;
    }
    const tileId = match[1]!;
    if (tileId === "0") {
      issues.push({
        path: `tiles/${frame}.png`,
        message: 'el tileId "0" está reservado para la celda vacía; renómbralo.',
        severity: "error",
      });
      continue;
    }
    const collides = config.collides?.[tileId];
    if (collides === undefined) {
      issues.push({
        path: `pack.config.json`,
        message: `falta "collides" para el tileId ${tileId} en pack.config.json; se asume false.`,
        severity: "warning",
      });
    }
    tiles[tileId] = { frame, collides: collides ?? false };
  }

  const sprites: PackManifest["sprites"] = {};
  for (const frame of framesByKind.sprites) {
    sprites[frame] = { frame };
  }

  const icons: Record<string, string> = {};
  for (const frame of framesByKind.icons) {
    icons[frame] = frame;
  }

  const fxSpark = framesByKind.fx[0] ?? "fx-spark";

  return {
    id: config.id ?? packId,
    version: config.version ?? "1.0.0",
    packageFormat: config.packageFormat ?? "1",
    projection: config.projection ?? DEFAULT_PACK_PROJECTION,
    atlases: atlases.map(({ key }) => ({
      key,
      image: `atlas-${key}.png`,
      data: `atlas-${key}.json`,
    })),
    tiles,
    sprites,
    anims: deriveAvatarAnims(framesByKind.avatar, config.anims ?? []),
    ui: { icons },
    fx: { spark: fxSpark },
    keys: atlases.map(({ key }) => key),
  };
}

function checkNames(packDir: string, framesByKind: Record<Kind, string[]>): PackValidationIssue[] {
  const issues: PackValidationIssue[] = [];
  for (const kind of KINDS) {
    for (const frame of framesByKind[kind]) {
      if (!NAME_PATTERN.test(frame)) {
        issues.push({
          path: `${kind}/${frame}.png`,
          message: `nombre de frame inválido "${frame}": usa minúsculas, dígitos y guiones.`,
          severity: "warning",
        });
      }
    }
  }
  if (framesByKind.avatar.length > 0 && framesByKind.avatar.length < 28) {
    issues.push({
      path: "avatar",
      message: `el atlas de avatar tiene ${framesByKind.avatar.length} frames; el mínimo de v1 es 28 (idle/walk/interact ×4 direcciones).`,
      severity: "warning",
    });
  }
  if (packDir.length === 0) {
    issues.push({ path: "pack", message: "carpeta de pack vacía.", severity: "error" });
  }
  return issues;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const packId = basename(options.packDir);
  const config = await readConfig(options.packDir);

  const framesByKind = {} as Record<Kind, string[]>;
  const atlases: { key: Kind; atlas: PackedAtlas }[] = [];
  const issues: PackValidationIssue[] = [];

  await mkdir(options.packDir, { recursive: true });

  for (const kind of KINDS) {
    const { frames, issues: frameIssues } = await readKindFrames(options.packDir, kind);
    issues.push(...frameIssues);
    framesByKind[kind] = frames.map((frame) => frame.frame);
    if (frames.length === 0) {
      continue;
    }
    const atlas = packAtlas(frames, {
      maxWidth: config.atlasMaxWidth ?? 2048,
      padding: config.padding ?? 2,
    });
    atlases.push({ key: kind, atlas });
    if (!options.check) {
      await writeFile(join(options.packDir, `atlas-${kind}.png`), encodePng(atlas));
      await writeFile(
        join(options.packDir, `atlas-${kind}.json`),
        `${JSON.stringify(buildAtlasJson(`atlas-${kind}.png`, atlas), null, 2)}\n`,
      );
    }
  }

  issues.push(...checkNames(options.packDir, framesByKind));

  const manifest = buildManifest(config, packId, atlases, framesByKind, issues);
  const structural = validatePackManifest(manifest);
  issues.push(...structural.issues);

  const model = await loadRoom(options.roomPath);
  issues.push(...validatePackAgainstModel(manifest, model));

  const framesByAtlas: Record<string, Set<string>> = {};
  for (const { key, atlas } of atlases) {
    framesByAtlas[key] = new Set(atlas.frames.map((frame) => frame.frame));
  }
  issues.push(...validateAtlasFrames(manifest, framesByAtlas));

  const blocking = issues.filter(
    (issue) => issue.severity === "error" && !(options.allowMissing && isMissingFrame(issue)),
  );

  if (!options.check) {
    await writeFile(
      join(options.packDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  report(packId, options, atlases, framesByKind, issues);

  if (blocking.length > 0) {
    process.exitCode = 1;
  }
}

function isMissingFrame(issue: PackValidationIssue): boolean {
  return /falta (el frame|la entrada)/.test(issue.message);
}

async function loadRoom(roomPath: string): Promise<RuntimeModel> {
  const raw: unknown = JSON.parse(await readFile(roomPath, "utf8"));
  return toRuntimeModel(loadRoomPackage(raw));
}

function report(
  packId: string,
  options: CliOptions,
  atlases: { key: Kind; atlas: PackedAtlas }[],
  framesByKind: Record<Kind, string[]>,
  issues: PackValidationIssue[],
): void {
  const count = KINDS.reduce((total, kind) => total + framesByKind[kind].length, 0);
  console.log(
    `\nPack "${packId}" — ${count} frames en ${atlases.length} atlas${options.check ? " (solo validación)" : ""}`,
  );
  for (const { key, atlas } of atlases) {
    console.log(
      `  • ${key}: ${atlas.frames.length} frames → atlas-${key}.png (${atlas.width}×${atlas.height})`,
    );
  }
  if (issues.length > 0) {
    console.log(`\n${formatPackIssues(issues)}\n`);
  } else {
    console.log("  Sin incidencias.\n");
  }
  console.log(
    options.check
      ? "Validación completada (no se escribió nada)."
      : "Escrito manifest.json + atlas. La validación visual la hace una persona.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
