import { deflateSync, inflateSync } from "node:zlib";

/**
 * Códec PNG mínimo y sin dependencias (Node `zlib`), usado por `pack:build`
 * para leer los PNG por frame y componer los atlas. Soporta lo que produce un
 * estudio gráfico (PNG-24/32, 8 o 16 bits, sin entrelazar) y escribe RGBA-8.
 *
 * No forma parte del runtime del navegador: `src/pack/index.ts` no lo exporta.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DecodedPng {
  width: number;
  height: number;
  /** Píxeles RGBA de 8 bits, `width * height * 4` bytes. */
  rgba: Uint8Array;
}

export interface EncodePngInput {
  width: number;
  height: number;
  rgba: Uint8Array;
}

interface Chunk {
  type: string;
  data: Buffer;
}

function readChunks(buffer: Buffer): Chunk[] {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("PNG inválido: falta la firma.");
  }

  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") {
      break;
    }
  }
  return chunks;
}

const CHANNELS_BY_COLOR_TYPE: Record<number, number> = {
  0: 1, // gris
  2: 3, // RGB
  3: 1, // paleta
  4: 2, // gris + alfa
  6: 4, // RGBA
};

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(
  inflated: Buffer,
  width: number,
  height: number,
  channels: number,
  bitDepth: number,
): Buffer {
  const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const stride = Math.ceil((channels * bitDepth * width) / 8);
  const out = Buffer.alloc(stride * height);
  let cursor = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor];
    cursor += 1;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;

    for (let i = 0; i < stride; i += 1) {
      const value = inflated[cursor + i] ?? 0;
      const a = i >= bytesPerPixel ? out[rowStart + i - bytesPerPixel]! : 0;
      const b = y > 0 ? out[prevStart + i]! : 0;
      const c = y > 0 && i >= bytesPerPixel ? out[prevStart + i - bytesPerPixel]! : 0;

      let reconstructed: number;
      switch (filter) {
        case 0:
          reconstructed = value;
          break;
        case 1:
          reconstructed = value + a;
          break;
        case 2:
          reconstructed = value + b;
          break;
        case 3:
          reconstructed = value + ((a + b) >> 1);
          break;
        case 4:
          reconstructed = value + paeth(a, b, c);
          break;
        default:
          throw new Error(`PNG inválido: filtro desconocido ${filter} en la fila ${y}.`);
      }
      out[rowStart + i] = reconstructed & 0xff;
    }

    cursor += stride;
  }

  return out;
}

/** Decodifica un PNG a RGBA de 8 bits. Lanza con un mensaje claro si no soporta el formato. */
export function decodePng(buffer: Buffer): DecodedPng {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  if (!ihdr || ihdr.length < 13) {
    throw new Error("PNG inválido: falta el chunk IHDR.");
  }

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8]!;
  const colorType = ihdr[9]!;
  const interlace = ihdr[12]!;

  if (interlace !== 0) {
    throw new Error("PNG entrelazado (Adam7) no soportado; exporta el PNG sin entrelazar.");
  }
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (!channels) {
    throw new Error(`PNG con colorType ${colorType} no soportado.`);
  }
  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`PNG con bitDepth ${bitDepth} no soportado (usa 8 o 16 bits).`);
  }
  if (colorType === 3 && bitDepth !== 8) {
    throw new Error("PNG con paleta y bitDepth distinto de 8 no soportado.");
  }

  const idat = Buffer.concat(
    chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data),
  );
  const inflated = inflateSync(idat);
  const pixels = unfilter(inflated, width, height, channels, bitDepth);

  const paletteChunk = chunks.find((chunk) => chunk.type === "PLTE")?.data;
  const trnsChunk = chunks.find((chunk) => chunk.type === "tRNS")?.data;
  const palette = paletteChunk
    ? Array.from({ length: paletteChunk.length / 3 }, (_, index) => [
        paletteChunk[index * 3]!,
        paletteChunk[index * 3 + 1]!,
        paletteChunk[index * 3 + 2]!,
      ])
    : [];

  const rgba = new Uint8Array(width * height * 4);
  const sampleBytes = bitDepth === 16 ? 2 : 1;
  const pixelStride = channels * sampleBytes;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const base = pixel * pixelStride;
    const sample = (index: number): number => pixels[base + index * sampleBytes]!;

    let r: number;
    let g: number;
    let b: number;
    let alpha = 255;

    if (colorType === 3) {
      const index = sample(0);
      const entry = palette[index] ?? [0, 0, 0];
      r = entry[0]!;
      g = entry[1]!;
      b = entry[2]!;
      alpha = trnsChunk && index < trnsChunk.length ? trnsChunk[index]! : 255;
    } else if (colorType === 0 || colorType === 4) {
      r = g = b = sample(0);
      if (colorType === 4) {
        alpha = sample(1);
      }
    } else {
      r = sample(0);
      g = sample(1);
      b = sample(2);
      if (colorType === 6) {
        alpha = sample(3);
      }
    }

    const target = pixel * 4;
    rgba[target] = r;
    rgba[target + 1] = g;
    rgba[target + 2] = b;
    rgba[target + 3] = alpha;
  }

  return { width, height, rgba };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Codifica RGBA de 8 bits como PNG-32 sin entrelazar. */
export function encodePng({ width, height, rgba }: EncodePngInput): Buffer {
  const stride = width * 4;
  if (rgba.length !== stride * height) {
    throw new Error(
      `encodePng: se esperaban ${stride * height} bytes RGBA (${width}×${height}) y se recibieron ${rgba.length}.`,
    );
  }

  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < stride; x += 1) {
      raw[rowStart + 1 + x] = rgba[y * stride + x]!;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
