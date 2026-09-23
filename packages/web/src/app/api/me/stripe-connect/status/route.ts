import { resolveActorFromRequest } from "@/server/context";
import { createCreatorConnectHandlers } from "@/server/rest/creator-connect";
import { getCreatorConnectService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/stripe-connect/status — `not_started | pending | complete` (specs/13 §2). */
export function GET(request: Request) {
  return createCreatorConnectHandlers({
    connect: getCreatorConnectService(),
    resolveActor: resolveActorFromRequest,
    buildUrls: () => ({ refreshUrl: "", returnUrl: "" }),
  }).getStripeConnectStatus(request);
}
