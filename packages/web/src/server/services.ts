import path from "node:path";
import { storage } from "@escaperoom/kit/storage";
import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import type { RoomPackageSerializer } from "@escaperoom/editor/validation";
import { prisma } from "@escaperoom/shared/db";
import { EVENT_ROOM_NAME } from "@/lib/colyseus";
import {
  createAudioAssetService,
  createPrismaAudioAssetStore,
  createCatalogService,
  createPrismaPublishedRoomListing,
  createPrismaReviewStore,
  createReviewService,
  type ReviewService,
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
  createAccessKeyService,
  createPrismaAccessKeyStore,
  createRedeemService,
  readJoinTokenConfig,
  type AccessKeyService,
  type RedeemService,
  type EventService,
  createPrismaRoomLicenseStore,
  createRoomLicenseService,
  type RoomLicenseService,
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
let reviews: ReviewService | undefined;
let accessKeys: AccessKeyService | undefined;
let redeem: RedeemService | null | undefined;
let roomLicenses: RoomLicenseService | undefined;

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

/** Reseñas de salas (specs/13 §3): upsert por usuario y sala, elegibilidad por compra/partida. */
export function getReviewService(): ReviewService {
  reviews ??= createReviewService({ store: createPrismaReviewStore(prisma) });
  return reviews;
}

/** Servicio del draft Yjs del editor (specs/09 §2) sobre Postgres. */
export function getRoomDraftService(): RoomDraftService {
  roomDrafts ??= createRoomDraftService({ store: createPrismaRoomDraftStore(prisma) });
  return roomDrafts;
}

/**
 * Doc Yjs del draft → `RoomPackage` para `POST /api/rooms/:roomId/validate`:
 * la serialización del editor (ticket 3.1), la misma que usan la publicación y
 * el MCP. El handler admite `null` (501) para tests y despliegues sin ella.
 */
export function getDraftSerializer(): RoomPackageSerializer | null {
  return roomDocToPackage;
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
 * (R2/S3 vía `@escaperoom/kit/storage`). El doc Yjs del draft se congela con
 * la serialización del editor (`roomDocToPackage`, ticket 3.1). Los audios
 * pasan por el servicio de 3.11: pendientes o rechazados bloquean la publicación.
 */
export function getRoomPublishService(): RoomPublishService {
  if (!roomPublish) {
    roomPublish = createRoomPublishService({
      store: createPrismaRoomPublishStore(prisma),
      drafts: createPrismaRoomDraftStore(prisma),
      serializer: roomDocToPackage,
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

/**
 * Claves de acceso (specs/02 §4, specs/13 §6.2) sobre Postgres. Envuelve la
 * activación de 5.4 para crear sesiones y claves al pasar a `active`. La
 * caducidad la aplica el job de `@escaperoom/worker`.
 */
export function getAccessKeyService(): AccessKeyService {
  accessKeys ??= createAccessKeyService({
    store: createPrismaAccessKeyStore(prisma),
    events: getEventService(),
  });
  return accessKeys;
}

/**
 * Canje de claves (ticket 5.8): consume el asiento con `consumeSeat` y firma el
 * `joinToken` que exige la room `event` de Colyseus (`JOIN_TOKEN_SECRET`,
 * compartido con colyseus-server). `null` si falta el secreto en producción.
 */
export function getRedeemService(): RedeemService | null {
  if (redeem !== undefined) return redeem;
  const joinToken = readJoinTokenConfig();
  redeem = joinToken
    ? createRedeemService({
        store: createPrismaAccessKeyStore(prisma),
        accessKeys: getAccessKeyService(),
        joinToken,
        colyseusEndpoint: process.env.NEXT_PUBLIC_COLYSEUS_URL?.trim() || "ws://localhost:2567",
        roomName: EVENT_ROOM_NAME,
      })
    : null;
  return redeem;
}

/**
 * Licencias entre creadores (specs/02 §5, specs/13 §4) sobre Postgres. El fork
 * se siembra con `roomPackageToDoc` (3.1) a partir del `package` congelado.
 * `payments: null` hasta que 5.1 cablee Stripe (mismo puerto que eventos): una
 * licencia con precio responde 501 `PAYMENT_GATEWAY_UNAVAILABLE`; el regalo y
 * la licencia gratuita no lo necesitan.
 */
export function getRoomLicenseService(): RoomLicenseService {
  roomLicenses ??= createRoomLicenseService({
    store: createPrismaRoomLicenseStore(prisma),
    buildDoc: (pkg) => roomPackageToDoc(pkg),
    payments: null,
  });
  return roomLicenses;
}
