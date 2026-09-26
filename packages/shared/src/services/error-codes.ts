/**
 * Códigos de error `as const` de los servicios de dominio, aislados aquí sin
 * ninguna dependencia (F-43..47 punto 4, auditoría 2026-09-24): cada archivo
 * de servicio (`publish-confirmation.ts`, `room-publish.ts`, …) importa
 * `node:crypto`, Prisma o colas de BullMQ en otras partes de su módulo, así
 * que una pantalla cliente que solo necesita el código de error para pintar
 * un mensaje no puede importarlo desde ahí sin arrastrar ese código de
 * servidor al bundle del navegador. Cada servicio reexporta desde aquí para
 * mantener una sola fuente por dominio.
 */

export const PUBLISH_CONFIRMATION_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_TOKEN",
  "EXPIRED",
  "VALIDATION_ERROR",
] as const;
export type PublishConfirmationErrorCode = (typeof PUBLISH_CONFIRMATION_ERROR_CODES)[number];

export const ROOM_PUBLISH_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "VERSION_CONFLICT",
  /** El paquete candidato es idéntico al de la última versión publicada (ADR-035). */
  "NOTHING_TO_PUBLISH",
  "ROOM_NOT_PUBLISHABLE",
  "INVALID_PACKAGE",
  "UNSUPPORTED_PACKAGE_FORMAT",
  "VALIDATION_FAILED",
  "ASSETS_NOT_PUBLISHABLE",
  "SERIALIZER_UNAVAILABLE",
  /** El draft ya no es el que se aprobó (`PublishGuard.packageHash`, ticket 4.5). */
  "DRAFT_CHANGED",
  /** Se publicó otra versión desde que se aprobó (`PublishGuard.latestSemver`, ticket 4.5). */
  "VERSION_CHANGED",
  /** Moderación (6.1): cuenta congelada por un reporte crítico pendiente. */
  "ACCOUNT_FROZEN",
  /** Moderación (6.1): 2º strike en 90 días, publicación suspendida 14 días. */
  "CREATOR_SUSPENDED",
  /** Moderación (6.1): ban como creador. */
  "CREATOR_BANNED",
  /** Moderación (6.1): el pre-check automático bloqueó el contenido (apelable). */
  "CONTENT_BLOCKED",
] as const;
export type RoomPublishErrorCode = (typeof ROOM_PUBLISH_ERROR_CODES)[number];

export const EVENT_PANEL_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SESSION_NOT_FOUND",
  "SESSION_NOT_LIVE",
  "SPECTATOR_UNAVAILABLE",
] as const;
export type EventPanelErrorCode = (typeof EVENT_PANEL_ERROR_CODES)[number];

export const ACCESS_KEY_CARDS_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "NO_PRINTABLE_KEYS",
  "EXPORT_UNAVAILABLE",
  "EXPORT_LINK_INVALID",
  "EXPORT_LINK_EXPIRED",
] as const;
export type AccessKeyCardsErrorCode = (typeof ACCESS_KEY_CARDS_ERROR_CODES)[number];

export const ACCESS_KEY_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "EVENT_NOT_ACTIVE",
  "EVENT_EXPIRED",
  "SEAT_LIMIT_EXCEEDED",
  "ACCESS_KEY_NOT_ROTATING",
  "ACCESS_KEY_INVALID",
  "ACCESS_KEY_USED",
  "ACCESS_KEY_EXPIRED",
  "ACCESS_KEY_NOT_CONFIRMED",
  "SESSION_FULL",
  "SESSION_REQUIRED",
  "ACCESS_KEY_NO_EMAIL",
  "DPA_REQUIRED",
  "CONFIRMATION_INVALID",
  "CONFIRMATION_EXPIRED",
  "CONFIRMATION_UNAVAILABLE",
  "CONFLICT",
] as const;
export type AccessKeyErrorCode = (typeof ACCESS_KEY_ERROR_CODES)[number];

export const MODERATION_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "REPORT_REASON_REQUIRED",
  "ALREADY_REVIEWED",
  "APPEAL_NOT_ALLOWED",
  "APPEAL_ALREADY_PENDING",
  "NOTHING_TO_APPEAL",
] as const;
export type ModerationErrorCode = (typeof MODERATION_ERROR_CODES)[number];

export const ROOM_DRAFT_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_UPDATE",
  "PAYLOAD_TOO_LARGE",
] as const;
export type RoomDraftErrorCode = (typeof ROOM_DRAFT_ERROR_CODES)[number];

/**
 * Códigos que no pertenecen a un `XxxError` de dominio: antes se repetían
 * como literales sueltos tanto en el REST que los emite como en cada
 * pantalla que los traduce.
 */

/** `POST /api/rooms/:roomId/playtest` (`server/rest/room-playtest.ts`): fuera
 * de `RoomDraftError`, el lanzamiento del playtest puede devolver estos. */
export const PLAYTEST_DISABLED_ERROR = "PLAYTEST_DISABLED" as const;
export const INVALID_DRAFT_ERROR = "INVALID_DRAFT" as const;
export const PLAYTEST_UNPLAYABLE_ERROR = "PLAYTEST_UNPLAYABLE" as const;
export const PLAYTEST_UNAVAILABLE_ERROR = "PLAYTEST_UNAVAILABLE" as const;

export const ROOM_PLAYTEST_ERROR_CODES = [
  PLAYTEST_DISABLED_ERROR,
  INVALID_DRAFT_ERROR,
  PLAYTEST_UNPLAYABLE_ERROR,
  PLAYTEST_UNAVAILABLE_ERROR,
] as const;
export type RoomPlaytestErrorCode = (typeof ROOM_PLAYTEST_ERROR_CODES)[number];

/** `redeemAccessKey` (`web/src/actions/redeem.ts`): servicio no configurado en este entorno. */
export const REDEEM_UNAVAILABLE_ERROR = "REDEEM_UNAVAILABLE" as const;

/** `POST /api/publish-confirm` y su página (`server/rest/publish-confirm.ts`): servicio de confirmación no configurado en este entorno. */
export const PUBLISH_CONFIRM_DISABLED_ERROR = "PUBLISH_CONFIRM_DISABLED" as const;

/** Cuota agotada (`consumeActionRateLimit` en `web`; mismo código que `CHAT_RATE_LIMITED_ERROR`). */
export const RATE_LIMITED_ERROR = "RATE_LIMITED" as const;

/**
 * `GameRoom.handleStart`/`handleSetReady`/`handleKick` (encargo lobby-c13,
 * specs/11 §4.1/§4.5): códigos de error de protocolo para el lobby,
 * compartidos entre servidor y cliente vía `error` (`GAME_MESSAGES`).
 */
export const GAME_LOBBY_ERROR_CODES = [
  /** `start_game`: no está en fase `lobby` o quien lo pide no es el anfitrión. */
  "NOT_HOST",
  /** `start_game` sin `force`: hay conectados que aún no están "Listo". */
  "PLAYERS_NOT_READY",
  /** `start_game` (con o sin `force`): conectados por debajo de `meta.players.min`. */
  "MIN_PLAYERS_NOT_MET",
  /** `kick`: el objetivo no existe, ya no está conectado, o quien lo pide no es el anfitrión. */
  "KICK_TARGET_INVALID",
] as const;
export type GameLobbyErrorCode = (typeof GAME_LOBBY_ERROR_CODES)[number];
