import sharp from "sharp";

/**
 * Rasteriza un SVG al lienzo (ancho × alto) canónico de su frame, con fondo
 * transparente. Las tallas vienen de `reference/pack-grafico-lista-assets.md`
 * (celda iso 2:1 = 64×32). El SVG se ajusta SIN deformar (`fit: contain`) y se
 * alinea abajo-centro, que es el pivote del runtime.
 *
 * Si el SVG no trae `viewBox`/tamaño, o el frame no está en la tabla, se
 * rasteriza a su tamaño natural (respetando su propio aspect ratio).
 */

export interface RasterizedImage {
  width: number;
  height: number;
  rgba: Buffer;
}

/** Lienzo por tile: el suelo es exactamente la celda (64×32). */
const TILE_CANVAS = { width: 64, height: 32 };

/** Tallas canónicas por frame de sprite/icono/avatar/fx (reference/pack-grafico). */
const FRAME_CANVASES: Record<string, { width: number; height: number }> = {
  // Suelo
  "tile-1": TILE_CANVAS,
  "tile-2": TILE_CANVAS,
  "tile-3": TILE_CANVAS,
  // Sprites con altura
  "tile-10": { width: 64, height: 64 },
  "tile-20": { width: 64, height: 48 },
  "tile-21": { width: 64, height: 48 },
  "tile-22": { width: 64, height: 48 },
  antorcha: { width: 64, height: 96 },
  "barril-suelto": { width: 64, height: 64 },
  barriles: { width: 96, height: 96 },
  columna: { width: 64, height: 128 },
  estandarte: { width: 64, height: 96 },
  "tapiz-dragones": { width: 96, height: 96 },
  trono: { width: 128, height: 128 },
  "cuadro-rey": { width: 96, height: 96 },
  "cuadro-rey-torcido": { width: 96, height: 96 },
  "cuadro-reino": { width: 96, height: 96 },
  "cuadro-reino-4torres": { width: 96, height: 96 },
  "tapiz-7-dragones": { width: 96, height: 96 },
  armario: { width: 96, height: 128 },
  "armario-abierto": { width: 96, height: 128 },
  arca: { width: 96, height: 96 },
  "arca-cerrada": { width: 96, height: 96 },
  "arca-abierta": { width: 96, height: 96 },
  brasero: { width: 96, height: 96 },
  "brasero-apagado": { width: 96, height: 96 },
  "brasero-encendido": { width: 96, height: 96 },
  "estatua-caballero": { width: 96, height: 128 },
  "placa-piedra": { width: 64, height: 48 },
  "placa-arriba": { width: 64, height: 48 },
  "placa-hundida": { width: 64, height: 48 },
  "puerta-madera": { width: 96, height: 128 },
  "puerta-cerrada": { width: 96, height: 128 },
  "puerta-abierta": { width: 96, height: 128 },
  "mural-azulejos": { width: 96, height: 96 },
  "mural-desordenado": { width: 96, height: 96 },
  "mural-completo": { width: 96, height: 96 },
  "ranura-caliz": { width: 64, height: 48 },
  "ranura-vacia": { width: 64, height: 48 },
  "ranura-con-caliz": { width: 64, height: 48 },
  compartimento: { width: 96, height: 96 },
  "compartimento-cerrado": { width: 96, height: 96 },
  "compartimento-abierto": { width: 96, height: 96 },
  "barril-cerrado": { width: 64, height: 64 },
  "barril-movido": { width: 64, height: 64 },
  "mesa-catas": { width: 128, height: 96 },
  mesa: { width: 128, height: 96 },
  "mesa-activa": { width: 128, height: 96 },
  reja: { width: 96, height: 96 },
  "reja-cerrada": { width: 96, height: 96 },
  "reja-abierta": { width: 96, height: 96 },
  mirilla: { width: 64, height: 64 },
  sarcofago: { width: 128, height: 96 },
  altar: { width: 96, height: 128 },
  "altar-seco": { width: 96, height: 128 },
  "altar-con-agua": { width: 96, height: 128 },
  canal: { width: 64, height: 64 },
  compuerta: { width: 96, height: 96 },
  "compuerta-cerrada": { width: 96, height: 96 },
  "compuerta-abierta": { width: 96, height: 96 },
  relicario: { width: 96, height: 96 },
  "relicario-sellado": { width: 96, height: 96 },
  "relicario-abierto": { width: 96, height: 96 },
  "vasijas-8": { width: 128, height: 96 },
};

const ICON_CANVAS = { width: 64, height: 64 };
const AVATAR_CANVAS = { width: 64, height: 96 };
const FX_CANVAS = { width: 64, height: 64 };

/** Lienzo canónico de un frame, o `null` si no está en la tabla. */
export function canvasForFrame(frame: string): { width: number; height: number } | null {
  if (FRAME_CANVASES[frame]) return FRAME_CANVASES[frame]!;
  if (frame.startsWith("icon-")) return ICON_CANVAS;
  if (frame.startsWith("avatar-")) return AVATAR_CANVAS;
  if (frame.startsWith("fx-")) return FX_CANVAS;
  if (frame.startsWith("tile-")) return TILE_CANVAS;
  return null;
}

/**
 * Rasteriza `svg` al lienzo canónico del `frame`. `fit: contain` evita deformar;
 * la imagen se ancla abajo-centro (pivote del runtime).
 */
export async function rasterizeSvg(svg: string, frame: string): Promise<RasterizedImage> {
  const canvas = canvasForFrame(frame);
  const base = sharp(Buffer.from(svg), { density: 384 });

  if (!canvas) {
    const { data, info } = await base.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, rgba: data };
  }

  const resized = await base
    .resize(canvas.width, canvas.height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const { data: rgba, info } = await sharp(resized)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba };
}
