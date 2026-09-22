import { z } from "zod";

/**
 * Esquema Zod del manifiesto de pack gráfico (`specs/26-pack-grafico-v1.md` §6).
 *
 * El manifiesto es el único contrato entre el pack y el runtime: declara qué
 * frame del atlas corresponde a cada `tileId`, sprite, icono, animación y FX.
 * El runtime resuelve frames **por nombre** contra este manifiesto y nunca
 * infiere datos (p. ej. colisiones) del número de tile.
 */

/** Proyección isométrica del pack; debe ser 2:1 (specs/26 §3.1). */
export const PackProjectionSchema = z
  .object({
    tileWidth: z.number().int().positive(),
    tileHeight: z.number().int().positive(),
    scale: z.number().positive(),
  })
  .superRefine((projection, ctx) => {
    if (projection.tileWidth !== projection.tileHeight * 2) {
      ctx.addIssue({
        code: "custom",
        message: `proyección inválida: se espera isométrica 2:1 (tileWidth = 2 × tileHeight), recibido ${projection.tileWidth}×${projection.tileHeight}.`,
      });
    }
  });

/** Atlas de Phaser (imagen + JSON de frames) que el runtime precarga. */
export const PackAtlasSchema = z.object({
  key: z.string().min(1),
  image: z.string().min(1),
  data: z.string().min(1),
});

/**
 * Entrada de `manifest.tiles`: frame del atlas y **colisión explícita** por
 * `tileId`. `collides` es obligatorio (el runtime no lo infiere del número).
 */
export const PackTileEntrySchema = z.object({
  frame: z.string().min(1),
  collides: z.boolean(),
});

/** Frame por identificador de sprite del `RoomPackage` (objetos, estados, decoración). */
export const PackSpriteEntrySchema = z.object({
  frame: z.string().min(1),
});

/** Animación declarada por el pack (`key`, frames, cadencia y repetición). */
export const PackAnimSchema = z.object({
  key: z.string().min(1),
  frames: z.array(z.string().min(1)).min(1),
  frameRate: z.number().positive(),
  repeat: z.number().int(),
});

const PackUiSchema = z.object({
  icons: z.record(z.string(), z.string().min(1)),
});

const PackFxSchema = z.object({
  spark: z.string().min(1),
});

export const PackManifestSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    packageFormat: z.string().min(1),
    projection: PackProjectionSchema,
    atlases: z.array(PackAtlasSchema),
    tiles: z.record(z.string(), PackTileEntrySchema),
    sprites: z.record(z.string(), PackSpriteEntrySchema),
    anims: z.array(PackAnimSchema),
    ui: PackUiSchema,
    fx: PackFxSchema,
    keys: z.array(z.string().min(1)),
  })
  .superRefine((manifest, ctx) => {
    const atlasKeys = new Set<string>();

    manifest.atlases.forEach((atlas, index) => {
      if (atlasKeys.has(atlas.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["atlases", index, "key"],
          message: `atlas duplicado: la clave "${atlas.key}" aparece más de una vez.`,
        });
      }
      atlasKeys.add(atlas.key);
    });

    manifest.keys.forEach((key, index) => {
      if (!atlasKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["keys", index],
          message: `la clave de atlas "${key}" no existe en atlases.`,
        });
      }
    });

    for (const [tileId, entry] of Object.entries(manifest.tiles)) {
      if (!/^\d+$/.test(tileId)) {
        ctx.addIssue({
          code: "custom",
          path: ["tiles", tileId],
          message: `tileId inválido "${tileId}": debe ser un entero no negativo como cadena.`,
        });
        continue;
      }
      if (tileId === "0") {
        ctx.addIssue({
          code: "custom",
          path: ["tiles", tileId],
          message: 'tiles no debe declarar el tileId "0" (celda vacía, nunca se pinta).',
        });
      }
      if (!entry.frame) {
        ctx.addIssue({
          code: "custom",
          path: ["tiles", tileId, "frame"],
          message: "cada tile necesita un frame no vacío.",
        });
      }
    }
  });

export type PackProjection = z.infer<typeof PackProjectionSchema>;
export type PackAtlas = z.infer<typeof PackAtlasSchema>;
export type PackTileEntry = z.infer<typeof PackTileEntrySchema>;
export type PackSpriteEntry = z.infer<typeof PackSpriteEntrySchema>;
export type PackAnim = z.infer<typeof PackAnimSchema>;
export type PackManifest = z.infer<typeof PackManifestSchema>;

/**
 * Escala de entrega/render del pack. La celda **lógica** sigue siendo 64×32
 * (iso 2:1); a 2× se produce a 128×64 para pantallas HiDPI (specs/26 §3.1).
 */
export const PACK_SCALE = 2;

/** Proyección por defecto de v1: celda 64×32 a escala 2× (128×64). */
export const DEFAULT_PACK_PROJECTION: PackProjection = {
  tileWidth: 64,
  tileHeight: 32,
  scale: PACK_SCALE,
};

/** Valida y devuelve un `PackManifest`, lanzando un `ZodError` si es inválido. */
export function parsePackManifest(input: unknown): PackManifest {
  return PackManifestSchema.parse(input);
}

/** Variante segura de `parsePackManifest` que no lanza. */
export function safeParsePackManifest(input: unknown) {
  return PackManifestSchema.safeParse(input);
}
