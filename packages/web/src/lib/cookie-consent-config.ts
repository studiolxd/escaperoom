import type { ConsentCookieConfig } from "@/lib/cookie-consent";

/** Catálogo de categorías opcionales (véase `content/legal/cookies.ts` §2). */
export const CONSENT_CATEGORIES = ["analytics", "marketing", "preferences"] as const;

export type ConsentCategoryId = (typeof CONSENT_CATEGORIES)[number];

/**
 * Categorías opcionales con alguna cookie activa hoy. Google Analytics
 * (`_ga`/`_ga_*`) es la única con cookie propia — Plausible no usa cookies
 * (`content/legal/cookies.ts` §3) — así que "analytics" solo entra en la
 * lista cuando `NEXT_PUBLIC_GA_MEASUREMENT_ID` está configurado
 * (`components/analytics/google-analytics-script.tsx`). Marketing y
 * preferencias siguen sin ninguna cookie que gestionar. Sin GA configurado,
 * la lista queda vacía, `hasConsentUI()` es `false` y ni la banda ni el
 * enlace de preferencias se muestran.
 */
export const ACTIVE_OPTIONAL_CATEGORIES: readonly ConsentCategoryId[] = process.env
  .NEXT_PUBLIC_GA_MEASUREMENT_ID
  ? ["analytics"]
  : [];

export function hasConsentUI(): boolean {
  return ACTIVE_OPTIONAL_CATEGORIES.length > 0;
}

export const CONSENT_COOKIE_CONFIG: ConsentCookieConfig = {
  cookieName: "cookie_consent",
  version: 1,
  maxAge: 60 * 60 * 24 * 180, // 180 días
};
