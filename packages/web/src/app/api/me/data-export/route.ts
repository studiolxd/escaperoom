import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createUserDataRightsHandlers } from "@/server/rest/user-data-rights";
import { getUserDataRightsService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/data-export — export completo de los datos del usuario
 * autenticado en JSON descargable (portabilidad, ticket 6.2, specs/18 §3.4).
 */
export const GET = withRateLimit("account-rights", (request: Request) =>
  createUserDataRightsHandlers({
    userDataRights: getUserDataRightsService(),
    resolveActor: resolveActorFromRequest,
  }).getDataExport(request),
);
