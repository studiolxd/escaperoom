import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createLegalAcceptanceHandlers } from "@/server/rest/legal-acceptance";
import { getTermsAcceptanceService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handlers() {
  return createLegalAcceptanceHandlers({
    termsAcceptance: getTermsAcceptanceService(),
    resolveActor: resolveActorFromRequest,
  });
}

/** GET /api/legal/terms-acceptance — estado del usuario autenticado frente a la versión vigente. */
export function GET(request: Request) {
  return handlers().getStatus(request);
}

/** POST /api/legal/terms-acceptance — registra la aceptación de la versión vigente. */
export const POST = withRateLimit("terms-acceptance-write", (request: Request) =>
  handlers().accept(request),
);
