import path from "node:path";
import { publishDraftUpdate } from "@escaperoom/kit/room-sync";
import { storage } from "@escaperoom/kit/storage";
import { getRedis, redisPrefix } from "@escaperoom/kit/redis";
import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import type { RoomPackageSerializer } from "@escaperoom/editor/validation";
import { prisma } from "@escaperoom/shared/db";
import {
  createInvitationEmailQueue,
  createPurchaseConfirmationEmailQueue,
  readConfirmationTokenConfig,
  createMailTransportFromEnv,
} from "@escaperoom/shared/mail";
import { logger } from "@escaperoom/kit/logger";
import { EVENT_ROOM_NAME } from "@/lib/colyseus";
import {
  createAudioAssetService,
  createPrismaAudioAssetStore,
  createModerationService,
  createPrismaModerationStore,
  type ModerationService,
  createCatalogService,
  createCachedPublishedRoomListing,
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
  createCreditsService,
  createPrismaCreditAccountStore,
  type CreditsService,
  createAudioGenerationService,
  type AudioGenerationService,
  createRedisAudioPreviewCache,
  createElevenLabsHttpClient,
  readElevenLabsConfig,
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
  readGameAccessTokenConfig,
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
  createUserDataRightsService,
  createPrismaUserDataRightsStore,
  type UserDataRightsService,
  createPurchaseService,
  createPrismaPurchaseStore,
  type PurchaseService,
  createRoomAccessService,
  createPrismaRoomAccessStore,
  type RoomAccessService,
  createCreatorConnectService,
  createPrismaCreatorConnectStore,
  type CreatorConnectService,
  createStripeClient,
  createStripePaymentGateway,
  createStripeConnectGateway,
  readStripeConfig,
  createPrismaWebhookEventDedupeStore,
  type WebhookEventDedupeStore,
  type PurchaseConfirmationQueue,
  createContactService,
  type ContactService,
  createTermsAcceptanceService,
  createPrismaTermsAcceptanceStore,
  type TermsAcceptanceService,
} from "@escaperoom/shared/services";
import type Stripe from "stripe";
import { createBullCardExportQueue } from "@escaperoom/shared/access-key-cards-queue";
import { resolveColyseusHttpUrl } from "./playtest-launcher";
import { getEditorSyncOriginId } from "./room-sync";

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
let credits: CreditsService | undefined;
let audioGeneration: AudioGenerationService | null | undefined;
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
let moderation: ModerationService | undefined;
let userDataRights: UserDataRightsService | undefined;
let stripeClient: Stripe | null | undefined;
let purchases: PurchaseService | undefined;
let roomAccess: RoomAccessService | null | undefined;
let creatorConnect: CreatorConnectService | undefined;
let webhookDedupe: WebhookEventDedupeStore | undefined;
let purchaseConfirmations: PurchaseConfirmationQueue | undefined;
let contact: ContactService | null | undefined;
let termsAcceptance: TermsAcceptanceService | undefined;

/**
 * Adaptador mínimo de `ioredis` al `CatalogCacheStore` del cache del catálogo
 * (ADR-027). `null` sin `REDIS_URL` (dev sin Redis): el cache queda desactivado
 * y `createCachedPublishedRoomListing` pasa las consultas directo a Postgres.
 */
function catalogCacheStore() {
  const redis = getRedis();
  if (!redis) return null;
  return {
    get: (key: string) => redis.get(key),
    set: (key: string, value: string, ttlSeconds: number) => redis.set(key, value, "EX", ttlSeconds),
  };
}

/**
 * Composition root de los servicios de dominio en web. tRPC, REST y MCP
 * comparten esta MISMA instancia (ADR-022): no hay lógica en los adaptadores.
 */
export function getCatalogService(): CatalogService {
  catalog ??= createCatalogService({
    rooms: createJsonFileRoomPackageRepository(path.resolve(process.cwd(), FEATURED_ROOM_FIXTURE)),
    // Cache de la consulta del catálogo (ADR-027, ticket 6.4): el render de
    // `/[locale]/rooms` es dinámico por el nonce de la CSP (ticket 6.3) y no se
    // puede cachear a nivel HTTP sin relajarla, así que se cachea la consulta.
    listing: createCachedPublishedRoomListing(createPrismaPublishedRoomListing(prisma), {
      store: catalogCacheStore(),
      prefix: redisPrefix(),
      // Medición aproximada del efecto del cache (docs/reference/seguridad.md §3).
      onTiming: (timing) => logger.debug(timing, "catalog-cache: consulta"),
    }),
  });
  return catalog;
}

/** Reseñas de salas (specs/13 §3): upsert por usuario y sala, elegibilidad por compra/partida. */
export function getReviewService(): ReviewService {
  reviews ??= createReviewService({ store: createPrismaReviewStore(prisma) });
  return reviews;
}

/**
 * Servicio del draft Yjs del editor (specs/09 §2) sobre Postgres. Cada update
 * persistido se publica en Redis (`@escaperoom/kit/room-sync`) para que
 * OTROS procesos `editor-sync` (si hay más de uno corriendo) lo apliquen a
 * sus docs en memoria y lo reenvíen a sus propios clientes — sin Redis
 * configurado o caído, `publishDraftUpdate` es un no-op y el draft se
 * persiste igual (decisión 2026-09-23).
 */
