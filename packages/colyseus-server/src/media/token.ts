import { AccessToken, TrackSource, type VideoGrant } from "livekit-server-sdk";
import type { MediaConfig } from "./config.js";
import { deriveLiveKitRoomName } from "./room-name.js";

/**
 * Firma de tokens LiveKit — specs/11 §8 y specs/12 §4.
 *
 * El token es la **única fuente de verdad** del permiso real: los roles y el
 * flag de vídeo deciden qué se firma, no una restricción de UI eludible.
 */

export type MediaRole = "player" | "observer";

export interface MediaTokenInput {
  /** Identidad del jugador en LiveKit (`sub` del JWT). Usamos el `sessionId`. */
  identity: string;
  /** Id de la GameRoom de Colyseus; de él se deriva la room de LiveKit. */
  gameRoomId: string;
  role: MediaRole;
  /** `false` = solo audio (contexto educativo, specs/12 §4). */
  allowVideo: boolean;
  /** Nombre visible (`name` del participante). */
  name?: string;
  /** Sobrescribe el TTL de la config (tests / sesiones de duración conocida). */
  ttlSeconds?: number;
}

export interface MediaPermissions {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  canPublishSources?: TrackSource[];
}

/**
 * Permisos por rol:
 * - `player`: publica audio y (si `allowVideo`) vídeo y datos.
 * - `observer`: **solo suscripción** (`canPublish: false`, `canPublishData: false`),
 *   sin coste de publisher (specs/12 §1.1 y §3).
 */
export function mediaPermissionsForRole(role: MediaRole, allowVideo: boolean): MediaPermissions {
  if (role === "observer") {
    return {
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
    };
  }
  return {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: allowVideo
      ? [TrackSource.MICROPHONE, TrackSource.CAMERA]
      : [TrackSource.MICROPHONE],
  };
}

/** Construye el `VideoGrant` (claims `video.*`) de un token de join. */
export function buildVideoGrant(
  input: Pick<MediaTokenInput, "gameRoomId" | "role" | "allowVideo">,
  prefix: string,
): VideoGrant {
  const permissions = mediaPermissionsForRole(input.role, input.allowVideo);
  return {
    roomJoin: true,
    room: deriveLiveKitRoomName(input.gameRoomId, prefix),
    ...permissions,
  };
}

/**
 * Firma el JWT. Devuelve `null` si no hay config (sin claves) para que el
 * llamante degrade sin lanzar. Lanza si falta la identidad: LiveKit la exige
 * para los tokens de join.
 */
export async function signLiveKitToken(
  input: MediaTokenInput,
  config: MediaConfig | null,
): Promise<string | null> {
  if (!config) {
    return null;
  }
  if (!input.identity.trim()) {
    throw new Error("signLiveKitToken: identity es obligatoria");
  }
  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl: input.ttlSeconds ?? config.tokenTtlSeconds,
  });
  at.addGrant(buildVideoGrant(input, config.roomPrefix));
  return at.toJwt();
}
