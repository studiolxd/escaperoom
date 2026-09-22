import Phaser from "phaser";
import type { PackManifest } from "../pack";

/**
 * Resolución de frames en la capa Phaser. Primero busca el frame en los atlas
 * del pack ya cargados (por `manifest.keys`); si no existe, genera **en
 * memoria** una textura procedural con el nombre del frame (placeholder
 * automático, specs/26 §1). Cuando el pack real está presente, los frames se
 * resuelven desde el atlas y el placeholder no se usa: no hay que tocar código.
 */

const PLACEHOLDER_PREFIX = "placeholder:";
const DEFAULT_PLACEHOLDER = { width: 64, height: 64 };

export interface FrameSize {
  width: number;
  height: number;
}

/** Referencia lista para `add.image(x, y, key, frame)`. */
export interface FrameRef {
  key: string;
  frame?: string;
}

export class PackFrameResolver {
  private readonly scene: Phaser.Scene;
  private readonly manifest?: PackManifest;
  private readonly atlasKeys: string[];
  private readonly placeholders = new Set<string>();

  constructor(scene: Phaser.Scene, manifest?: PackManifest) {
    this.scene = scene;
    this.manifest = manifest;
    this.atlasKeys = manifest?.keys ?? [];
  }

  get hasPack(): boolean {
    return this.atlasKeys.some((key) => this.scene.textures.exists(key));
  }

  /** ¿Existe el frame en algún atlas del pack? */
  hasFrame(frame: string): boolean {
    return this.findInPack(frame) !== undefined;
  }

  /**
   * Devuelve la textura y el frame para `frame`; si no está en el pack,
   * garantiza un placeholder procedural con ese nombre.
   */
  resolve(frame: string, size: FrameSize = DEFAULT_PLACEHOLDER): FrameRef {
    const packed = this.findInPack(frame);
    if (packed) {
      return packed;
    }
    return { key: this.ensurePlaceholder(frame, size) };
  }

  private findInPack(frame: string): FrameRef | undefined {
    for (const key of this.atlasKeys) {
      if (!this.scene.textures.exists(key)) {
        continue;
      }
      const texture = this.scene.textures.get(key);
      if (texture.has(frame)) {
        return { key, frame };
      }
    }
    return undefined;
  }

  private ensurePlaceholder(frame: string, size: FrameSize): string {
    const key = PLACEHOLDER_PREFIX + frame;
    if (this.placeholders.has(key) || this.scene.textures.exists(key)) {
      this.placeholders.add(key);
      return key;
    }

    const texture = this.scene.textures.createCanvas(key, size.width, size.height);
    if (!texture) {
      throw new Error(`PackFrameResolver: no se pudo crear el placeholder de "${frame}".`);
    }

    const context = texture.getContext();
    const { fill, stroke } = placeholderColors(frame);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = fill;
    context.globalAlpha = 0.92;
    context.fillRect(0, 0, size.width, size.height);
    context.globalAlpha = 1;
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.strokeRect(1, 1, size.width - 2, size.height - 2);

    context.fillStyle = "#0b1120";
    context.font = `bold ${Math.max(9, Math.round(size.width / 7))}px ui-monospace, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lines = wrapLabel(frame);
    const lineHeight = Math.max(11, Math.round(size.width / 6));
    const startY = size.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      context.fillText(line, size.width / 2, startY + index * lineHeight);
    });

    texture.refresh();
    this.placeholders.add(key);
    return key;
  }
}

function placeholderColors(frame: string): { fill: string; stroke: string } {
  let hash = 0;
  for (let i = 0; i < frame.length; i += 1) {
    hash = (hash * 31 + frame.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const color = Phaser.Display.Color.HSVToRGB(hue / 360, 0.35, 0.72) as {
    r: number;
    g: number;
    b: number;
  };
  const dark = Phaser.Display.Color.HSVToRGB(hue / 360, 0.55, 0.42) as {
    r: number;
    g: number;
    b: number;
  };
  return {
    fill: `rgb(${color.r}, ${color.g}, ${color.b})`,
    stroke: `rgb(${dark.r}, ${dark.g}, ${dark.b})`,
  };
}

function wrapLabel(frame: string, maxChars = 11): string[] {
  const parts = frame.split("-");
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    const candidate = line ? `${line}-${part}` : part;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = part;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.slice(0, 4);
}
