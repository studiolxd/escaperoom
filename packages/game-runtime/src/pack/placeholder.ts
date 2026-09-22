import type { RuntimeModel } from "../loader";
import { defaultAvatarAnims } from "./avatar";
import { collectRequiredFrames } from "./frames";
import {
  DEFAULT_PACK_PROJECTION,
  type PackAnim,
  type PackManifest,
  type PackProjection,
} from "./manifest";

/**
 * Manifiesto sintético para el **modo placeholder**: cubre todos los frames del
 * `RoomPackage` con sus nombres canónicos para que el runtime pueda renderizar
 * sin pack real (specs/26 §1). La capa Phaser genera una textura procedural por
 * cada frame que no exista en un atlas.
 *
 * Las colisiones por defecto siguen la tabla propuesta de specs/26 §4.1 (el
 * muro `10` colisiona; umbral, escalón y rejilla no). No es una inferencia del
 * runtime: es un manifiesto generado, explícito y sustituible por el real.
 */
export const PLACEHOLDER_COLLIDING_TILES: ReadonlySet<number> = new Set([10]);

export interface PlaceholderManifestOptions {
  id?: string;
  version?: string;
  packageFormat?: string;
  projection?: PackProjection;
  /** `tileId`s que colisionan en el manifiesto sintético. */
  collides?: Iterable<number>;
  anims?: PackAnim[];
}

/** Construye un manifiesto válido que cubre el modelo sin necesidad de pack. */
export function buildPlaceholderManifest(
  model: RuntimeModel,
  options: PlaceholderManifestOptions = {},
): PackManifest {
  const required = collectRequiredFrames(model);
  const collides = new Set(options.collides ?? PLACEHOLDER_COLLIDING_TILES);

  const tiles: PackManifest["tiles"] = {};
  for (const tileId of required.tiles) {
    tiles[String(tileId)] = { frame: `tile-${tileId}`, collides: collides.has(tileId) };
  }

  const sprites: PackManifest["sprites"] = {};
  for (const sprite of required.sprites) {
    sprites[sprite] = { frame: sprite };
  }

  const icons: Record<string, string> = {};
  for (const icon of required.icons) {
    icons[icon] = icon;
  }

  return {
    id: options.id ?? `${model.meta.id}-placeholder`,
    version: options.version ?? "0.0.0",
    packageFormat: options.packageFormat ?? "1",
    projection: options.projection ?? DEFAULT_PACK_PROJECTION,
    atlases: [],
    tiles,
    sprites,
    anims: options.anims ?? defaultAvatarAnims(),
    ui: { icons },
    fx: { spark: "fx-spark" },
    keys: [],
  };
}
