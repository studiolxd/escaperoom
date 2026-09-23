import { DEFAULT_LOCALE, LOCALES } from "@escaperoom/config/locales";
import type { RoomPackage } from "@escaperoom/shared/schemas";

/**
 * Enlaces a la web que el MCP devuelve al agente (ticket 4.5): la partida de
 * prueba de `preview` y la pantalla de confirmación de `publish`. Van con el
 * prefijo de idioma (`localePrefix: "always"`), en el idioma por defecto de la
 * sala si la web lo tiene.
 */

/**
 * Puerto del playtest de 3.8: lo implementa `PlaytestLauncher` de
 * `packages/web/src/server/playtest-launcher.ts` (cliente de la ruta interna
 * de Colyseus). Congela el `RoomPackage` en una room temporal y firma el link.
 */
export type PreviewPlaytestLauncher = {
  create(input: { roomPackage: RoomPackage; authorId: string; draftRoomId: string }): Promise<{
    playtestId: string;
    token: string;
    /** Epoch ms. */
    expiresAt: number;
  }>;
};

/**
 * Ruta (sin locale) de la pantalla de confirmación de una publicación
 * (`packages/web/src/app/[locale]/publish-confirm/page.tsx`).
 */
export function publishConfirmPath(token: string): string {
  return `/publish-confirm?token=${encodeURIComponent(token)}`;
}

/** Ruta (sin locale) de la partida de prueba (la misma que `playtestPath` de web). */
export function previewPath(token: string): string {
  return `/playtest/${encodeURIComponent(token)}`;
}

/** URL absoluta en la web, en el idioma de la sala (o el por defecto). */
export function appLink(appUrl: string, language: string | undefined, path: string): string {
  const locale = (LOCALES as readonly string[]).includes(language ?? "")
    ? language!
    : DEFAULT_LOCALE;
  return `${appUrl.replace(/\/+$/u, "")}/${locale}${path}`;
}
