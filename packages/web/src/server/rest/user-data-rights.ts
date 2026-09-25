import {
  UserDataRightsError,
  type Actor,
  type UserDataRightsErrorCode,
  type UserDataRightsService,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE } from "./_http";

/** Dependencias inyectables de los handlers de derechos RGPD (testeables sin Postgres). */
export type UserDataRightsHandlerDeps = {
  userDataRights: UserDataRightsService;
  resolveActor: (request: Request) => Promise<Actor>;
};

const STATUS_BY_CODE: Record<UserDataRightsErrorCode, number> = {
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  SOLE_ORG_OWNER: 409,
};

const handle = handleDomainErrors(UserDataRightsError, STATUS_BY_CODE);

/** Handlers REST de los derechos RGPD sobre la cuenta propia (specs/18 §3.4). */
export function createUserDataRightsHandlers(deps: UserDataRightsHandlerDeps) {
  return {
    /**
     * `GET /api/me/data-export` — export completo de los datos del usuario
     * autenticado en JSON descargable (portabilidad, specs/18 §3.4).
     */
    async getDataExport(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const json = await deps.userDataRights.exportData(actor);
        return Response.json(json, {
          headers: {
            ...NO_STORE,
            "Content-Disposition": `attachment; filename="escaperoom-data-export-${json.profile.id}.json"`,
          },
        });
      });
    },

    /**
     * `DELETE /api/me` — cierre de cuenta: anonimiza el perfil y revoca
     * sesiones/credenciales (derecho al olvido, specs/18 §3.4).
     */
    async deleteAccount(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const result = await deps.userDataRights.deleteAccount(actor);
        return Response.json(
          { deletedAt: result.deletedAt.toISOString() },
          { headers: NO_STORE },
        );
      });
    },
  };
}
