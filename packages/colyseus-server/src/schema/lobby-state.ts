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
    x: t.number(),
    y: t.number(),
    /** Color de tintado (`#rrggbb`) asignado por el servidor (specs/04 §2). */
    tint: t.string(),
  },
  "PlayerState",
);

export type PlayerState = SchemaType<typeof PlayerState>;

export const LobbyState = schema(
  {
    players: t.map(PlayerState),
  },
  "LobbyState",
);

export type LobbyState = SchemaType<typeof LobbyState>;
