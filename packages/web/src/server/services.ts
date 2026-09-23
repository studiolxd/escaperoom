import path from "node:path";
import { storage } from "@escaperoom/kit/storage";
import type { RoomPackageSerializer } from "@escaperoom/editor/validation";
import { prisma } from "@escaperoom/shared/db";
import {
  createAudioAssetService,
  createPrismaAudioAssetStore,
  createCatalogService,
  createPrismaPublishedRoomListing,
  createJsonFileRoomPackageRepository,
  createPlatformSettingsService,
  createPricingTierService,
  createPrismaPlatformSettingStore,
  createPrismaPricingTierStore,
  createPrismaRoomDraftStore,
  createPrismaRoomPublishStore,
  createRoomDraftService,
  type AudioAssetService,
  type AudioBlobStore,
  createAudioPublishAssetSource,
  createRoomPublishService,
  createEventService,
  createPrismaEventStore,
  type EventService,
  type CatalogService,
  type PlatformSettingsService,
  type PricingTierService,
  type RoomDraftService,
  type RoomPublishService,
} from "@escaperoom/shared/services";

/**
 * Ruta del fixture del Rey Aldric relativa a la raíz del workspace. La app se
 * ejecuta con `cwd` en `packages/web` (dev, build y tests), así que sube dos
 * niveles hasta `docs/`.
 */
const FEATURED_ROOM_FIXTURE = "../../docs/reference/roompackage-rey-aldric.v1.json";

let catalog: CatalogService | undefined;
let roomDrafts: RoomDraftService | undefined;
let platformSettings: PlatformSettingsService | undefined;
let pricingTiers: PricingTierService | undefined;
let audioAssets: AudioAssetService | undefined;
let roomPublish: RoomPublishService | undefined;
let events: EventService | undefined;

/**
 * Composition root de los servicios de dominio en web. tRPC, REST y MCP
 * comparten esta MISMA instancia (ADR-022): no hay lógica en los adaptadores.
 */
export function getCatalogService(): CatalogService {
  catalog ??= createCatalogService({
    rooms: createJsonFileRoomPackageRepository(path.resolve(process.cwd(), FEATURED_ROOM_FIXTURE)),
    listing: createPrismaPublishedRoomListing(prisma),
  });
  return catalog;
}

/** Servicio del draft Yjs del editor (specs/09 §2) sobre Postgres. */
export function getRoomDraftService(): RoomDraftService {
  roomDrafts ??= createRoomDraftService({ store: createPrismaRoomDraftStore(prisma) });
  return roomDrafts;
}

/**
 * Doc Yjs del draft → `RoomPackage` para `POST /api/rooms/:roomId/validate`.
 * La serialización es del ticket 3.1 (runtime en modo edición); hasta que
 * esté en main no hay ninguna y el endpoint responde 501 tras autorizar.
 */
export function getDraftSerializer(): RoomPackageSerializer | null {
  return null;
}

/** Ajustes de plataforma (`platformSetting`, specs/13 §10) sobre Postgres. */
export function getPlatformSettingsService(): PlatformSettingsService {
  platformSettings ??= createPlatformSettingsService({
    store: createPrismaPlatformSettingStore(prisma),
  });
  return platformSettings;
}

/** Tramos de precio versionados (`pricingTier`, specs/02 §3.2) sobre Postgres. */
export function getPricingTierService(): PricingTierService {
  pricingTiers ??= createPricingTierService({ store: createPrismaPricingTierStore(prisma) });
  return pricingTiers;
}

/** Binarios de audio sobre el adaptador S3/R2 de `@escaperoom/kit/storage` (bucket privado). */
const audioBlobs: AudioBlobStore = {
  put: (key, bytes, contentType) =>
    storage.putObject({ key, body: Buffer.from(bytes), contentType }),
  delete: (key) => storage.deleteObject(key),
  signedReadUrl: (key) => storage.getSignedReadUrl(key, { expiresIn: 600 }),
};

/**
 * Audio del creador (biblioteca + subida propia con moderación previa, ticket
 * 3.11). El pre-filtro automático es el manual por defecto (no hay proveedor
 * externo cableado): toda subida queda para la cola humana.
 */
export function getAudioAssetService(): AudioAssetService {
  audioAssets ??= createAudioAssetService({
    store: createPrismaAudioAssetStore(prisma),
    blobs: audioBlobs,
  });
  return audioAssets;
}

/**
 * Publicación de salas (specs/08 §5, specs/13 §4) sobre Postgres y el bucket
 * (R2/S3 vía `@escaperoom/kit/storage`). Piezas pendientes de otros tickets:
 * `serializer: null` hasta que 3.1 aporte el mapeo doc Yjs → RoomPackage
 * (mientras, `POST /publish` responde 501 `SERIALIZER_UNAVAILABLE`). Los audios
 * pasan por el servicio de 3.11: pendientes o rechazados bloquean la publicación.
 */
export function getRoomPublishService(): RoomPublishService {
  if (!roomPublish) {
    roomPublish = createRoomPublishService({
      store: createPrismaRoomPublishStore(prisma),
      drafts: createPrismaRoomDraftStore(prisma),
      serializer: null,
      assets: createAudioPublishAssetSource({
        audio: getAudioAssetService(),
        readObject: async (key) => {
          const { buffer, contentType } = await storage.getObjectBuffer(key);
          return { bytes: new Uint8Array(buffer), contentType };
        },
      }),
      storage: {
        put: (key, bytes, contentType) =>
          storage.putObject({ key, body: Buffer.from(bytes), contentType }),
      },
    });
  }
  return roomPublish;
}

/**
 * Eventos B2B/B2Edu (specs/02 §3, specs/13 §6.1) sobre Postgres. El precio sale
 * de los tramos de 3.12 (`snapshotAt`). `payments: null` hasta que 5.1 cablee
 * Stripe Checkout: mientras, `POST /api/events/:id/checkout` responde 501
 * `PAYMENT_GATEWAY_UNAVAILABLE` (la autoventa del autor no lo necesita).
 */
export function getEventService(): EventService {
  events ??= createEventService({
    store: createPrismaEventStore(prisma),
    pricing: getPricingTierService(),
    payments: null,
  });
  return events;
}
