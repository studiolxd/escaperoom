import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";

/**
 * Paquetes de sala que la `GameRoom` sabe cargar. Hasta que el catálogo
 * publique versiones congeladas (fase 5), el único es el fixture canónico del
 * Rey Aldric del repo. **El cliente nunca envía el paquete**: solo puede pedir
 * un id, y el servidor lo resuelve aquí (el paquete contiene las soluciones).
 */

export const REY_ALDRIC_PACKAGE_ID = "room-rey-aldric";
const REY_ALDRIC_FIXTURE = "docs/reference/roompackage-rey-aldric.v1.json";

let cached: RoomPackage | undefined;

/** Raíz del monorepo (carpeta con `pnpm-workspace.yaml`) subiendo desde `start`. */
export function findRepoRoot(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let current = start;
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`No se encontró la raíz del monorepo (pnpm-workspace.yaml) desde "${start}".`);
}

/** Carga y valida el fixture del Rey Aldric (cacheado por proceso). */
export function loadReyAldricRoomPackage(): RoomPackage {
  cached ??= parseRoomPackage(
    JSON.parse(readFileSync(join(findRepoRoot(), REY_ALDRIC_FIXTURE), "utf8")) as unknown,
  );
  return cached;
}

/** Resuelve el paquete de una partida por id; `undefined` si no existe. */
export function resolveRoomPackage(
  packageId: string = REY_ALDRIC_PACKAGE_ID,
): RoomPackage | undefined {
  return packageId === REY_ALDRIC_PACKAGE_ID ? loadReyAldricRoomPackage() : undefined;
}
