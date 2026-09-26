import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { publishDraftUpdate } from "@escaperoom/kit/room-sync";
import { prisma } from "@escaperoom/shared/db";
import {
  createAudioAssetService,
  createAudioPublishAssetSource,
  createCatalogService,
  createCompositePublishAssetSource,
  createIntroMediaPublishAssetSource,
  createIntroMediaService,
  createPrismaIntroMediaStore,
  createJsonFileRoomPackageRepository,
  createModerationService,
  createPrismaAudioAssetStore,
  createPrismaModerationStore,
  createPrismaPublishedRoomListing,
  createPrismaRoomDraftStore,
  createPrismaRoomPublishStore,
  createPublishConfirmationService,
  createRoomDraftService,
  createRoomPublishService,
  readPublishConfirmConfig,
} from "@escaperoom/shared/services";
import { actorFromEnv, MCP_ENV } from "../auth";
import { runStdioServer } from "../transports/stdio";

/**
 * Punto de entrada stdio para Claude Desktop (ver README). Composition root
 * con los MISMOS servicios de dominio que `packages/web/src/server/services.ts`
 * (ADR-022) sobre Postgres (`DATABASE_URL`).
 */
const FEATURED_ROOM_FIXTURE = fileURLToPath(
  new URL("../../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

const actor = actorFromEnv();
if (!actor) {
  console.error(
    `[escaperoom-mcp] Sin identidad: define ${MCP_ENV.userId} (y opcionalmente ${MCP_ENV.organizationId}). Las tools responderán con error de auth.`,
  );
}

/**
 * `publish` (4.5): aquí solo se PIDE la publicación (`checkPublishable`: el
 * validador y la moderación de audios leen Postgres). Los bytes se suben al
 * confirmar en la web, que tiene el bucket; este proceso nunca los toca.
 */
const unavailable = (what: string) => () =>
  Promise.reject(new Error(`${what} no disponible en el MCP por stdio`));
const publishConfig = readPublishConfirmConfig();
const publishRequests = publishConfig
  ? createPublishConfirmationService({
      config: publishConfig,
      publish: createRoomPublishService({
        store: createPrismaRoomPublishStore(prisma),
        drafts: createPrismaRoomDraftStore(prisma),
        serializer: roomDocToPackage,
        assets: createCompositePublishAssetSource({
          audio: createAudioPublishAssetSource({
            audio: createAudioAssetService({
              store: createPrismaAudioAssetStore(prisma),
              blobs: {
                put: unavailable("bucket"),
                delete: unavailable("bucket"),
                signedReadUrl: unavailable("bucket"),
              },
            }),
            readObject: unavailable("bucket"),
          }),
          // Medios de la introducción (`media:<uuid>`): la comprobación solo
          // lee Postgres (existen, son del autor, están listos).
          introMedia: createIntroMediaPublishAssetSource({
            introMedia: createIntroMediaService({
              store: createPrismaIntroMediaStore(prisma),
              blobs: {
                put: unavailable("bucket"),
                delete: unavailable("bucket"),
                signedUploadUrl: unavailable("bucket"),
                head: unavailable("bucket"),
                readRange: unavailable("bucket"),
                signedReadUrl: unavailable("bucket"),
              },
            }),
            readObject: unavailable("bucket"),
          }),
        }),
        storage: { put: unavailable("bucket") },
        // Mismo pre-check y puerta de cuenta que la web (6.1); en seco no escribe.
        moderation: createModerationService({ store: createPrismaModerationStore(prisma) }),
      }),
    })
  : null;

await runStdioServer({
  catalog: createCatalogService({
    rooms: createJsonFileRoomPackageRepository(FEATURED_ROOM_FIXTURE),
    listing: createPrismaPublishedRoomListing(prisma),
  }),
  // Cada proceso stdio del MCP es SU PROPIO proceso (no comparte el
  // `editor-sync` de web): publica en Redis (specs/09 §2, decisión
  // 2026-09-23) para que el `editor-sync` que sí tenga la sala abierta
  // aplique el update y lo reenvíe a sus clientes sin que recarguen. Sin
  // `REDIS_URL`, `publishDraftUpdate` es un no-op — el draft se persiste
  // igual, solo se pierde la propagación en vivo.
  drafts: createRoomDraftService({
    store: createPrismaRoomDraftStore(prisma),
    publish: async (event) => {
      await publishDraftUpdate({ ...event, originId: randomUUID() });
    },
  }),
  roomDocToPackage,
  actor,
  appUrl: process.env[MCP_ENV.appUrl]?.trim() || "http://localhost:3000",
  publishRequests,
  // El lanzador del playtest (3.8) vive en web: por stdio `preview` responde
  // «no disponible» y el creador usa «Jugar» en el editor.
});
