import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./repo-root";

/**
 * Fixture canónico del `RoomPackage` del Rey Aldric (specs/08 §8). La ruta es
 * relativa a la raíz del monorepo, así que se busca hacia arriba desde el
 * `cwd` del proceso Next (normalmente `packages/web`).
 */
export const REY_ALDRIC_FIXTURE_PATH = "docs/reference/roompackage-rey-aldric.v1.json";

/**
 * Lee el JSON del fixture del Rey Aldric desde el repo. Solo se usa en el
 * servidor (Server Component / build), nunca en el bundle de cliente.
 */
export function readReyAldricRoomPackageJson(): string {
  return readFileSync(join(findRepoRoot(process.cwd()), REY_ALDRIC_FIXTURE_PATH), "utf8");
}
