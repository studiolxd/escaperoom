import { z } from "zod";

// ---------------------------------------------------------------------------
// Fragmento de cliente — vars NEXT_PUBLIC_* que se empaquetan en el navegador.
// ---------------------------------------------------------------------------

export const baseClientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  // Servidor Colyseus del cliente (ticket 0.5); default ws://localhost:2567.
  NEXT_PUBLIC_COLYSEUS_URL: z.url().optional(),
  // WebSocket de edición del editor (ticket 3.3); default ws://localhost:2568.
  NEXT_PUBLIC_EDITOR_SYNC_URL: z.url().optional(),
  // Sentry en el navegador (ticket 6.4, F-12); sin ella, deshabilitado.
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

/**
 * Analítica de producto (docs/DEUDA.md «Claves reales de analítica antes de
 * desplegar en producción»). Plausible no usa cookies y no requiere
 * consentimiento: sin `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` no carga. Google
 * Analytics sí usa cookies (`_ga`/`_ga_*`): sin `NEXT_PUBLIC_GA_MEASUREMENT_ID`
 * no carga, y aun configurado no se carga hasta que el usuario acepte la
 * categoría "analytics" del consentimiento de cookies (`cookie-consent-config.ts`).
 */
export const analyticsClientSchema = z.object({
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: z.string().optional(),
  // Por defecto https://plausible.io/js/script.js; solo hace falta para un
  // Plausible autoalojado.
  NEXT_PUBLIC_PLAUSIBLE_SRC: z.url().optional(),
  NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
});
