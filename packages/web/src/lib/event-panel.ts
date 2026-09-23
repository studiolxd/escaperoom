/**
 * Rutas del panel del organizador (ticket 5.9). Puras para poder testearlas y
 * compartirlas entre el panel y la página de observador.
 */

/** `/api/events/:id/<suffix>` con el id escapado. */
export function eventApiPath(eventId: string, suffix: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/${suffix}`;
}

/** Página del panel (sin locale: la añade el `Link` de next-intl). */
export function dashboardPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

/** Página de observador de una sesión (sin locale). */
export function observePath(eventId: string, sessionId: string): string {
  return `${dashboardPath(eventId)}/sessions/${encodeURIComponent(sessionId)}/observe`;
}

/** Código de error de una respuesta REST (`{ error: { code } }`), o `UNKNOWN`. */
export async function readApiError(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  return typeof json?.error?.code === "string" ? json.error.code : "UNKNOWN";
}
