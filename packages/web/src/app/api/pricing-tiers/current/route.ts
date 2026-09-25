import { getPricingTierService } from "@/server/services";
import { NO_STORE } from "@/server/rest/_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pricing-tiers/current — público, sin sesión: los tramos vigentes
 * ahora mismo (`PricingSnapshot`, specs/02 §3.2), la misma proyección que se
 * congela en `event.pricingSnapshot` al crear un evento. Solo lectura, sin
 * datos sensibles (precio por jugador es información pública del catálogo);
 * la usa el flujo mínimo de "Organizar un evento con esta sala" (punto h de
 * "CTA Jugar", `docs/DEUDA.md`) para mostrar el precio por jugador antes de
 * crear el evento.
 */
export async function GET(): Promise<Response> {
  const snapshot = await getPricingTierService().snapshotAt();
  return Response.json(snapshot, { headers: NO_STORE });
}
