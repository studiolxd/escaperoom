import { ServerError, type Client } from "@colyseus/core";
import {
  readJoinTokenConfig,
  verifyJoinToken,
  type JoinClaims,
  type JoinTokenError,
} from "@escaperoom/shared/join-token";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { GameRoom, type GameRoomOptions } from "./game-room.js";

/**
 * Opciones de la room de evento: la sesión del evento (para el `filterBy` del
 * matchmaking) y el `joinToken` que devolvió `POST /api/access-keys/redeem`.
 */
export interface EventRoomOptions extends GameRoomOptions {
  sessionId?: string;
  joinToken?: string;
}

/** Rechazo de join sin `joinToken` válido (código HTTP-like, como `ServerError`). */
export const EVENT_JOIN_FORBIDDEN_CODE = 403;

/** Motivos de rechazo que ve el cliente (specs/11 §7: nunca un stack trace). */
export const JOIN_TOKEN_ERRORS = {
  missing: "JOIN_TOKEN_REQUIRED",
  invalid: "JOIN_TOKEN_INVALID",
  expired: "JOIN_TOKEN_EXPIRED",
  wrongSession: "JOIN_TOKEN_WRONG_SESSION",
} as const;

/**
 * `EventRoom` (ticket 5.8, specs/11 §1 y §8): la `GameRoom` de una sesión de
 * evento. Mismo protocolo y motor; lo que cambia es **quién entra**: solo quien
 * presenta un `joinToken` firmado, vigente y emitido para **esta** sesión. El
 * asiento ya se consumió al canjear (web, con Postgres), así que aquí basta con
 * verificar la firma: la room no toca la base de datos.
 *
 * - Una room por `gameSession` (matchmaking por `sessionId`); crearla también
 *   exige token, así nadie levanta la room de una sesión ajena.
 * - El nombre visible sale del token (lo fijó el canje), no de las opciones.
 * - Paquete: el mismo resolver que la `GameRoom` (hoy el fixture del Rey
 *   Aldric); cargar la versión publicada del evento llega con el catálogo en
 *   Colyseus. El cliente no puede elegir paquete.
 */
export class EventRoom extends GameRoom {
  private eventSessionId = "";

  protected override loadRoomPackage(options: EventRoomOptions): RoomPackage {
    const claims = authorize(options);
    this.eventSessionId = claims.sessionId;
    return super.loadRoomPackage({});
  }

  override onCreate(options: EventRoomOptions = {}): void {
    super.onCreate(options);
    void this.setMetadata({ sessionId: this.eventSessionId });
  }

  override onAuth(_client: Client, options: EventRoomOptions = {}): JoinClaims {
    const claims = authorize(options);
    if (claims.sessionId !== this.eventSessionId) {
      throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.wrongSession);
    }
    return claims;
  }

  override onJoin(client: Client): void {
    const claims = client.auth as JoinClaims;
    super.onJoin(client, { name: claims.displayName });
  }
}

const MESSAGE_BY_ERROR: Record<JoinTokenError, string> = {
  MALFORMED: JOIN_TOKEN_ERRORS.invalid,
  BAD_SIGNATURE: JOIN_TOKEN_ERRORS.invalid,
  EXPIRED: JOIN_TOKEN_ERRORS.expired,
};

/** Token presente, bien firmado, vigente y de la sesión pedida; si no, `ServerError` 403. */
function authorize(options: EventRoomOptions): JoinClaims {
  const config = readJoinTokenConfig();
  if (!config || options.joinToken === undefined) {
    throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.missing);
  }
  const verified = verifyJoinToken(config.secret, options.joinToken);
  if (!verified.ok) {
    throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, MESSAGE_BY_ERROR[verified.error]);
  }
  if (verified.claims.sessionId !== options.sessionId) {
    throw new ServerError(EVENT_JOIN_FORBIDDEN_CODE, JOIN_TOKEN_ERRORS.wrongSession);
  }
  return verified.claims;
}
