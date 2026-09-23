/**
 * Piezas HTTP del rate limiting de rutas REST (ticket 6.3, specs/13 §11): de
 * qué IP viene la petición y la respuesta 429 con `Retry-After`.
 *
 * Sin imports: solo la API estándar `Request`/`Response`, válida en route
 * handlers de Next y en cualquier servidor Fetch.
 */

/** Código de error REST del 429 (el mismo que el protocolo de Colyseus, specs/11 §7). */
export const RATE_LIMITED_CODE = "RATE_LIMITED" as const;

/**
 * IP del cliente detrás de Cloudflare → proxy del VPS → Next (specs/03, specs/24).
 *
 * Orden: `cf-connecting-ip` (Cloudflare la pone y SOBRESCRIBE la del cliente),
 * `x-real-ip` (el proxy del origen) y, por último, la entrada MÁS A LA DERECHA
 * de `x-forwarded-for`: la que añadió el último salto de confianza. La primera
 * la escribe el cliente y se puede falsear para repartir intentos entre IPs.
 *
 * Supuesto de despliegue: el origen solo acepta tráfico de Cloudflare (si no,
 * `cf-connecting-ip` también es falsificable). Sin ninguna cabecera (tests,
 * dev sin proxy) todas las peticiones comparten la clave `unknown`.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const direct = headers.get("cf-connecting-ip")?.trim() || headers.get("x-real-ip")?.trim();
  if (direct) return direct;
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded?.[forwarded.length - 1] ?? "unknown";
}

/**
 * 429 con la forma de error REST del repo (`{ error: { code, message } }`,
 * specs/13 §1), `Retry-After` en segundos enteros y `no-store`.
 */
export function tooManyRequestsResponse(retryAfterSeconds: number, message?: string): Response {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return Response.json(
    {
      error: {
        code: RATE_LIMITED_CODE,
        message: message ?? `Demasiadas peticiones: vuelve a intentarlo en ${retryAfter} s.`,
        retryAfter,
      },
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
    },
  );
}
