/**
 * Conversor 2D → 3D del Rey Aldric (encargo 7.10b). Herramienta interna:
 *   pnpm --filter @escaperoom/shared convertir:3d
 * Lee docs/reference/roompackage-rey-aldric.v1.json y escribe
 * docs/reference/roompackage-rey-aldric-3d.v1.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertRoomTo3D, MEDIEVAL_V1_TILE_PIECES } from "../src/convert3d/convert";
import { getModels3DCatalog } from "../src/packs";
import { parseRoomPackage } from "../src/schemas";

const root = (ruta: string): string => fileURLToPath(new URL(`../../../${ruta}`, import.meta.url));

export const REY_ALDRIC_2D_FIXTURE = "docs/reference/roompackage-rey-aldric.v1.json";
export const REY_ALDRIC_3D_FIXTURE = "docs/reference/roompackage-rey-aldric-3d.v1.json";
export const REY_ALDRIC_3D_META = { id: "room-rey-aldric-3d", title: "La Maldición del Rey Aldric (3D)" } as const;
const MODELOS_3D = "tools/assets-generator/packs/medieval-v1/modelos3d.json";

/** Genera el texto del fixture 3D a partir de los ficheros versionados. */
export function generarReyAldric3D(): string {
  const pkg = parseRoomPackage(JSON.parse(readFileSync(root(REY_ALDRIC_2D_FIXTURE), "utf8")));
  const config = JSON.parse(readFileSync(root(MODELOS_3D), "utf8")) as {
    sprites2d: Record<string, { model: string; yaw: number }>;
    sinModelo: string[];
  };
  const catalog = getModels3DCatalog(pkg.map.tileset);
  if (!catalog) throw new Error(`El pack «${pkg.map.tileset}» no tiene catálogo 3D`);
  const converted = convertRoomTo3D(pkg, {
    sprites: config.sprites2d,
    hiddenSprites: config.sinModelo,
    tiles: MEDIEVAL_V1_TILE_PIECES,
    catalog,
    meta: REY_ALDRIC_3D_META,
  });
  return `${JSON.stringify(converted, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(root(REY_ALDRIC_3D_FIXTURE), generarReyAldric3D());
  console.log(`Escrito ${REY_ALDRIC_3D_FIXTURE}`);
}
