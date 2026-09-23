/**
 * Análisis mínimo de MP3 (MPEG-1/2/2.5 Layer III) sobre los bytes de la subida
 * (specs/15 §1). No confía en el MIME ni en la extensión que declara el
 * cliente: busca la cabecera de trama MPEG real y suma la duración trama a
 * trama, lo que vale igual para CBR y VBR. Sin dependencias ni `Buffer`: se
 * puede usar en el navegador (aviso previo a subir) y en el servidor.
 */

export type Mp3Info = {
  /** Duración total en milisegundos (redondeada). */
  durationMs: number;
  frames: number;
  /** Frecuencia de muestreo de la primera trama. */
  sampleRate: number;
  /** Bitrate de la primera trama, en kbps. */
  bitrateKbps: number;
};

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

/** Tramas válidas consecutivas exigidas para aceptar el fichero como MP3. */
const MIN_CONSECUTIVE_FRAMES = 3;

type FrameHeader = { length: number; samples: number; sampleRate: number; bitrateKbps: number };

/** Cabecera de trama Layer III en `offset`, o `null` si no la hay. */
function readFrameHeader(bytes: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 0b11; // 0 = 2.5, 1 = reservado, 2 = v2, 3 = v1
  const layer = (b1 >> 1) & 0b11; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = b2 >> 4;
  const sampleRateIndex = (b2 >> 2) & 0b11;
  // 0 = "free format" (sin tamaño de trama deducible); 15 = inválido.
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
  const padding = (b2 >> 1) & 1;
  const isV1 = version === 3;
  const bitrateKbps = (isV1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex]!;
  const sampleRate = SAMPLE_RATES[version]![sampleRateIndex]!;
  const samples = isV1 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrateKbps * 1000) / sampleRate) + padding;
  return { length, samples, sampleRate, bitrateKbps };
}

/** Salta una etiqueta ID3v2 inicial ("ID3" + tamaño syncsafe). */
function skipId3v2(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = (bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!;
  const hasFooter = (bytes[5]! & 0x10) !== 0;
  return 10 + size + (hasFooter ? 10 : 0);
}

/**
 * Analiza un MP3. Devuelve `null` si los bytes no son un MP3 Layer III (p. ej.
 * un WAV, un OGG, un PNG renombrado o un texto): exige al menos tres tramas
 * válidas consecutivas desde la primera cabecera (o todas, si el fichero es más
 * corto). Tras la última trama válida se ignoran restos (ID3v1, relleno).
 */
export function parseMp3(bytes: Uint8Array): Mp3Info | null {
  let offset = skipId3v2(bytes);
  // Busca la primera sincronía (algunos codificadores dejan relleno a cero).
  while (offset < bytes.length && !readFrameHeader(bytes, offset)) offset++;

  let frames = 0;
  let seconds = 0;
  let first: FrameHeader | null = null;
  for (;;) {
    const header = readFrameHeader(bytes, offset);
    if (!header || offset + header.length > bytes.length) break;
    first ??= header;
    frames++;
    seconds += header.samples / header.sampleRate;
    offset += header.length;
  }

  // Un MP3 de una o dos tramas no existe en la práctica; exigir varias evita
  // aceptar un binario cualquiera que contenga 0xFFFx por casualidad.
  if (!first || frames < MIN_CONSECUTIVE_FRAMES) return null;
  return {
    durationMs: Math.round(seconds * 1000),
    frames,
    sampleRate: first.sampleRate,
    bitrateKbps: first.bitrateKbps,
  };
}

/**
 * Genera un MP3 de silencio válido (MPEG-1 Layer III, 128 kbps, 44,1 kHz) de
 * al menos `durationMs`. Sirve para tests y placeholders: no hay binarios de
 * audio en el repo.
 */
export function createSilentMp3(durationMs: number, opts: { id3?: boolean } = {}): Uint8Array {
  const frameLength = 417; // floor(144 * 128000 / 44100), sin padding
  const frameMs = (1152 / 44100) * 1000;
  const frames = Math.max(MIN_CONSECUTIVE_FRAMES, Math.ceil(durationMs / frameMs));
  const id3 = opts.id3 ? 10 : 0;
  const out = new Uint8Array(id3 + frames * frameLength);
  if (opts.id3) out.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]); // ID3v2.4 vacío
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], id3 + i * frameLength);
  return out;
}
