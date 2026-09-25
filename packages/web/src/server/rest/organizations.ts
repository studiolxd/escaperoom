import {
  OrganizationError,
  type Actor,
  type DpaStatus,
  type OrganizationErrorCode,
  type OrganizationService,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE, readJson } from "./_http";

/** Dependencias inyectables de los handlers de organizaciones (testeables sin Postgres). */
export type OrganizationHandlerDeps = {
  organizations: OrganizationService;
  resolveActor: (request: Request) => Promise<Actor>;
};

/** Contexto de ruta dinámica de Next (App Router): `params` es asíncrono. */
export type OrganizationRouteContext = { params: Promise<{ id: string }> };

const STATUS_BY_CODE: Record<OrganizationErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  DPA_VERSION_MISMATCH: 409,
};

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(OrganizationError, STATUS_BY_CODE);

function dpaJson(s: DpaStatus) {
  return {
    organizationId: s.organizationId,
    currentVersion: s.currentVersion,
    signed: s.signed,
    version: s.version,
    signedBy: s.signedBy,
    signedAt: s.signedAt?.toISOString() ?? null,
  };
}

/** Handlers REST de organizaciones (specs/13 §2, specs/18 §3.4). */
export function createOrganizationHandlers(deps: OrganizationHandlerDeps) {
  return {
    /**
     * `POST /api/organizations/:id/dpa/sign` — `{ version }` → owner/admin acepta
     * el DPA vigente. 200 con el estado de la firma (`alreadySigned` si ya estaba).
     */
    async postSignDpa(request: Request, ctx: OrganizationRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const result = await deps.organizations.signDpa(actor, id, await readJson(request));
        return Response.json(
          { ...dpaJson(result), alreadySigned: result.alreadySigned },
          { headers: NO_STORE },
        );
      });
    },
  };
}
