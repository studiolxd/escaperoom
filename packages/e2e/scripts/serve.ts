import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, RUN_DIR, serverEnv, WEB_PORT } from "../support/env";

/**
 * Arranca uno de los servidores de la suite con el entorno E2E y copia su
 * salida a `.run/<nombre>.log` (además de a la consola de Playwright), para
 * depurar un fallo. El enlace mágico (A-1) ya se envía por el transporte real
 * en vez de imprimirse: `support/auth.ts` lo lee de la tabla `verification`
 * de Postgres, no de este log.
 *
 *   tsx scripts/serve.ts web        # next build (si hace falta) + next start
 *   tsx scripts/serve.ts colyseus   # colyseus-server (GameRoom, event, playtest)
 *   tsx scripts/serve.ts editor-sync
 */

type Name = "web" | "colyseus" | "editor-sync";

const name = process.argv[2] as Name;
const env = { ...process.env, ...serverEnv() };
mkdirSync(RUN_DIR, { recursive: true });

const WEB_DIR = resolve(REPO_ROOT, "packages/web");

/**
 * Por defecto se compila siempre: la build de `verify` (otro entorno) o un
 * `prisma generate` posterior dejan inservible una `.next` anterior. Para
 * iterar en local, `E2E_REUSE_BUILD=1` reutiliza la última build de la suite
 * si es de este mismo entorno público (las `NEXT_PUBLIC_*` y la CSP se
 * incrustan al compilar; huella en `.run/web-build.json`).
 */
function buildWebIfNeeded(): void {
  const publicEnv = Object.fromEntries(
    Object.entries(serverEnv()).filter(([key]) => key.startsWith("NEXT_PUBLIC_")),
  );
  const fingerprint = createHash("sha256").update(JSON.stringify(publicEnv)).digest("hex");
  const stampFile = resolve(RUN_DIR, "web-build.json");
  const buildId = resolve(WEB_DIR, ".next/BUILD_ID");
  const stamp = existsSync(stampFile)
    ? (JSON.parse(readFileSync(stampFile, "utf8")) as { fingerprint?: string; buildId?: string })
    : {};
  const current = existsSync(buildId) ? readFileSync(buildId, "utf8").trim() : null;
  if (
    process.env.E2E_REUSE_BUILD === "1" &&
    current &&
    stamp.fingerprint === fingerprint &&
    stamp.buildId === current
  ) {
    console.log(`[e2e] build de la web reutilizada (${current})`);
    return;
  }
  console.log("[e2e] next build con el entorno E2E…");
  const result = spawnSync("pnpm", ["exec", "next", "build"], {
    cwd: WEB_DIR,
    env: { ...env, NODE_ENV: "production" },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const built = readFileSync(buildId, "utf8").trim();
  writeFileSync(stampFile, JSON.stringify({ fingerprint, buildId: built }));
}

function command(): { cwd: string; args: string[]; extraEnv?: Record<string, string> } {
  switch (name) {
    case "web":
      buildWebIfNeeded();
      return {
        cwd: WEB_DIR,
        args: ["exec", "next", "start", "-p", String(WEB_PORT)],
        extraEnv: { NODE_ENV: "production" },
      };
    case "colyseus":
      return { cwd: resolve(REPO_ROOT, "packages/colyseus-server"), args: ["start"] };
    case "editor-sync":
      return { cwd: WEB_DIR, args: ["editor-sync"] };
    default:
      console.error(`servidor desconocido: ${String(name)} (web | colyseus | editor-sync)`);
      process.exit(2);
  }
}

const { cwd, args, extraEnv } = command();
const log = createWriteStream(resolve(RUN_DIR, `${name}.log`), { flags: "w" });
const child = spawn("pnpm", args, { cwd, env: { ...env, ...extraEnv } });
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk: Buffer) => {
    log.write(chunk);
    process.stdout.write(chunk);
  });
}
child.on("exit", (code) => {
  log.end();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => child.kill(signal));
}
