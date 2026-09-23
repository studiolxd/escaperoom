import { ServerError, type Client } from "@colyseus/core";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { PLAYTEST_EXPIRED_CLOSE_CODE } from "../constants.js";
import { readPlaytestConfig } from "../playtest/config.js";
import { playtestRegistry, type PlaytestEntry } from "../playtest/registry.js";
import { verifyPlaytestToken } from "../playtest/token.js";
import { GameRoom, type GameJoinOptions, type GameRoomOptions } from "./game-room.js";

/**
 * Opciones de la room de playtest: el id del playtest (para el `filterBy` del
 * matchmaking) y el token firmado del link de prueba. **Nunca** el paquete: la
 * room lo lee del registro, donde web lo dejó serializado desde el doc Yjs.
 */
export interface PlaytestRoomOptions extends GameRoomOptions {
  playtestId?: string;
  token?: string;
}

export type PlaytestJoinOptions = GameJoinOptions & PlaytestRoomOptions;

/** Rechazo de join con link inválido/caducado (código HTTP-like, como `ServerError`). */
export const PLAYTEST_FORBIDDEN_CODE = 403;

/**
 * `PlaytestRoom` (ticket 3.8, specs/09 §3): una `GameRoom` temporal con el
 * borrador del editor. Mismo protocolo y mismo motor que una partida publicada;
 * solo cambian de dónde sale el paquete y quién puede entrar:
 *
 * - el paquete es la instantánea congelada del registro (editar el borrador
 *   después no afecta a una partida en curso);
 * - se entra con el token del link de prueba (firma HMAC + caducidad), que
 *   debe corresponder a **este** playtest;
 * - no aparece en ningún listado: el servidor no expone listados de rooms, el
 *   catálogo solo lee salas publicadas y el matchmaking empareja por
 *   `playtestId` (un UUID que solo viaja dentro del link). No se marca
 *   `private` porque Colyseus excluye las rooms privadas de `joinOrCreate`;
 * - se destruye al vaciarse (`autoDispose`) y se cierra al caducar.
 */
export class PlaytestRoom extends GameRoom {
  private playtest!: PlaytestEntry;

  protected override loadRoomPackage(options: PlaytestRoomOptions): RoomPackage {
    const entry = authorize(options);
    const roomPackage = entry && playtestRegistry.packageFor(entry.playtestId);
    if (!entry || !roomPackage) throw new Error("Link de prueba no válido o caducado.");
    this.playtest = entry;
    return roomPackage;
  }

  override onCreate(options: PlaytestRoomOptions = {}): void {
    super.onCreate(options);
    void this.setMetadata({ playtestId: this.playtest.playtestId });
    this.clock.setTimeout(
      () => void this.disconnect(PLAYTEST_EXPIRED_CLOSE_CODE),
      Math.max(0, this.playtest.expiresAt - Date.now()),
    );
  }

  /**
   * En una prueba es habitual recargar o cerrar la pestaña: si se va el
   * anfitrión, lo es el siguiente jugador conectado (si no, nadie podría
   * empezar). La `GameRoom` publicada no cambia (su reconexión es de fase 6).
   */
  override onLeave(client: Client): void {
    super.onLeave(client);
    if (this.state.hostId !== client.sessionId) return;
    const next = [...this.state.players.values()].find((player) => player.connected);
    this.state.hostId = next?.id ?? "";
  }

  override onAuth(_client: Client, options: PlaytestJoinOptions = {}): { playtestId: string } {
    const entry = authorize(options);
    if (!entry || entry.playtestId !== this.playtest.playtestId) {
      throw new ServerError(PLAYTEST_FORBIDDEN_CODE, "Link de prueba no válido o caducado.");
    }
    return { playtestId: entry.playtestId };
  }
}

/** Token válido, del playtest pedido y vivo en el registro. */
function authorize(options: PlaytestRoomOptions): PlaytestEntry | undefined {
  const config = readPlaytestConfig();
  if (!config) return undefined;
  const verified = verifyPlaytestToken(config.secret, options.token);
  if (!verified.ok || verified.payload.pid !== options.playtestId) return undefined;
  return playtestRegistry.get(verified.payload.pid);
}
