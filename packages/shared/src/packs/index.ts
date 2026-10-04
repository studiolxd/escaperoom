import type { CustomModel3D, Collider3D, Model3DSize, World3D } from "../schemas/world3d";
import medievalV1 from "./medieval-v1.models3d.json";
import { Models3DCatalogSchema, type Models3DCatalog } from "./models3d";

export * from "./models3d";

/**
 * Catálogos de modelos 3D por pack, con importación estática del JSON y
 * validados una sola vez al cargar el módulo. Sin imports de Node: se usa en
 * el navegador (editor y runtime).
 */
const CATALOGS: Readonly<Record<string, Models3DCatalog>> = {
  "medieval-v1": Models3DCatalogSchema.parse(medievalV1),
};

/** Catálogo del pack, o `undefined` si el pack no tiene modelos 3D. */
export function getModels3DCatalog(packId: string): Models3DCatalog | undefined {
  return Object.hasOwn(CATALOGS, packId) ? CATALOGS[packId] : undefined;
}

/** Modelo por id: primero los propios de la sala, después el catálogo del pack. */
export function resolveModel3D(
  modelId: string,
  catalog: Models3DCatalog | undefined,
  custom: World3D["models"] | undefined,
): { size: Model3DSize; colliders: Collider3D[]; clips: string[] } | undefined {
  if (custom && Object.hasOwn(custom, modelId)) {
    const own: CustomModel3D = custom[modelId]!;
    return { size: own.size, colliders: own.colliders, clips: own.clips };
  }
  if (catalog && Object.hasOwn(catalog.models, modelId)) {
    const entry = catalog.models[modelId]!;
    return { size: entry.size, colliders: entry.colliders, clips: entry.clips };
  }
  return undefined;
}
