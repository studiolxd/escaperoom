import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Fixture canónico del `RoomPackage` del Rey Aldric (specs/08 §8). La ruta es
 * relativa a la raíz del monorepo, así que se busca hacia arriba desde el
 * `cwd` del proceso Next (normalmente `packages/web`).
 */
export const REY_ALDRIC_FIXTURE_PATH = "docs/reference/roompackage-rey-aldric.v1.json";

function findRepoRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, REY_ALDRIC_FIXTURE_PATH))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`No se encontró ${REY_ALDRIC_FIXTURE_PATH} partiendo de "${start}".`);
}

/**
 * Lee el JSON del fixture del Rey Aldric desde el repo. Solo se usa en el
 * servidor (Server Component / build), nunca en el bundle de cliente.
 */
export function readReyAldricRoomPackageJson(): string {
  return readFileSync(join(findRepoRoot(process.cwd()), REY_ALDRIC_FIXTURE_PATH), "utf8");
}
