import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Estado sincronizado de la room `lobby_test` (specs/11 §3).
 *
 * Se define con el builder `schema()` / `t.*` (sin decoradores) para no exigir
 * `experimentalDecorators` ni configuración especial del toolchain.
 */

export const PlayerState = schema(
  {
    id: t.string(),
    /** Nombre visible asignado por el servidor (autor del chat). */
    name: t.string(),
    x: t.number(),
    y: t.number(),
    /** Color de tintado (`#rrggbb`) asignado por el servidor (specs/04 §2). */
    tint: t.string(),
  },
  "PlayerState",
);

export type PlayerState = SchemaType<typeof PlayerState>;

/**
 * Mensaje de chat sincronizado (specs/11 §3, §6). Refleja el esquema Zod de
 * `@escaperoom/shared/chat`; el texto que llega aquí ya está desinfectado y, si
 * tocaba, censurado.
 */
export const ChatMessageState = schema(
  {
    id: t.string(),
    authorId: t.string(),
    authorName: t.string(),
    text: t.string(),
    ts: t.number(),
    filtered: t.boolean(),
  },
  "ChatMessageState",
);

export type ChatMessageState = SchemaType<typeof ChatMessageState>;

export const LobbyState = schema(
  {
    players: t.map(PlayerState),
    /** Ventana móvil de los últimos mensajes (specs/11 §3). */
    chat: t.array(ChatMessageState),
  },
  "LobbyState",
);

export type LobbyState = SchemaType<typeof LobbyState>;
