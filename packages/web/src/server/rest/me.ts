import { MeError, type Actor, type MeErrorCode, type MeService } from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE } from "./_http";

export type MeHandlerDeps = {
  me: MeService;
  resolveActor: (request: Request) => Promise<Actor>;
};

const STATUS_BY_CODE: Record<MeErrorCode, number> = {
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
};

const handle = handleDomainErrors(MeError, STATUS_BY_CODE);

/** `GET /api/me` (A-24): perfil vía `MeService`, nunca `auth.api.getSession` directo. */
export function createMeHandlers(deps: MeHandlerDeps) {
  return {
    async getMe(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const profile = await deps.me.getProfile(actor);
        return Response.json(profile, { headers: NO_STORE });
      });
    },
  };
}
