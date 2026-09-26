"use server";

import { headers } from "next/headers";
import { clientIpFromHeaders } from "@escaperoom/kit/rate-limit/http";
import { isAnonymous } from "@escaperoom/shared/services";
import { resolveActorFromHeaders } from "@/server/context";
import { getTermsAcceptanceService } from "@/server/services";
import {
  actionError,
  actionOk,
  consumeActionRateLimit,
  rateLimitedActionError,
  type ActionResult,
} from "@/server/actions/action-result";

export type AcceptTermsData = { version: string };

/**
 * `clientIpFromHeaders` (A-7): la primera entrada de `x-forwarded-for` la
 * escribe el cliente, así que confiar en ella deja que cualquiera declare la
 * IP que quiera en `termsAcceptance.ipAddress` (evidencia legal) — misma
 * lógica que `server/rest/legal-acceptance.ts`.
 */
function requestMeta(hdrs: Headers): { ipAddress: string | null; userAgent: string | null } {
  const ip = clientIpFromHeaders(hdrs);
  return {
    ipAddress: ip === "unknown" ? null : ip,
    userAgent: hdrs.get("user-agent") || null,
  };
}

/**
 * Server action de `AcceptTermsButton`: mismo `TermsAcceptanceService.accept`
 * que `POST /api/legal/terms-acceptance` (`server/rest/legal-acceptance.ts`,
 * que sigue existiendo). Cuota `terms-acceptance-write`, igual que la ruta REST.
 */
export async function acceptTerms(): Promise<ActionResult<AcceptTermsData>> {
  const rateLimit = await consumeActionRateLimit("terms-acceptance-write");
  if (!rateLimit.ok) return rateLimitedActionError();

  const hdrs = await headers();
  const actor = await resolveActorFromHeaders(hdrs);
  if (isAnonymous(actor)) return actionError("UNAUTHORIZED", "No hay sesión");

  const row = await getTermsAcceptanceService().accept(actor.userId, requestMeta(hdrs));
  return actionOk({ version: row.version });
}