export function getRoomDraftService(): RoomDraftService {
  roomDrafts ??= createRoomDraftService({
    store: createPrismaRoomDraftStore(prisma),
    publish: async (event) => {
      await publishDraftUpdate({ ...event, originId: getEditorSyncOriginId() });
    },
  });
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

/** Ledger de créditos de plataforma (ticket 4.9, specs/14 §4) sobre Postgres. */
export function getCreditsService(): CreditsService {
  credits ??= createCreditsService({ store: createPrismaCreditAccountStore(prisma) });
  return credits;
}

/**
 * Generación de audio por IA con ElevenLabs (ticket 4.9, specs/15 §2-4): coste
 * en créditos, síntesis, subida al MISMO bucket que 3.11 y alta en la MISMA
 * cola de moderación. `null` sin `ELEVENLABS_API_KEY` (producción sin la
 * clave configurada): el endpoint responde 503 «no disponible», sin romper el
 * resto de la app.
 */
export function getAudioGenerationService(): AudioGenerationService | null {
  if (audioGeneration !== undefined) return audioGeneration;
  const config = readElevenLabsConfig();
  audioGeneration = config.configured
    ? createAudioGenerationService({
        elevenlabs: createElevenLabsHttpClient({ apiKey: config.apiKey, modelId: config.modelId }),
        credits: getCreditsService(),
        store: createPrismaAudioAssetStore(prisma),
        blobs: audioBlobs,
        config: { voiceId: config.voiceId },
        previewCache: createRedisAudioPreviewCache(),
      })
    : null;
  return audioGeneration;
}

/**
 * Moderación de contenido (ticket 6.1, specs/17): reportes, cola con SLA,
 * strikes y apelaciones sobre Postgres. El pre-check es el local (filtro de
 * lenguaje + PII, sin proveedores externos).
 */
export function getModerationService(): ModerationService {
  moderation ??= createModerationService({ store: createPrismaModerationStore(prisma) });
  return moderation;
}

/**
 * Publicación de salas (specs/08 §5, specs/13 §4) sobre Postgres y el bucket
 * (R2/S3 vía `@escaperoom/kit/storage`). El doc Yjs del draft se congela con
 * la serialización del editor (`roomDocToPackage`, ticket 3.1). Los audios
 * pasan por el servicio de 3.11: pendientes o rechazados bloquean la publicación.
 * El pre-check de moderación y la puerta de cuenta (suspensión, ban) son de 6.1.
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
      moderation: getModerationService(),
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
 * de los tramos de 3.12 (`snapshotAt`). Stripe Checkout (ticket 5.1): el
 * cobro es 100 % plataforma (specs/02 §1), sin `Transfer` al creador de la
 * sala. `payments: null` sin `STRIPE_SECRET_KEY`: `POST /api/events/:id/checkout`
 * responde 501 `PAYMENT_GATEWAY_UNAVAILABLE` (la autoventa del autor no lo necesita).
 */
export function getEventService(): EventService {
  if (!events) {
    const stripe = getStripeClient();
    events = createEventService({
      store: createPrismaEventStore(prisma),
      pricing: getPricingTierService(),
      payments: stripe ? createStripePaymentGateway(stripe) : null,
    });
  }
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
 * Derechos RGPD sobre la cuenta propia (ticket 6.2, specs/18 §3.4): export de
 * datos (`GET /api/me/data-export`) y cierre de cuenta (`DELETE /api/me`).
 */
export function getUserDataRightsService(): UserDataRightsService {
  userDataRights ??= createUserDataRightsService({
    store: createPrismaUserDataRightsStore(prisma, { deleteStorageObject: (key) => storage.deleteObject(key) }),
  });
  return userDataRights;
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
 * Reparto 70/30 al creador de origen vía `Transfer` (mismo puerto que la venta
 * individual, ticket 5.1), resuelta en el webhook (`confirmLicensePayment`).
 * `payments: null` sin `STRIPE_SECRET_KEY`: una licencia con precio responde
 * 501 `PAYMENT_GATEWAY_UNAVAILABLE`; el regalo y la licencia gratuita no lo
 * necesitan.
 */
export function getRoomLicenseService(): RoomLicenseService {
  if (!roomLicenses) {
    const stripe = getStripeClient();
    roomLicenses = createRoomLicenseService({
      store: createPrismaRoomLicenseStore(prisma),
      buildDoc: (pkg) => roomPackageToDoc(pkg),
      payments: stripe ? createStripePaymentGateway(stripe) : null,
    });
  }
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
    // B-23: el handle del kit toma {payload, opts}[]; InvitationQueue no
    // expone `opts` (invitations.ts nunca fija un jobId propio).
    queue: (() => {
      const emailQueue = createInvitationEmailQueue();
      return {
        enqueue: (job) => emailQueue.enqueue(job),
        enqueueBulk: (jobs) => emailQueue.enqueueBulk(jobs.map((payload) => ({ payload }))),
      };
    })(),
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

/**
 * Cliente Stripe compartido (ticket 5.1, specs/02 §2): `null` sin
 * `STRIPE_SECRET_KEY` (dev/CI sin la clave configurada). Los servicios que lo
 * necesitan quedan sin pasarela y sus endpoints responden
 * `PAYMENT_GATEWAY_UNAVAILABLE`/501, sin romper el resto de la app.
 */
export function getStripeClient(): Stripe | null {
  if (stripeClient !== undefined) return stripeClient;
  const config = readStripeConfig();
  stripeClient = config.configured ? createStripeClient(config.secretKey) : null;
  return stripeClient;
}

/**
 * Venta individual de salas a jugadores (ticket 5.1, specs/02 §1-2, specs/13
 * §5): Stripe Checkout hospedado + `Transfer` del 70% al creador al confirmar
 * el pago (webhook). `payments: null` sin `STRIPE_SECRET_KEY`.
 */
export function getPurchaseService(): PurchaseService {
  if (!purchases) {
    const stripe = getStripeClient();
    purchases = createPurchaseService({
      store: createPrismaPurchaseStore(prisma),
      payments: stripe ? createStripePaymentGateway(stripe) : null,
    });
  }
  return purchases;
}

/**
 * `GET /api/rooms/:roomId/access` (B-4, auditoría 2026-09-24): si el usuario
 * tiene una compra `room` `succeeded` de esa sala aún sin jugar, emite el
 * `gameToken` (C-4, `GAME_ACCESS_TOKEN_SECRET`, compartido con
 * colyseus-server) que exige la `GameRoom`. `null` si falta el secreto en
 * producción (mismo criterio que `getRedeemService`).
 */
export function getRoomAccessService(): RoomAccessService | null {
  if (roomAccess !== undefined) return roomAccess;
  const gameToken = readGameAccessTokenConfig();
  roomAccess = gameToken
    ? createRoomAccessService({ store: createPrismaRoomAccessStore(prisma), gameToken })
    : null;
  return roomAccess;
}

/**
 * Onboarding de Stripe Connect para creadores (ticket 5.1, specs/02 §2):
 * cuentas Express `recipient`. `connect: null` sin `STRIPE_SECRET_KEY`.
 */
export function getCreatorConnectService(): CreatorConnectService {
  if (!creatorConnect) {
    const stripe = getStripeClient();
    creatorConnect = createCreatorConnectService({
      store: createPrismaCreatorConnectStore(prisma),
      connect: stripe ? createStripeConnectGateway(stripe) : null,
    });
  }
  return creatorConnect;
}

/** Idempotencia del webhook de Stripe (specs/13 §7) sobre `stripeWebhookEvent`. */
export function getWebhookEventDedupeStore(): WebhookEventDedupeStore {
  webhookDedupe ??= createPrismaWebhookEventDedupeStore(prisma);
  return webhookDedupe;
}

/**
 * Cola del email de confirmación de compra (specs/18 §3-4): el webhook de
 * Stripe encola en `mail.purchase-confirmation` tras liquidar cada compra y
 * `@escaperoom/worker` la entrega, siguiendo el mismo mecanismo que
 * `mail.invitation` (5.6). Con `QUEUES_ENABLED=false` el encolado es un no-op.
 */
export function getPurchaseConfirmationQueue(): PurchaseConfirmationQueue {
  purchaseConfirmations ??= createPurchaseConfirmationEmailQueue();
  return purchaseConfirmations;
}

/**
 * Secreto de firma del webhook (`STRIPE_WEBHOOK_SECRET`): sin él, el endpoint
 * nunca puede verificar `Stripe-Signature` y responde 503 (nunca se procesa
 * un evento sin verificar la firma, specs/13 §7).
 */
export function getStripeWebhookSecret(): string | null {
  const config = readStripeConfig();
  return config.configured ? config.webhookSecret : null;
}

/**
 * Formulario de contacto público (`/contact`): entrega síncrona por email al
 * buzón de la empresa (`CONTACT_TO_EMAIL`, por defecto `hello@studiolxd.com`)
 * con el mismo transporte que las invitaciones (`createMailTransportFromEnv`).
 * `null` sin remitente configurado en producción (`EMAIL_FROM`): el endpoint
 * responde `DELIVERY_UNAVAILABLE`/503 en vez de intentar enviar sin transporte.
 */
export function getContactService(): ContactService | null {
  if (contact === undefined) {
    const transport = createMailTransportFromEnv();
    const to = process.env.CONTACT_TO_EMAIL?.trim() || "hello@studiolxd.com";
    contact = transport ? createContactService({ transport, to }) : null;
  }
  return contact;
}

/** Reaceptación de Términos/Privacidad tras un cambio de versión (`CURRENT_TERMS_VERSION`). */
export function getTermsAcceptanceService(): TermsAcceptanceService {
  if (!termsAcceptance) {
    termsAcceptance = createTermsAcceptanceService({
      store: createPrismaTermsAcceptanceStore(prisma),
    });
  }
  return termsAcceptance;
}
