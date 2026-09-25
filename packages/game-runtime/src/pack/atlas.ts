/**
 * Empaquetado de atlas para `pack:build` (specs/26 §3.2). Compone una imagen a
 * partir de los PNG por frame y genera el JSON en formato Phaser
 * (`TexturePacker`, hash): `trim: false`, `rotation: false` y padding.
 *
 * Puro salvo por el uso de `Buffer` de Node; no se exporta desde el runtime del
 * navegador.
 */

export interface AtlasFrameInput {
  /** Nombre exacto del frame (el del `RoomPackage`). */
  frame: string;
  width: number;
  height: number;
  /** Píxeles RGBA de 8 bits, `width * height * 4` bytes. */
  rgba: Uint8Array;
}

export interface PackedFrame {
  frame: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackedAtlas {
  width: number;
  height: number;
  rgba: Uint8Array;
  frames: PackedFrame[];
}

export interface PackAtlasOptions {
  /** Ancho máximo del atlas en píxeles (se amplía si un frame no cabe). */
  maxWidth?: number;
  /** Separación entre frames y con el borde. */
  padding?: number;
}

interface Shelf {
  y: number;
  height: number;
  cursor: number;
}

/** Empaqueta frames en un atlas por estanterías (shelf packing). */
export function packAtlas(
  input: readonly AtlasFrameInput[],
  options: PackAtlasOptions = {},
): PackedAtlas {
  const padding = options.padding ?? 2;
  const widest = input.reduce((max, frame) => Math.max(max, frame.width), 0);
  const maxWidth = Math.max(options.maxWidth ?? 2048, widest + padding * 2);

  const ordered = [...input].sort(
    (a, b) => b.height - a.height || b.width - a.width || a.frame.localeCompare(b.frame),
  );

  const frames: PackedFrame[] = [];
  let current: Shelf = { y: padding, height: 0, cursor: padding };
  let usedWidth = 0;
  let usedHeight = 0;

  for (const frame of ordered) {
    if (current.cursor + frame.width + padding > maxWidth && current.cursor > padding) {
      current = { y: current.y + current.height + padding, height: 0, cursor: padding };
    }
    frames.push({
      frame: frame.frame,
      x: current.cursor,
      y: current.y,
      width: frame.width,
      height: frame.height,
    });
    current.cursor += frame.width + padding;
    current.height = Math.max(current.height, frame.height);
    usedWidth = Math.max(usedWidth, current.cursor);
    usedHeight = Math.max(usedHeight, current.y + current.height);
  }

  const width = Math.max(1, usedWidth);
  const height = Math.max(1, usedHeight + padding);
  const rgba = new Uint8Array(width * height * 4);

  // D-28: `input.find` por frame dentro de este bucle era O(n²) (un pack de
  // ~250 frames ya hace ~30k comparaciones); con un mapa por nombre queda en
  // O(n). Los nombres de frame son únicos (lo exige `checkNames`), así que
  // el mapa no pierde información frente al `find`.
  const byFrame = new Map(input.map((candidate) => [candidate.frame, candidate]));
  for (const frame of frames) {
    const source = byFrame.get(frame.frame);
    if (!source) {
      continue;
    }
    blit(rgba, width, frame, source.rgba);
  }

  return { width, height, rgba, frames };
}

function blit(
  target: Uint8Array,
  targetWidth: number,
  frame: PackedFrame,
  source: Uint8Array,
): void {
  for (let y = 0; y < frame.height; y += 1) {
    const sourceRow = y * frame.width * 4;
    const targetRow = ((frame.y + y) * targetWidth + frame.x) * 4;
    for (let x = 0; x < frame.width * 4; x += 1) {
      target[targetRow + x] = source[sourceRow + x]!;
    }
  }
}

/** JSON de atlas en formato Phaser (TexturePacker hash), sin trim ni rotación. */
export function buildAtlasJson(imageFileName: string, atlas: PackedAtlas): unknown {
  const frames: Record<string, unknown> = {};
  for (const frame of atlas.frames) {
    frames[frame.frame] = {
      frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.width, h: frame.height },
      sourceSize: { w: frame.width, h: frame.height },
    };
  }

  return {
    frames,
    meta: {
      app: "escaperoom-pack-build",
      version: "1",
      image: imageFileName,
      format: "RGBA8888",
      size: { w: atlas.width, h: atlas.height },
      scale: "1",
    },
  };
}
