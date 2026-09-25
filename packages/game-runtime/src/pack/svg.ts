import sharp, { type Sharp } from "sharp";
import { PACK_SCALE } from "./manifest";

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
  // `22` = arco abierto en la fila de muro: misma altura que el muro (tile-10).
  "tile-22": { width: 64, height: 64 },
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

/** Tolerancia de aspecto: 3 % de desviación sobre el lienzo canónico. */
export const ASPECT_TOLERANCE = 0.03;

/** Lienzo lógico por frame declarado por el pack (`pack.config.sizes`, a 1×). */
export type FrameSizes = Record<string, [number, number]>;

/**
 * Comprueba que el `viewBox` del SVG encaja con el aspecto del lienzo canónico
 * del frame. Devuelve un aviso legible si no encaja (un suelo iso 2:1 dibujado
 * en un viewBox de otro aspecto se verá con márgenes o deformado), o `null` si
 * encaja o no hay medidas. Si el pack declara `pack.config.sizes[frame]`, ese
 * lienzo (real, no canónico) es la fuente de verdad y no se comprueba aspecto
 * (specs/26 §3.1): cada objeto tiene su propio lienzo, no uno "canónico".
 */
export function checkSvgAspect(svg: string, frame: string, sizes?: FrameSizes): string | null {
  if (sizes?.[frame]) return null;
  const expected = expectedAspectForFrame(frame, sizes);
  const box = readSvgViewBox(svg);
  if (expected === null || box === null) return null;

  const actual = box.width / box.height;
  if (Math.abs(actual - expected) / expected <= ASPECT_TOLERANCE) return null;

  return (
    `el viewBox ${box.width}×${box.height} tiene aspecto ${actual.toFixed(3)}:1, ` +
    `pero el frame "${frame}" espera ${expected.toFixed(3)}:1 ` +
    `(lienzo canónico); el SVG no llenará la celda y se verá con márgenes o deformado.`
  );
}

const ICON_CANVAS = { width: 64, height: 64 };
const AVATAR_CANVAS = { width: 64, height: 96 };
const FX_CANVAS = { width: 64, height: 64 };

/** Aspecto (ancho/alto) del lienzo canónico del frame, si lo tiene. */
export function expectedAspectForFrame(frame: string, sizes?: FrameSizes): number | null {
  const canvas = canvasForFrame(frame, sizes);
  if (!canvas) return null;
  return canvas.width / canvas.height;
}

/**
 * Lee el `viewBox` (o `width`/`height` numéricos) de un SVG. Devuelve `null` si
 * no hay medidas explícitas. Acepta `viewBox="minX minY w h"`.
 */
