import { resolveActorFromRequest } from "@/server/context";
import { createPublishConfirmHandlers } from "@/server/rest/publish-confirm";
import { getPublishConfirmationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/publish-confirm — `{ token }`. Confirmación humana de la
 * publicación pedida por el MCP (ticket 4.5): publica con el servicio de 3.9
 * solo si el draft sigue siendo el aprobado. Solo el autor, con su sesión.
 */
export function POST(request: Request) {
  return createPublishConfirmHandlers({
    confirmations: getPublishConfirmationService(),
    resolveActor: resolveActorFromRequest,
  }).postConfirm(request);
}
