/**
 * Piezas compartidas por varios servicios de dominio (auditoría 2026-09-24,
 * §9.1): antes reimplementadas de forma idéntica en ≥12 ficheros, incluido
 * `catalog-listing.ts` (A-22). El `AdminDirectory` Prisma único vive en
 * `admin-prisma-store.ts` (capa que ya conocía Prisma) y lo reutilizan
 * `purchases-prisma-store.ts`, `events-prisma-store.ts` y
 * `room-publish-prisma-store.ts`.
 */
import { isAnonymous, type Actor } from "./actor";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Exige actor autenticado o lanza `new ErrorClass("UNAUTHORIZED", "No hay
 * sesión")` — mismo código y mensaje en todos los servicios antes de esta
 * unificación. `Code` se infiere del propio `ErrorClass` (cada dominio tiene
 * su unión de códigos), y los parámetros extra de su constructor (`issues`,
 * `details`, …) quedan sin usar aquí.
 */
export function requireUser<Code extends string, E extends Error>(
  actor: Actor,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- constructores de dominio con parámetros extra variables (issues, details, …)
  ErrorClass: new (code: Code, message: string, ...rest: any[]) => E,
): void {
  if (isAnonymous(actor)) throw new ErrorClass("UNAUTHORIZED" as Code, "No hay sesión");
}

/** Reparto plataforma/creador de una venta (specs/02): 30 % plataforma (redondeado), resto al creador. */
export const PLATFORM_FEE_RATE = 0.3;

export function splitPlatformFee(
  amountCents: number,
  rate: number = PLATFORM_FEE_RATE,
): { platformFeeCents: number; creatorShareCents: number } {
  const platformFeeCents = Math.round(amountCents * rate);
  return { platformFeeCents, creatorShareCents: amountCents - platformFeeCents };
}
