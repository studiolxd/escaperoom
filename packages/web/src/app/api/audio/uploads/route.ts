import { resolveActorFromRequest } from "@/server/context";
import { createAudioHandlers } from "@/server/rest/audio";
import { getAudioAssetService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createAudioHandlers({ audio: getAudioAssetService(), resolveActor: resolveActorFromRequest });

/** GET /api/audio/uploads — subidas propias con su estado de moderación. */
export function GET(request: Request) {
  return handlers().listMyUploads(request);
}

/** POST /api/audio/uploads — sube un MP3 propio; queda pendiente de moderación (specs/17 §1). */
export function POST(request: Request) {
  return handlers().upload(request);
}
