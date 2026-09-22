import { z } from "zod";

/** Coordenada de celda del grid (origen arriba-izquierda, `0,0`). */
export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/** Dimensiones de una rejilla (`cols` × `rows`). */
export const GridSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

/** Rectángulo en celdas, usado por zonas y oclusores (specs/06 `split_clue`). */
export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

/**
 * Texto localizado (specs/08 §2.2): una entrada por locale, con audio opcional
 * por idioma. El catálogo filtra por los idiomas de la sala.
 */
export const LocalizedTextSchema = z.record(
  z.string(),
  z.object({
    text: z.string(),
    audioUrl: z.string().optional(),
  }),
);

export type Position = z.infer<typeof PositionSchema>;
export type Grid = z.infer<typeof GridSchema>;
export type Rect = z.infer<typeof RectSchema>;
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;
