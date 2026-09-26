import { defineSubRooms } from "@escaperoom/editor/room-doc";
import {
  MAX_GRID_DIMENSION,
  RectSchema,
  SpawnPointSchema,
  SubRoomKindSchema,
  SubRoomSchema,
} from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/**
 * Fase A — habitaciones internas del mapa (specs/10 §2). `bounds.w × bounds.h`
 * es la rejilla de la habitación; el RoomPackage v1 no guarda su posición en
 * un mapa global (las habitaciones se conectan con puertas `leadsTo`), así que
 * `bounds.x/y` solo orientan al agente y no se persisten. `kind: "lobby"`
 * marca la sala de espera (encargo lobby-diseño), la misma habitación
 * especial que el creador diseña en el editor.
 */
export const defineSubroomsTool = defineTool({
  name: "define_subrooms",
  title: "Definir habitaciones",
  description:
    'Define las habitaciones internas del mapa (p. ej. Salón, Bodega, Catacumbas) con su id, nombre y límites en celdas: `bounds.w × bounds.h` es su rejilla (las coordenadas de objetos y tiles son locales a cada habitación; `bounds.x/y` no se guardan). Crea las nuevas y renombra/redimensiona las existentes. La primera habitación de juego recibe un punto de aparición por defecto si no se indican `spawnPoints`. `kind: "lobby"` marca la habitación como sala de espera (lobby: donde los jugadores esperan al anfitrión antes de empezar; como mucho una, nunca la única habitación; solo decoración — sin pruebas, puertas `leadsTo` ni objetos que den ítems; se pinta con paint_tiles y se decora con decorate_subroom como cualquier otra); `kind: null` le quita el tipo. Sin lobby diseñado, la partida usa uno generado.',
  phase: "structure",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    subrooms: z
      .array(
        z.object({
          id: SubRoomSchema.shape.id,
          name: SubRoomSchema.shape.name,
          bounds: RectSchema.extend({
            w: z.number().int().positive().max(MAX_GRID_DIMENSION),
            h: z.number().int().positive().max(MAX_GRID_DIMENSION),
          }),
          spawnPoints: z.array(SpawnPointSchema).optional(),
          kind: SubRoomKindSchema.nullable()
            .optional()
            .describe(
              '"lobby" = sala de espera (como mucho una); null = quitarle el tipo; ausente = sin cambios',
            ),
        }),
      )
      .min(1),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, subrooms, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft(
      { actor, deps, tool: "define_subrooms", dryRun },
      roomId,
      (doc) =>
        defineSubRooms(
          doc,
          subrooms.map(({ id, name, bounds, spawnPoints, kind }) => ({
            id,
            name,
            grid: { cols: bounds.w, rows: bounds.h },
            ...(spawnPoints ? { spawnPoints } : {}),
            ...(kind !== undefined ? { kind } : {}),
          })),
        ),
    );
    const { result } = outcome;
    const parts = [
      result.created.length > 0 ? `creadas [${result.created.join(", ")}]` : "",
      result.updated.length > 0 ? `actualizadas [${result.updated.join(", ")}]` : "",
    ].filter(Boolean);
    return mutationResult(outcome, `✅ define_subrooms — ${parts.join("; ")}`, {
      roomId,
      ...result,
    });
  },
});
