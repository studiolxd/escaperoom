import { fileURLToPath } from "node:url";
import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { prisma } from "@escaperoom/shared/db";
import {
  createAudioAssetService,
  createAudioPublishAssetSource,
  createCatalogService,
  createJsonFileRoomPackageRepository,
  createPrismaAudioAssetStore,
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
        assets: createAudioPublishAssetSource({
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
        storage: { put: unavailable("bucket") },
      }),
    })
  : null;

await runStdioServer({
  catalog: createCatalogService({
    rooms: createJsonFileRoomPackageRepository(FEATURED_ROOM_FIXTURE),
    listing: createPrismaPublishedRoomListing(prisma),
  }),
  drafts: createRoomDraftService({ store: createPrismaRoomDraftStore(prisma) }),
  roomDocToPackage,
  actor,
  appUrl: process.env[MCP_ENV.appUrl]?.trim() || "http://localhost:3000",
  publishRequests,
  // El lanzador del playtest (3.8) vive en web: por stdio `preview` responde
  // «no disponible» y el creador usa «Jugar» en el editor.
});