export function readSvgViewBox(svg: string): { width: number; height: number } | null {
  const viewBox = svg.match(
    /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*["']/i,
  );
  if (viewBox) {
    const width = Number(viewBox[3]);
    const height = Number(viewBox[4]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  const width = svg.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i);
  const height = svg.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i);
  if (width && height) {
    const w = Number(width[1]);
    const h = Number(height[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h };
    }
  }
  return null;
}

const scaleCanvas = (canvas: { width: number; height: number }) => ({
  width: canvas.width * PACK_SCALE,
  height: canvas.height * PACK_SCALE,
});

/** Tolerancia de aspecto para PNG: 1 % sobre el lienzo canónico. */
export const PNG_ASPECT_TOLERANCE = 0.01;

/**
 * Comprueba que un PNG **ya** tiene la proporción de su lienzo canónico (p. ej.
 * un tile iso 2:1). A diferencia del SVG, un PNG **no** se reencuadra: si su
 * proporción no encaja, es un error del pack (no se genera esa imagen).
 * Devuelve el mensaje de error, o `null` si encaja (o el frame es desconocido).
 */
export function checkPngAspect(
  frame: string,
  width: number,
  height: number,
  sizes?: FrameSizes,
): string | null {
  if (sizes?.[frame]) return null;
  const expected = expectedAspectForFrame(frame, sizes);
  if (expected === null || height <= 0) return null;
  const actual = width / height;
  if (Math.abs(actual - expected) / expected <= PNG_ASPECT_TOLERANCE) return null;
  return (
    `el PNG ${width}×${height} tiene aspecto ${actual.toFixed(3)}:1, pero el frame ` +
    `"${frame}" exige ${expected.toFixed(3)}:1. Un PNG no se reencuadra: reexporta el ` +
    `asset con la proporción correcta.`
  );
}

/**
 * Lienzo (a la escala de entrega) de un frame, o `null` si no está. Si el pack
 * declara `sizes[frame]` (a 1×), ese es el lienzo lógico real del frame
 * (specs/26 §2): cada sprite tiene su propio tamaño, no uno canónico
 * compartido. Sin `sizes`, cae a la tabla canónica (packs antiguos).
 */
export function canvasForFrame(
  frame: string,
  sizes?: FrameSizes,
): { width: number; height: number } | null {
  const declared = sizes?.[frame];
  if (declared) {
    return scaleCanvas({ width: declared[0], height: declared[1] });
  }
  const base = baseCanvasForFrame(frame);
  return base ? scaleCanvas(base) : null;
}

function baseCanvasForFrame(frame: string): { width: number; height: number } | null {
  if (FRAME_CANVASES[frame]) return FRAME_CANVASES[frame]!;
  if (frame.startsWith("icon-")) return ICON_CANVAS;
  if (frame.startsWith("avatar-")) return AVATAR_CANVAS;
  if (frame.startsWith("fx-")) return FX_CANVAS;
  if (frame.startsWith("tile-")) return TILE_CANVAS;
  return null;
}

/**
 * Rasteriza `svg` al lienzo canónico del `frame`.
 *
 * Si el aspecto del SVG no coincide con el del lienzo (p. ej. un suelo iso
 * dibujado a 1.73:1 en vez de 2:1), se **reencuadra** al bbox real de la figura
 * (detección por píxeles opacos, a alta resolución) antes de escalar. Así el
 * rombo `a sangre` llena la celda sin márgenes sin tocar el SVG de origen.
 */
export async function rasterizeSvg(
  svg: string,
  frame: string,
  sizes?: FrameSizes,
): Promise<RasterizedImage> {
  const canvas = canvasForFrame(frame, sizes);
  const base = sharp(Buffer.from(svg), { density: 384 });

  if (!canvas) {
    const { data, info } = await base.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, rgba: data };
  }

  const needsReframe = checkSvgAspect(svg, frame, sizes) !== null;
  const piped = needsReframe ? await reframeToAspect(base, canvas) : base;

  // D-28: antes se codificaba a PNG (`.png().toBuffer()`) y se volvía a
  // decodificar con un `sharp(resized)` nuevo solo para sacar el RGBA crudo
  // — dos rasterizaciones (más la de `reframeToAspect` si hace falta) por lo
  // que ya era un único redimensionado. `raw()` directamente sobre el mismo
  // pipeline da el mismo resultado sin el viaje de ida y vuelta por PNG.
  const { data: rgba, info } = await piped
    .resize(canvas.width, canvas.height, {
      fit: "fill",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba };
}

/** Resolución de trabajo para detectar el bbox de píxeles opacos. */
const BBOX_SAMPLE_WIDTH = 1024;
/** Alfa por debajo del cual un píxel se considera transparente. */
const ALPHA_THRESHOLD = 16;

/**
 * Recorta el SVG al bbox de la figura y lo deja con el aspecto pedido, de modo
 * que al escalar con `fit: fill` la figura llene el lienzo. Trabaja sobre una
 * rasterización temporal; nunca escribe el SVG.
 */
async function reframeToAspect(image: Sharp, canvas: { width: number; height: number }) {
  const { data, info } = await image
    .clone()
    .resize({ width: BBOX_SAMPLE_WIDTH, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const box = opaqueBounds(data, info.width, info.height);
  if (!box) {
    return image;
  }

  const targetAspect = canvas.width / canvas.height;
  const boxWidth = box.right - box.left + 1;
  const boxHeight = box.bottom - box.top + 1;

  // Encaja el bbox en el aspecto pedido: añade el lado que falte.
  let regionWidth = boxWidth;
  let regionHeight = boxHeight;
  if (boxWidth / boxHeight < targetAspect) {
    regionWidth = boxHeight * targetAspect;
  } else {
    regionHeight = boxWidth / targetAspect;
  }

  // Centra el bbox dentro de la región pedida.
  const centerX = (box.left + box.right + 1) / 2;
  const centerY = (box.top + box.bottom + 1) / 2;
  const left = Math.round(centerX - regionWidth / 2);
  const top = Math.round(centerY - regionHeight / 2);

  const scale = info.width / BBOX_SAMPLE_WIDTH || 1;
  const srcLeft = Math.max(0, Math.floor(left * scale));
  const srcTop = Math.max(0, Math.floor(top * scale));
  const srcWidth = Math.min(info.width - srcLeft, Math.ceil(regionWidth * scale));
  const srcHeight = Math.min(info.height - srcTop, Math.ceil(regionHeight * scale));

  if (srcWidth <= 0 || srcHeight <= 0) {
    return image;
  }

  // `extract` sobre la imagen original trabaja en su espacio real; como la
  // muestra se reescaló, se reescala también el rect en la proporción real.
  const real = await image.clone().metadata();
  if (!real.width || !real.height) {
    return image;
  }
  const realScaleX = real.width / info.width;
  const realScaleY = real.height / info.height;

  return image.clone().extract({
    left: Math.max(0, Math.round(srcLeft * realScaleX)),
    top: Math.max(0, Math.round(srcTop * realScaleY)),
    width: Math.max(1, Math.round(srcWidth * realScaleX)),
    height: Math.max(1, Math.round(srcHeight * realScaleY)),
  });
}

/** Bbox de píxeles con alfa por encima del umbral (coordenadas de la muestra). */
function opaqueBounds(
  rgba: Buffer,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3] ?? 0;
      if (alpha > ALPHA_THRESHOLD) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (right < 0 || bottom < 0 || left > right || top > bottom) {
    return null;
  }
  return { left, top, right, bottom };
}
