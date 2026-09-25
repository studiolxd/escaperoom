import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createMeHandlers } from "@/server/rest/me";
import { createUserDataRightsHandlers } from "@/server/rest/user-data-rights";
import { getMeService, getUserDataRightsService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me — perfil del usuario autenticado, sus organizaciones y el saldo
 * de créditos personal (specs/13 §2). Vía `MeService` (A-24): antes esta
 * `route.ts` resolvía la sesión con `auth.api.getSession` directo (saltándose
 * `resolveActorFromRequest`) y traía la organización y `creditAccount`
 * enteras con `include`, sin `no-store`.
 */
export async function GET(request: Request) {
  return createMeHandlers({ me: getMeService(), resolveActor: resolveActorFromRequest }).getMe(
    request,
  );
}

/**
 * DELETE /api/me — cierre de cuenta: anonimiza el perfil y revoca
 * sesiones/credenciales (derecho al olvido, ticket 6.2, specs/18 §3.4). No
 * borra compras, reseñas ni salas ya publicadas (ver
 * `@escaperoom/shared/services/user-data-rights`).
 */
export const DELETE = withRateLimit("account-rights", (request: Request) =>
  createUserDataRightsHandlers({
    userDataRights: getUserDataRightsService(),
    resolveActor: resolveActorFromRequest,
  }).deleteAccount(request),
);
