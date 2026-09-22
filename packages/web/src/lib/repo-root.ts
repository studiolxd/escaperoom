import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Encuentra la raíz del monorepo subiendo desde `start` hasta el
 * `pnpm-workspace.yaml`. Lo usan los helpers de servidor que leen ficheros del
 * repo (fixture del Rey Aldric, packs gráficos) sin depender del `cwd` de Next.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let current = start;
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`No se encontró la raíz del monorepo (pnpm-workspace.yaml) desde "${start}".`);
}
