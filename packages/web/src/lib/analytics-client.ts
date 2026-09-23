/**
 * Cliente ligero del punto de colección de analítica (specs/16 §5,
 * `POST /api/analytics/collect`). Fire-and-forget desde componentes cliente:
 * nunca bloquea ni rompe la UI si falla (specs/16 §1).
 */
export function trackAnalyticsEvent(
  eventType: string,
  payload: Record<string, unknown> = {},
): void {
  try {
    void fetch("/api/analytics/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, payload }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort: la analítica nunca debe romper la UI.
  }
}

/** Evento `onboarding_step` (specs/16 §2.1, specs/20 §5): un paso del wizard. */
export function trackOnboardingStep(step: string): void {
  trackAnalyticsEvent("onboarding_step", { step });
}
