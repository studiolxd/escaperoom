import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

/**
 * `pnpm dev`: arranca `next dev` y el WebSocket de edición (ticket 3.3) en el
 * puerto propio del worktree (auditoría 2026-09-25, puertos por worktree).
 *
 * Commander (CLI de Next) lee `PORT` con `.env('PORT')` al analizar `argv`,
 * ANTES de que Next cargue su propio `.env`/`.env.local` — así que un `next
 * dev` suelto nunca ve el `PORT` que escribe `pnpm dev:env` en este fichero.
 * Lo cargamos aquí primero, igual que hacen `colyseus-server/src/main.ts` y
 * `editor-sync/main.ts` con el suyo.
 */
function loadLocalEnv(): void {
  for (const file of ["../shared/.env", ".env", ".env.local"]) {
    const path = `${process.cwd()}/${file}`;
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

loadLocalEnv();

// Puerto del worktree principal por defecto (3000): el mismo que trae Next.
const port = process.env.PORT ?? "3000";

const children = [
  spawn("pnpm", ["exec", "next", "dev", "-p", port], { stdio: "inherit" }),
  spawn("pnpm", ["editor-sync"], { stdio: "inherit" }),
];

let exiting = false;
function shutdown(code: number): void {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}

for (const child of children) {
  child.on("exit", (code) => shutdown(code ?? 0));
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => shutdown(0));
}
