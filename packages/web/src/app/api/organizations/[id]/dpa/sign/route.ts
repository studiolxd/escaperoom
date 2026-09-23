import { resolveActorFromRequest } from "@/server/context";
import {
  createOrganizationHandlers,
  type OrganizationRouteContext,
} from "@/server/rest/organizations";
import { getOrganizationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createOrganizationHandlers({
    organizations: getOrganizationService(),
    resolveActor: resolveActorFromRequest,
  });

/**
 * POST /api/organizations/:id/dpa/sign — `{ version }`: el propietario o un
 * administrador acepta el DPA vigente (ticket 5.11, specs/18 §3.1). Hasta
 * entonces la organización no puede generar claves con email ni enviar invitaciones.
 */
export function POST(request: Request, ctx: OrganizationRouteContext) {
  return handlers().postSignDpa(request, ctx);
}
