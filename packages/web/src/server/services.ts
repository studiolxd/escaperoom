import path from "node:path";
import { storage } from "@escaperoom/kit/storage";
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
  createRoomDraftService,
  type AudioAssetService,
  type AudioBlobStore,
  type CatalogService,
  type PlatformSettingsService,
  type PricingTierService,
  type RoomDraftService,
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
  put: (key, bytes, contentType) => storage.putObject({ key, body: Buffer.from(bytes), contentType }),
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
