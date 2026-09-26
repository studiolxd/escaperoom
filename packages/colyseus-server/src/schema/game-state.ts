import { schema, t, type SchemaType } from "@colyseus/schema";
import { ChatMessageState } from "./lobby-state.js";

/**
 * Estado sincronizado de la `GameRoom` (specs/11 §3). Es una **proyección** del
 * `GameState` autoritativo de `RoomSession`: solo lleva lo que cualquier
 * jugador puede ver (fase, objetos, puzzles, inventarios, flags). Nunca viaja
 * aquí nada que resuelva un puzzle (códigos, reparto del `memory`, fragmentos
 * de `split_clue`, testigo de `pipes`): eso sale en respuestas dirigidas.
 */

export const GamePlayerState = schema(
  {
    id: t.string(),
    name: t.string(),
    x: t.number(),
    y: t.number(),
    /** Habitación (subroom) actual. */
    roomId: t.string(),
    tint: t.string(),
    /** Personaje jugable (`manifest.avatars[].id`, o el de reserva, A1/B4). */
    characterId: t.string(),
    connected: t.boolean(),
    /**
     * "Listo" en el lobby (C-13, `set_ready`): se resetea a `false` al
     * cambiar de personaje o al reconectar. Sin efecto fuera de `phase ===
     * "lobby"`.
     */
    ready: t.boolean(),
    /**
     * Encargo lobby-diseño (specs/11 §4.1): `true` cuando el jugador ya ha
     * entrado al mapa de la partida (`enter_map`, tras su introducción y su
     * 3-2-1). Mientras es `false` está en la sala de espera (lobby): antes de
     * «Empezar», o después si aún lee la introducción o llegó tarde. Una
     * reconexión conserva el valor (salta lobby e introducción).
     */
    inMap: t.boolean(),
  },
  "GamePlayerState",
);
export type GamePlayerState = SchemaType<typeof GamePlayerState>;

/** Estado público de un puzzle (specs/06 §1): sin datos de la plantilla. */
export const GamePuzzleState = schema(
  {
    state: t.string(),
    attempts: t.number(),
    solvedBy: t.string(),
  },
  "GamePuzzleState",
);
export type GamePuzzleState = SchemaType<typeof GamePuzzleState>;

export const GameInventoryState = schema(
  {
    items: t.array("string"),
  },
  "GameInventoryState",
);
export type GameInventoryState = SchemaType<typeof GameInventoryState>;

export const GameRoomState = schema(
  {
    /**
     * `lobby` (sala de espera, antes de «Empezar») → `starting` (ya se pulsó
     * «Empezar» pero nadie ha entrado todavía al mapa: el reloj NO corre) →
     * `playing` (desde que el PRIMER jugador entra al mapa) → `ended`.
     */
    phase: t.string(),
    /** `victory | timeout | abandoned`, o cadena vacía mientras se juega. */
    result: t.string(),
    roomPackageId: t.string(),
    roomPackageVersion: t.string(),
    /** Reloj lógico (ms desde la creación de la sala) en el que empezó la partida. */
    startedAt: t.number(),
    /** `startedAt + timeLimit` en el mismo reloj lógico (0 = sin límite). */
    endsAt: t.number(),
    /** Reloj lógico actual de la sala. */
    clock: t.number(),
    hostId: t.string(),
    /**
     * "Todos los grupos comienzan juntos" (evento, ticket "inicio conjunto"):
     * mientras está activo, el anfitrión del grupo no ve "Empezar" — solo el
     * organizador puede arrancar (`EventRoom.organizerStartGroup`). `false`
     * fuera de eventos y en eventos sin la opción.
     */
    organizerControlsStart: t.boolean(),
    players: t.map(GamePlayerState),
    objects: t.map("string"),
    puzzles: t.map(GamePuzzleState),
    inventories: t.map(GameInventoryState),
    /** Flags del mundo serializadas en JSON (`string | number | boolean`). */
    flags: t.map("string"),
    /** Ventana móvil de los últimos 50 mensajes de chat (specs/11 §3, §4.4). */
    chat: t.array(ChatMessageState),
  },
  "GameRoomState",
);
export type GameRoomState = SchemaType<typeof GameRoomState>;
