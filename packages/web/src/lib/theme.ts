/**
 * Tema claro/oscuro/sistema persistido en una cookie de primera parte (mismo
 * patrón que `NEXT_LOCALE` de next-intl y la cookie de consentimiento).
 *
 * "system" es el valor por defecto (sin cookie) y sigue el
 * `prefers-color-scheme` del sistema operativo. Como el servidor no puede
 * conocer esa preferencia, `THEME_INIT_SCRIPT` la resuelve en el cliente
 * antes del primer pintado (ver `[locale]/layout.tsx`), evitando el
 * parpadeo típico de aplicar el tema tras hidratar.
 */
export type Theme = "light" | "dark" | "system";

export const THEME_COOKIE_NAME = "theme";
export const DEFAULT_THEME: Theme = "system";
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 año

export function isTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/** Valor de cabecera `Set-Cookie`/`document.cookie` para persistir el tema elegido. */
export function themeCookieValue(theme: Theme): string {
  return `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Script de arranque (con el nonce de la CSP de la petición) que aplica la
 * clase `dark` a `<html>` antes del primer pintado: lee la cookie `theme` y,
 * si es "system" o no existe, usa `matchMedia`. Idempotente con la clase que
 * ya puede haber fijado el servidor para "light"/"dark" explícitos (ver
 * `[locale]/layout.tsx`), así que siempre es seguro ejecutarlo.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE_NAME}=([^;]*)/);var v=m?decodeURIComponent(m[1]):"system";var dark=v==="dark"||(v!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}catch(e){}})();`;
