import { logger } from "@escaperoom/kit/logger";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ModerationError,
  type Actor,
  type IntroMediaService,
  type ModerationService,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE } from "./_http";

/** Vida de las URLs firmadas del visor de moderación. */
export const MODERATION_MODEL_URL_TTL_SECONDS = 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ModerationModelsDeps = {
  moderation: Pick<ModerationService, "authorizeModeration">;
  introMedia: Pick<IntroMediaService, "describeModel" | "resolveMediaRef" | "signedUrl">;
  resolveActor: (request: Request) => Promise<Actor>;
  /** Última versión PUBLICADA de la sala (aunque la sala esté despublicada por moderación). */
  loadLatestPublishedPackage: (roomId: string) => Promise<RoomPackage | null>;
};

export type ModerationModelsRouteContext = { params: Promise<{ roomId: string }> };

const handle = handleDomainErrors(ModerationError, {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
});

/**
 * `GET /api/admin/moderation/rooms/:roomId/models` (specs/13, specs/17): modelos propios de la
 * última versión publicada de una sala reportada, con URL firmada (1 h) y medidas, para el visor
 * 3D de la cola. Mismo guard que el resto de la cola (`isModerator | isAdmin`).
 */
export function createModerationModelsHandlers(deps: ModerationModelsDeps) {
  return {
    async listRoomModels(request: Request, ctx: ModerationModelsRouteContext): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        await deps.moderation.authorizeModeration(actor);
        const { roomId } = await ctx.params;
        const roomPackage = UUID_RE.test(roomId) ? await deps.loadLatestPublishedPackage(roomId) : null;
        const entries = Object.entries(roomPackage?.world3d?.models ?? {});
        const models = await Promise.all(
          entries.map(async ([id, model]) => {
            try {
              const described = await deps.introMedia.describeModel(null, model.ref);
              const key = await deps.introMedia.resolveMediaRef(null, model.ref);
              const url = await deps.introMedia.signedUrl(key, {
                expiresIn: MODERATION_MODEL_URL_TTL_SECONDS,
              });
              return {
                id,
                label: model.label,
                url,
                size: described.size,
                triangles: described.triangles,
                byteSize: described.byteSize,
                clips: described.clips,
              };
            } catch (err) {
              logger.warn({ err, roomId, modelId: id }, "moderation-models: modelo no describible (se omite)");
              return null;
            }
          }),
        );
        return Response.json(
          { models: models.filter((m) => m !== null) },
          { headers: NO_STORE },
        );
      });
    },
  };
}

/** Lector Prisma de la última versión publicada (el visor no depende del estado de la sala). */
export function createPrismaLatestPublishedPackage(db: {
  roomVersion: {
    findFirst(args: {
      where: { roomId: string };
      orderBy: { publishedAt: "desc" };
      select: { package: true };
    }): Promise<{ package: unknown } | null>;
  };
}) {
  return async (roomId: string): Promise<RoomPackage | null> => {
    const version = await db.roomVersion.findFirst({
      where: { roomId },
      orderBy: { publishedAt: "desc" },
      select: { package: true },
    });
    return version ? parseRoomPackage(version.package) : null;
  };
}
