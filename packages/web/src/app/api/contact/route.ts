import { withRateLimit } from "@/server/rate-limit";
import { createContactHandler } from "@/server/rest/contact";
import { getContactService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/contact — público: `{ name, email, message }` → envía el mensaje por email. */
export const POST = withRateLimit("contact-write", (request: Request) =>
  createContactHandler({ contact: getContactService() })(request),
);
