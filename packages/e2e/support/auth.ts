import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { LOCALE, RUN_DIR, WEB_URL } from "./env";

const WEB_LOG = resolve(RUN_DIR, "web.log");

/** Cabeceras de una petición «del propio sitio» (Better Auth comprueba el Origin). */
export const SAME_ORIGIN = { origin: WEB_URL } as const;

function logSize(): number {
  return existsSync(WEB_LOG) ? statSync(WEB_LOG).size : 0;
}

/**
 * Enlace mágico de `email` impreso por la web **después** de `offset`: Better
 * Auth lo escribe en consola (`[magic-link] email → url`, `lib/auth.ts`) en
 * lugar de enviarlo, y `scripts/serve.ts` guarda esa consola en `.run/web.log`.
 */
async function waitForMagicLink(email: string, offset: number): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        if (!existsSync(WEB_LOG)) return undefined;
        // `offset` es en bytes (la «→» del log ocupa 3): se corta el Buffer, no el texto.
        const text = readFileSync(WEB_LOG).subarray(offset).toString("utf8");
        const lines = text.split("\n").filter((line) => line.includes(`[magic-link] ${email} → `));
        link = lines.at(-1)?.split(" → ")[1]?.trim();
        return link;
      },
      {
        message: `enlace mágico de ${email} en ${WEB_LOG} (¿servidores reutilizados sin log?)`,
        timeout: 15_000,
      },
    )
    .toBeTruthy();
  return link!;
}

/**
 * Inicia sesión como `email` por el flujo real de Better Auth (enlace mágico):
 * pide el enlace, lo lee del «buzón» (el log de la web) y lo abre con el
 * `request` del contexto, que guarda la cookie de sesión para sus páginas.
 */
export async function signIn(context: BrowserContext, email: string): Promise<void> {
  await signInRequest(context.request, email);
}

export async function signInRequest(request: APIRequestContext, email: string): Promise<void> {
  const offset = logSize();
  const asked = await request.post(`${WEB_URL}/api/auth/sign-in/magic-link`, {
    headers: SAME_ORIGIN,
    data: { email, callbackURL: `/${LOCALE}` },
  });
  expect(asked.ok(), `sign-in/magic-link → ${asked.status()} ${await asked.text()}`).toBe(true);
  const link = await waitForMagicLink(email, offset);
  const verified = await request.get(link, { maxRedirects: 0 });
  expect(verified.status(), `verificación del enlace mágico → ${verified.status()}`).toBeLessThan(
    400,
  );
  const me = await request.get(`${WEB_URL}/api/me`);
  expect(me.ok(), `/api/me tras iniciar sesión → ${me.status()}`).toBe(true);
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
