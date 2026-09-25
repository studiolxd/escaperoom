import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Entorno único de la suite E2E (specs/22 §3.2): los tres procesos (web,
 * colyseus-server y editor-sync) y los tests leen de aquí puertos, URLs y
 * secretos, para que lo que firma uno lo verifique el otro.
 *
 * Puertos propios (3100/2667/2668) y no los de `pnpm dev` (3000/2567/2568):
 * así la suite convive con un entorno de desarrollo arrancado en el mismo
 * equipo o en otro worktree. Todos se pueden sobrescribir por entorno.
 */

export const E2E_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(E2E_ROOT, "../..");
/** Logs de los servidores que arranca Playwright, para depurar un fallo. */
export const RUN_DIR = resolve(E2E_ROOT, ".run");

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} no es un puerto: ${raw}`);
  return value;
}

/**
 * `DATABASE_URL` de la suite: la exportada (CI) o la de `packages/shared/.env`
 * que escribe `pnpm dev:env` (la base propia del worktree, ticket 0.12).
 */
export function databaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = resolve(REPO_ROOT, "packages/shared/.env");
  if (existsSync(file)) {
    const match = /^DATABASE_URL=(.+)$/mu.exec(readFileSync(file, "utf8"));
    if (match?.[1]) return match[1].trim();
  }
  throw new Error(
    "Sin base de datos para la suite E2E: exporta DATABASE_URL o ejecuta `pnpm infra:up && pnpm dev:env`.",
  );
}

export const WEB_PORT = port("E2E_WEB_PORT", 3100);
export const COLYSEUS_PORT = port("E2E_COLYSEUS_PORT", 2667);
export const EDITOR_SYNC_PORT = port("E2E_EDITOR_SYNC_PORT", 2668);

/** `localhost` y no `127.0.0.1`: tiene que coincidir con `BETTER_AUTH_URL` (cookies y Origin). */
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const COLYSEUS_URL = `ws://localhost:${COLYSEUS_PORT}`;
export const COLYSEUS_HTTP_URL = `http://localhost:${COLYSEUS_PORT}`;
export const EDITOR_SYNC_URL = `ws://localhost:${EDITOR_SYNC_PORT}`;

/** Idioma de los tests: los textos que se buscan en la UI son los de `messages/es.json`. */
export const LOCALE = "es";

/** Semilla (`pnpm db:seed`): usuarios y sala publicada con ids fijos. */
export const SEED = {
  adminEmail: "admin@escaperoom.local",
  creatorEmail: "creador@escaperoom.local",
  organizationId: "seed-org",
  reyAldricRoomId: "00000000-0000-0000-0000-000000000301",
} as const;

/**
 * `REDIS_URL` de la suite: la exportada (nightly ya trae un servicio Redis) o
 * `redis://localhost:6379` (servicio del job `e2e-smoke`, mismo puerto que
 * usa `e2e-nightly.yml`; ninguno de los dos lleva contraseña). Necesaria
 * porque web y colyseus arrancan con `NODE_ENV=production`
 * (`scripts/serve.ts`), donde `requireInProduction` (E-4, `@escaperoom/env`)
 * la exige — antes del saneamiento de entorno no hacía falta declararla aquí.
 *
 * En local este default NO es el Redis de `pnpm infra:up` (ese vive en
 * `56380` y, desde E-13, pide contraseña): hace falta uno propio en `6379`
 * (`docker run --rm -p 6379:6379 redis:7-alpine`) o exportar
 * `E2E_REDIS_URL=redis://:redis_dev_only@localhost:56380` para reutilizar el
 * de `infra/docker-compose.dev.yml` — ver `packages/e2e/README.md`.
 */
function redisUrl(): string {
  return process.env.E2E_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";
}

/**
 * Variables de los tres procesos. Secretos fijos de prueba (≥ 32 caracteres):
 * la web y colyseus se sirven con `NODE_ENV=production` (`next start` /
 * `pnpm start`), donde `requireInProduction` (E-4) exige estos valores y no
 * hay secretos de desarrollo por defecto.
 */
export function serverEnv(): Record<string, string> {
  const db = databaseUrl();
  return {
    DATABASE_URL: db,
    DIRECT_URL: process.env.DIRECT_URL ?? db,
    APP_NAME: "EscapeRoom E2E",
    APP_URL: WEB_URL,
    NEXT_PUBLIC_APP_URL: WEB_URL,
    BETTER_AUTH_URL: WEB_URL,
    APP_SECRET: "e2e-app-secret-0123456789abcdef0123456789",
    BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789abcdef01",
    JOIN_TOKEN_SECRET: "e2e-join-token-secret-0123456789abcdef012",
    GAME_ACCESS_TOKEN_SECRET: "e2e-game-access-token-secret-0123456789ab",
    PLAYTEST_SECRET: "e2e-playtest-secret-0123456789abcdef01234",
    PUBLISH_CONFIRM_SECRET: "e2e-publish-confirm-secret-0123456789abcd",
    ANALYTICS_SERVER_SECRET: "e2e-analytics-server-secret-0123456789abc",
    CONFIRMATION_TOKEN_SECRET: "e2e-confirmation-secret-0123456789abcdef0",
    NEXT_PUBLIC_COLYSEUS_URL: COLYSEUS_URL,
    COLYSEUS_INTERNAL_URL: COLYSEUS_HTTP_URL,
    COLYSEUS_PORT: String(COLYSEUS_PORT),
    NEXT_PUBLIC_EDITOR_SYNC_URL: EDITOR_SYNC_URL,
    EDITOR_SYNC_PORT: String(EDITOR_SYNC_PORT),
    EDITOR_SYNC_ALLOWED_ORIGINS: WEB_URL,
    // Redis real (rate limiting REST, como en producción); sin colas
    // (QUEUES_ENABLED=false: nada encola envíos/purgas durante la suite).
    REDIS_URL: redisUrl(),
    QUEUES_ENABLED: "false",
    // Sin servicios externos: email por jsonTransport (sin SMTP: no hay
    // relevo SMTP de prueba en la infra de CI/local), sin LiveKit (la
    // partida degrada a «sin medios») y sin chat del creador. jsonTransport
    // solo se activa fuera de development/test con ALLOW_DEV_SECRETS=1
    // (E-4, `@escaperoom/env`): aquí es deliberado (NODE_ENV=production de
    // prueba, sin SMTP real), no un despliegue real que se olvidó NODE_ENV.
    // El enlace mágico (A-1) igualmente se envía «de verdad» por ese
    // transporte — support/auth.ts lo lee de `verification`, no del
    // resultado del envío.
    ALLOW_DEV_SECRETS: "1",
    EMAIL_PROVIDER: "nodemailer",
    EMAIL_FROM: "no-reply@escaperoom.local",
    EMAIL_FROM_NAME: "EscapeRoom E2E",
    // Dummy: ningún test de la suite ejercita subida/lectura real a S3/R2
    // (solo hace falta que requireInProduction vea la variable presente).
    STORAGE_BUCKET: "escaperoom-e2e-dummy",
    LIVEKIT_URL: "",
    LIVEKIT_API_KEY: "",
    LIVEKIT_API_SECRET: "",
    ANTHROPIC_API_KEY: "",
    // Los límites anti-abuso (ticket 6.3) se quedan **encendidos**: la suite
    // juega a ritmo de persona y comprueba que la UI real cabe en ellos.
  };
}
