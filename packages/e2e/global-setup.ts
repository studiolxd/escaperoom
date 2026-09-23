import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { REPO_ROOT, serverEnv } from "./support/env";

/**
 * Base de la suite: migraciones pendientes + el mismo `pnpm db:seed` que
 * desarrollo (specs/22 §3.2: un solo fixture para dev y CI). Ambos son
 * idempotentes (`migrate deploy`, `upsert`), así que no se borra nada: cada
 * test crea sus datos con nombres únicos.
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_DB_SETUP === "1") return;
  const env = { ...process.env, ...serverEnv() };
  const cwd = resolve(REPO_ROOT, "packages/shared");
  for (const script of ["db:migrate", "db:seed"]) {
    const result = spawnSync("pnpm", ["run", script], { cwd, env, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`pnpm ${script} falló (código ${result.status})`);
  }
}
