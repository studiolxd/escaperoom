import { z } from "zod";
import { ID_PATTERN, LocalizedTextSchema } from "../schemas/common";
import { Collider3DSchema, Model3DSizeSchema } from "../schemas/world3d";

/**
 * Catálogo versionado de los modelos 3D de un pack (specs/27 §4):
 * `packs/<packId>.models3d.json`. Lo usan el validador, la navmesh, el editor
 * (paleta) y el runtime (cajas de sustitución cuando falta el GLB).
 */

export const MODEL3D_CATEGORIES = [
  "suelo",
  "muro",
  "estructura",
  "mueble",
  "pared",
  "suelto",
] as const;

export const Model3DEntrySchema = z.object({
  /** Relativo a la carpeta del pack: `models/arca-cerrada.glb`. */
  file: z.string().min(1),
  category: z.enum(MODEL3D_CATEGORIES),
  label: LocalizedTextSchema,
  /** Caja envolvente (x, y, h), origen en el centro de la base. */
  size: Model3DSizeSchema,
  /** `[]` = no bloquea ni se pisa. */
  colliders: z.array(Collider3DSchema),
  /** `true` = pieza de kit (imán de 1 m y 90° por defecto). */
  snap: z.boolean(),
  /** Clips de animación que trae el GLB. */
  clips: z.array(z.string()),
  /** Familia de estados (`arca`): agrupa la paleta. */
  group: z.string().optional(),
});

export const Avatar3DEntrySchema = z.object({
  /** `avatars/caballero-m.glb`. */
  file: z.string().min(1),
  label: LocalizedTextSchema,
  /** Altura en metros. */
  height: z.number().positive(),
  clips: z.object({ idle: z.string(), walk: z.string(), interact: z.string() }),
});

export const Models3DCatalogSchema = z.object({
  packId: z.string().regex(ID_PATTERN),
  version: z.string(),
  models: z.record(z.string().regex(ID_PATTERN), Model3DEntrySchema),
  avatars: z.record(z.string(), Avatar3DEntrySchema),
});

export type Model3DEntry = z.infer<typeof Model3DEntrySchema>;
export type Avatar3DEntry = z.infer<typeof Avatar3DEntrySchema>;
export type Models3DCatalog = z.infer<typeof Models3DCatalogSchema>;
