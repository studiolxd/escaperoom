import { Room, type Client } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { logger } from "@escaperoom/kit/logger";
import { RoomChat } from "../../src/chat.js";
import { CHAT_MESSAGE } from "../../src/constants.js";
import { MEDIA_TOKEN_REQUEST_MESSAGE, sendMediaTokenToClient } from "../../src/media/index.js";
import { ChatMessageState } from "../../src/schema/lobby-state.js";

/**
 * Room mínima solo para tests de integración de `RoomChat`/`media` (que antes
 * usaban `lobby_test`, retirada con `/[locale]/play`, F-33): un jugador con
 * nombre autoritativo (`Jugador N`) más chat y token de medios, sin
 * movimiento ni el resto del protocolo de `GameRoom`.
 */
export const TestPlayerState = schema({ id: t.string(), name: t.string() }, "TestPlayerState");
export type TestPlayerState = SchemaType<typeof TestPlayerState>;

export const ChatMediaTestState = schema(
  { players: t.map(TestPlayerState), chat: t.array(ChatMessageState) },
  "ChatMediaTestState",
);
export type ChatMediaTestState = SchemaType<typeof ChatMediaTestState>;

export const CHAT_MEDIA_TEST_ROOM_NAME = "chat_media_test" as const;

export class ChatMediaTestRoom extends Room<{ state: ChatMediaTestState }> {
  override maxClients = 8;

  private readonly chat = new RoomChat();

  override onCreate(): void {
    this.state = new ChatMediaTestState();

    this.onMessage(MEDIA_TOKEN_REQUEST_MESSAGE, (client, payload) => {
      const player = this.state.players.get(client.sessionId);
      sendMediaTokenToClient(client, this.roomId, payload, {
        role: "player",
        name: player?.name,
      }).catch((err: unknown) => {
        logger.warn(
          { err, roomId: this.roomId, sessionId: client.sessionId },
          "media: fallo al enviar el token al cliente",
        );
      });
    });

    this.onMessage(CHAT_MESSAGE, (client, payload) => {
      const player = this.state.players.get(client.sessionId);
      if (player) this.chat.handle(client, player.name, payload, this.state.chat);
    });
  }

  override onJoin(client: Client): void {
    const index = this.state.players.size;
    const player = new TestPlayerState();
    player.id = client.sessionId;
    player.name = `Jugador ${index + 1}`;
    this.state.players.set(client.sessionId, player);
    this.chat.join(client.sessionId);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.chat.leave(client.sessionId);
  }
}
