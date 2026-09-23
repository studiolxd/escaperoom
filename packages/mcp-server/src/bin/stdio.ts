import { fileURLToPath } from "node:url";
import { prisma } from "@escaperoom/shared/db";
import {
  createCatalogService,
  createJsonFileRoomPackageRepository,
  createPrismaPublishedRoomListing,
  createPrismaRoomDraftStore,
  createRoomDraftService,
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

await runStdioServer({
  catalog: createCatalogService({
    rooms: createJsonFileRoomPackageRepository(FEATURED_ROOM_FIXTURE),
    listing: createPrismaPublishedRoomListing(prisma),
  }),
  drafts: createRoomDraftService({ store: createPrismaRoomDraftStore(prisma) }),
  actor,
});
