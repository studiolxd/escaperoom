/**
 * `?callbackURL=` de `/login` y `/signup` (punto c de "CTA Jugar",
 * `docs/DEUDA.md`): vuelta a la sala tras iniciar sesión desde el CTA de
 * compra. Solo rutas propias y absolutas (`/es/rooms/…`) — nunca un origen
 * externo (open redirect) ni `//host` (protocol-relative, mismo riesgo).
 */
export function safeCallbackURL(
  value: string | string[] | undefined,
  fallback = "/",
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}
