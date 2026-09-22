import sharp from "sharp";
import { canvasForFrame, checkPngAspect, type RasterizedImage } from "./svg";

/**
 * Normalización de **PNG** para `pack:build`. A diferencia del SVG (que puede
 * reencuadrarse), un PNG se toma como está:
 *
 * 1. se **comprueba** que su proporción es la del lienzo canónico (2:1 en
 *    tiles); si no, es un error y el frame **no** se genera;
 * 2. se **redimensiona** al lienzo canónico solo si es mayor, **sin deformar**
 *    ni recortar;
 * 3. se devuelve RGBA-8 para el empaquetado del atlas.
 */
export interface PngNormalizeResult {
  image: RasterizedImage;
  /** Mensaje de error si la proporción no encaja (entonces `image` es el original). */
  error: string | null;
  /**
   * Aviso (no bloqueante en modo normal) si el PNG es **menor** que el lienzo
   * canónico: se genera igual, pero el runtime lo escalará al alza (borroso).
   * Con `--strict`, `pack:build` lo convierte en error.
   */
  warning: string | null;
}

export async function normalizePng(
  png: Buffer,
  frame: string,
): Promise<PngNormalizeResult> {
  const decoded = sharp(png).ensureAlpha();
  const meta = await decoded.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const aspectError = checkPngAspect(frame, width, height);
  if (aspectError) {
    const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
    return {
      image: { width: info.width, height: info.height, rgba: data },
      error: aspectError,
      warning: null,
    };
  }

  const canvas = canvasForFrame(frame);
  const shouldShrink = canvas !== null && (width > canvas.width || height > canvas.height);
  const isSmaller = canvas !== null && (width < canvas.width || height < canvas.height);

  const resized = shouldShrink
    ? await decoded.resize(canvas.width, canvas.height, { fit: "fill" }).png().toBuffer()
    : await decoded.png().toBuffer();

  const { data, info } = await sharp(resized)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const warning =
    isSmaller && canvas
      ? `el PNG ${width}×${height} es menor que el lienzo canónico ` +
        `${canvas.width}×${canvas.height} y se escalará al alza (puede verse borroso).`
      : null;

  return { image: { width: info.width, height: info.height, rgba: data }, error: null, warning };
}
