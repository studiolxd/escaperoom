import path from "node:path";
import { storage } from "@escaperoom/kit/storage";
import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import type { RoomPackageSerializer } from "@escaperoom/editor/validation";
import { prisma } from "@escaperoom/shared/db";
import { createInvitationEmailQueue, readConfirmationTokenConfig } from "@escaperoom/shared/mail";
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
  createPublishConfirmationService,
  readPublishConfirmConfig,
  type PublishConfirmationService,
  createEventService,
  createPrismaEventStore,
  createAccessKeyService,
  createPrismaAccessKeyStore,
  createRedeemService,
  createColyseusLiveProgressSource,
  createEventPanelService,
  createPrismaEventRuntimeStore,
  type EventPanelService,
  createInvitationService,
  createPrismaInvitationStore,
  AccessKeyError,
  createOrganizationService,
  createPrismaOrganizationStore,
  type OrganizationService,
  readJoinTokenConfig,
  type InvitationService,
  type AccessKeyService,
  type RedeemService,
  createAccessKeyCardsService,
  createPrismaAccessKeyCardStore,
  readExportSigningSecret,
  type AccessKeyCardsService,
  type CardExportBlobStore,
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
import { createBullCardExportQueue } from "@escaperoom/shared/access-key-cards-queue";
import { resolveColyseusHttpUrl } from "./playtest-launcher";

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
let publishConfirmations: PublishConfirmationService | null | undefined;
let events: EventService | undefined;
let reviews: ReviewService | undefined;
let accessKeys: AccessKeyService | undefined;
let redeem: RedeemService | null | undefined;
let roomLicenses: RoomLicenseService | undefined;
let invitations: InvitationService | undefined;
let accessKeyCards: AccessKeyCardsService | undefined;
let organizations: OrganizationService | undefined;
let eventPanel: EventPanelService | undefined;

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
 * Confirmación humana de las publicaciones pedidas por el MCP (ticket 4.5):
 * token firmado con `PUBLISH_CONFIRM_SECRET` sobre `checkPublishable`/`publish`
 * de 3.9. `null` en producción sin secreto (el MCP responde «no disponible»).
 */
export function getPublishConfirmationService(): PublishConfirmationService | null {
  if (publishConfirmations === undefined) {
    const config = readPublishConfirmConfig();
    publishConfirmations = config
      ? createPublishConfirmationService({ publish: getRoomPublishService(), config })
      : null;
  }
  return publishConfirmations;
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
 * Organizaciones y DPA (ticket 5.11, specs/18 §3.1): firma del DPA por
 * owner/admin y la puerta que exigen claves e invitaciones con email.
 */
export function getOrganizationService(): OrganizationService {
  organizations ??= createOrganizationService({ store: createPrismaOrganizationStore(prisma) });
  return organizations;
}

/**
 * Claves de acceso (specs/02 §4, specs/13 §6.2) sobre Postgres. Envuelve la
 * activación de 5.4 para crear sesiones y claves al pasar a `active`. La
 * caducidad la aplica el job de `@escaperoom/worker`. Las claves con email
 * exigen el DPA de la organización activa (5.11).
 */
export function getAccessKeyService(): AccessKeyService {
  accessKeys ??= createAccessKeyService({
    store: createPrismaAccessKeyStore(prisma),
    events: getEventService(),
    dpa: getOrganizationService().dpaGate((message) => new AccessKeyError("DPA_REQUIRED", message)),
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

/**
 * Invitaciones por email y confirmación (ticket 5.6): encola en `mail.invitation`
 * (BullMQ; con `QUEUES_ENABLED=false` el encolado es un no-op y la respuesta
 * dice `queued: 0`) y lo entrega `@escaperoom/worker`. El enlace de
 * confirmación se firma con `CONFIRMATION_TOKEN_SECRET` o `APP_SECRET`.
 */
export function getInvitationService(): InvitationService {
  invitations ??= createInvitationService({
    store: createPrismaInvitationStore(prisma),
    accessKeys: getAccessKeyService(),
    queue: createInvitationEmailQueue(),
    confirmation: readConfirmationTokenConfig(),
  });
  return invitations;
}

/**
 * PDF de tarjetas-clave (ticket 5.7, specs/13 §9). Por debajo de 50 tarjetas se
 * renderiza aquí; por encima se encola en BullMQ (`QUEUES_ENABLED`) y lo hace
 * `@escaperoom/worker`. Las URLs de descarga se firman con `APP_SECRET`.
 */
export function getAccessKeyCardsService(): AccessKeyCardsService {
  accessKeyCards ??= createAccessKeyCardsService({
    store: createPrismaAccessKeyCardStore(prisma),
    queue: createBullCardExportQueue(),
    signingSecret: readExportSigningSecret(),
  });
  return accessKeyCards;
}

/** PDFs de los exports en el bucket privado (los sube el worker). */
export function getExportBlobStore(): Pick<CardExportBlobStore, "get"> {
  return {
    async get(key) {
      try {
        return new Uint8Array((await storage.getObjectBuffer(key)).buffer);
      } catch (err) {
        if ((err as { name?: string }).name === "NoSuchKey") return null;
        throw err;
      }
    },
  };
}

/**
 * Panel del organizador (ticket 5.9): contadores de claves e invitaciones sobre
 * Postgres y progreso en vivo de las rooms `event` por la ruta interna de
 * Colyseus (`COLYSEUS_INTERNAL_URL` o la pública con `ws` → `http`), autenticada
 * con una credencial derivada de `JOIN_TOKEN_SECRET`, el mismo secreto que
 * firma los tokens de observador. Sin secreto (producción mal configurada) el
 * panel sigue funcionando sin progreso en vivo ni modo observador. El progreso
 * persistido (`progressEvent`, ticket 5.12) cubre las sesiones sin room viva.
 */
export function getEventPanelService(): EventPanelService {
  if (!eventPanel) {
    const joinToken = readJoinTokenConfig();
    const eventStore = createPrismaEventStore(prisma);
    eventPanel = createEventPanelService({
      keys: createPrismaAccessKeyStore(prisma),
      invitations: createPrismaInvitationStore(prisma),
      keyCounts: async (eventId) => {
        const [summary, redeemed] = await Promise.all([
          eventStore.summarize(eventId),
          prisma.accessKey.count({ where: { eventId, redeemedCount: { gt: 0 } } }),
        ]);
        return { byStatus: summary.accessKeysByStatus, redeemed };
      },
      live: joinToken
        ? createColyseusLiveProgressSource({
            baseUrl: resolveColyseusHttpUrl(),
            secret: joinToken.secret,
          })
        : { forEvent: async () => null },
      stored: createPrismaEventRuntimeStore(prisma),
      spectator: joinToken,
      colyseusEndpoint: process.env.NEXT_PUBLIC_COLYSEUS_URL?.trim() || "ws://localhost:2567",
      roomName: EVENT_ROOM_NAME,
    });
  }
  return eventPanel;
}
