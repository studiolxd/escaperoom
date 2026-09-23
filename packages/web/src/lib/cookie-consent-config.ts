import type { ConsentCookieConfig } from "@/lib/cookie-consent";

/** Catálogo de categorías opcionales (véase `content/legal/cookies.ts` §2). */
export const CONSENT_CATEGORIES = ["analytics", "marketing", "preferences"] as const;

export type ConsentCategoryId = (typeof CONSENT_CATEGORIES)[number];

/**
 * Categorías opcionales con alguna cookie activa hoy. Vacío: ni Google
 * Analytics (planificado, no activo — `content/legal/cookies.ts` §3) ni
 * marketing ni preferencias tienen ninguna cookie que gestionar todavía.
 * Con esta lista vacía, `hasConsentUI()` es `false` y ni la banda ni el
 * enlace de preferencias se muestran a usuarios reales — el mecanismo queda
 * listo para cuando se active la primera cookie opcional (típicamente GA).
 */
export const ACTIVE_OPTIONAL_CATEGORIES: readonly ConsentCategoryId[] = [];

export function hasConsentUI(): boolean {
  return ACTIVE_OPTIONAL_CATEGORIES.length > 0;
}

export const CONSENT_COOKIE_CONFIG: ConsentCookieConfig = {
  cookieName: "cookie_consent",
  version: 1,
  maxAge: 60 * 60 * 24 * 180, // 180 días
};
