import { existsSync, readFileSync } from "node:fs";

/**
 * REDIS_PREFIX por worktree (auditoría 2026-09-25, hallazgo de la PR #149):
 * lee `REDIS_PREFIX` del `.env` del paquete (o, si falta, del `.env` de
 * `shared`, hermano) para dárselo a Vitest como `test.env` — Vitest no carga
 * ningún `.env` por sí solo, así que sin esto los tests de Redis de un
 * worktree comparten prefijo con los demás worktrees corriendo en paralelo.
 *
 * `alreadySet` es siempre `process.env.REDIS_PREFIX`: si ya viene exportado
 * (CI, o quien invoque vitest a mano) no se toca. Sin `.env` de worktree (CI)
 * devuelve `{}` y no cambia nada.
 */
export function readRedisPrefixFromEnv(
  cwd: string,
  alreadySet: string | undefined,
): Record<string, string> {
  if (alreadySet) return {};
  for (const file of [".env", "../shared/.env"]) {
    const path = `${cwd}/${file}`;
    if (!existsSync(path)) continue;
    const match = /^REDIS_PREFIX=(.+)$/mu.exec(readFileSync(path, "utf8"));
    if (match?.[1]) return { REDIS_PREFIX: match[1].trim() };
  }
  return {};
}
