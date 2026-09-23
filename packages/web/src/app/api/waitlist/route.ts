import { withRateLimit } from "@/server/rate-limit";
import { createWaitlistHandler } from "@/server/rest/waitlist";
import { getWaitlistService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/waitlist — waitlist pública de la landing (ticket 6.7, specs/20 §1,
 * §5, specs/25 §2.1). Sin sesión: cualquier visitante puede apuntar su email.
 */
export const POST = withRateLimit("waitlist-join", (request: Request) =>
  createWaitlistHandler({ waitlist: getWaitlistService() }).postJoin(request),
);
