import { Pool } from "pg";
import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { CURRENT_TERMS_VERSION } from "@escaperoom/shared/legal-acceptance";
import { LOCALE, WEB_URL, databaseUrl } from "./env";

/** Cabeceras de una petición «del propio sitio» (Better Auth comprueba el Origin). */
export const SAME_ORIGIN = { origin: WEB_URL } as const;

/**
 * Consulta la tabla `verification` con `pg` directo, no con el cliente
 * Prisma de `@escaperoom/shared/db`. Sigue haciendo falta tras la migración a
 * Prisma 7 (generador `prisma-client`, sin motor de Rust): el cliente
 * generado (`packages/shared/generated/client/client.ts`) importa sus
 * propios ficheros internos (`./enums`, `./internal/class`…) sin extensión,
 * que Next (webpack/turbopack) y tsx (worker/colyseus-server/editor-sync)
 * resuelven con su propio loader, pero el loader ESM estricto de Playwright
 * no («Cannot find module '.../enums' imported from '.../client.ts'», antes
 * «Directory import ... is not supported» con el generador anterior — mismo
 * problema de fondo, solo cambia dónde aparece). Un pool propio, sin ese
 * salto de paquete, evita el problema y no toca código de producción.
 */
let pool: Pool | undefined;
function verificationPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL ?? databaseUrl(), max: 1 });
  return pool;
}

/**
 * Token del enlace mágico de `email` emitido después de `after`: Better Auth
 * (plugin `magic-link`, `storeToken: "plain"` por defecto) guarda una fila en
 * `verification` con `identifier` = el token en claro y `value` = el JSON
 * `{email, name}` (A-1: ya no se imprime en ningún log — antes de A-1 esta
 * función leía `.run/web.log`).
 */
async function waitForMagicLinkToken(email: string, after: Date): Promise<string> {
  const db = verificationPool();
  let token: string | undefined;
  await expect
    .poll(
      async () => {
        const { rows } = await db.query<{ identifier: string; value: string }>(
          `select identifier, value from verification where "createdAt" >= $1 order by "createdAt" desc limit 20`,
          [after],
        );
        const match = rows.find((row) => {
          try {
            return (JSON.parse(row.value) as { email?: unknown }).email === email;
          } catch {
            return false;
          }
        });
        token = match?.identifier;
        return token;
      },
      {
        message: `token del enlace mágico de ${email} en la tabla verification (DATABASE_URL=${process.env.DATABASE_URL ?? databaseUrl()})`,
        timeout: 15_000,
      },
    )
    .toBeTruthy();
  return token!;
}

/**
 * Inicia sesión como `email` por el flujo real de Better Auth (enlace
 * mágico): pide el enlace, lee su token de `verification` (Postgres) y
 * verifica la misma URL que construiría Better Auth, con el `request` del
 * contexto (guarda la cookie de sesión para sus páginas).
 */
export async function signIn(context: BrowserContext, email: string): Promise<void> {
  await signInRequest(context.request, email);
}

export async function signInRequest(request: APIRequestContext, email: string): Promise<void> {
  const after = new Date();
  const callbackURL = `/${LOCALE}`;
  const asked = await request.post(`${WEB_URL}/api/auth/sign-in/magic-link`, {
    headers: SAME_ORIGIN,
    data: { email, callbackURL },
  });
  expect(asked.ok(), `sign-in/magic-link → ${asked.status()} ${await asked.text()}`).toBe(true);
  const token = await waitForMagicLinkToken(email, after);
  const verifyUrl = new URL(`${WEB_URL}/api/auth/magic-link/verify`);
  verifyUrl.searchParams.set("token", token);
  verifyUrl.searchParams.set("callbackURL", callbackURL);
  const verified = await request.get(verifyUrl.toString(), { maxRedirects: 0 });
  expect(verified.status(), `verificación del enlace mágico → ${verified.status()}`).toBeLessThan(
    400,
  );
  const me = await request.get(`${WEB_URL}/api/me`);
  expect(me.ok(), `/api/me tras iniciar sesión → ${me.status()}`).toBe(true);
  await acceptCurrentTerms(email);
}

/**
 * `(creator)`/`(play)` bloquean con un gate de reaceptación (`/legal/reaccept`)
 * a cualquier sesión cuyo `termsAcceptedVersion` no sea el vigente
 * (`CURRENT_TERMS_VERSION`) — nunca lo es recién sembrado o recién creado por
 * enlace mágico (`termsAcceptedVersion` nace `null`). La suite no prueba ese
 * gate (no hay ningún spec de reaceptación): todo `signIn` lo deja al día por
 * Postgres directo, para no tener que hacer clic en «Aceptar y continuar» en
 * cada test que entra en esas dos áreas.
 */
async function acceptCurrentTerms(email: string): Promise<void> {
  const db = verificationPool();
  await db.query('update "user" set "termsAcceptedVersion" = $1 where email = $2', [
    CURRENT_TERMS_VERSION,
    email,
  ]);
}

/** Fija la organización activa de la sesión (el actor de los servicios la lee de ahí). */
export async function setActiveOrganization(
  request: APIRequestContext,
  organizationId: string,
): Promise<void> {
  const res = await request.post(`${WEB_URL}/api/auth/organization/set-active`, {
    headers: SAME_ORIGIN,
    data: { organizationId },
  });
  expect(res.ok(), `organization/set-active → ${res.status()} ${await res.text()}`).toBe(true);
}
