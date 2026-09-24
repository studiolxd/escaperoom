import { resolveActorFromRequest } from "@/server/context";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";
import { withRateLimit } from "@/server/rate-limit";
import { createOnboardingHandlers } from "@/server/rest/onboarding";
import { getRoomDraftService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/rooms — paso 2 del wizard del creador (ticket 6.7,
 * specs/20 §2, §3): crea el draft de la primera sala del creador, en blanco o
 * como copia editable del Rey Aldric. Cuota "onboarding-room-create" (A-9):
 * cada llamada persiste un doc Yjs completo, no es gratis repetirla.
 */
export const POST = withRateLimit("onboarding-room-create", (request: Request) =>
  createOnboardingHandlers({
    drafts: getRoomDraftService(),
    resolveActor: resolveActorFromRequest,
    readReyAldricRoomPackageJson,
  }).postCreateRoom(request),
);
