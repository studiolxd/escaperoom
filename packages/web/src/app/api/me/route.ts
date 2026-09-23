import { auth } from "@/lib/auth";
import { toMeResponse } from "@/lib/me";
import { prisma } from "@escaperoom/shared/db";
import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createUserDataRightsHandlers } from "@/server/rest/user-data-rights";
import { getUserDataRightsService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me — perfil del usuario autenticado, sus organizaciones y el saldo
 * de créditos (personal + por organización) (specs/13 §2).
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "No hay sesión" } },
      { status: 401 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      member: { include: { organization: true } },
      creditAccount: true,
    },
  });

  if (!user) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Usuario no encontrado" } },
      { status: 404 },
    );
  }

  return Response.json(toMeResponse(user));
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
