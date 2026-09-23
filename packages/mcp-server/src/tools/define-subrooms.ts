import { defineSubRooms } from "@escaperoom/editor/room-doc";
import { RectSchema, SpawnPointSchema, SubRoomSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/**
 * Fase A — habitaciones internas del mapa (specs/10 §2). `bounds.w × bounds.h`
 * es la rejilla de la habitación; el RoomPackage v1 no guarda su posición en
 * un mapa global (las habitaciones se conectan con puertas `leadsTo`), así que
 * `bounds.x/y` solo orientan al agente y no se persisten.
 */
export const defineSubroomsTool = defineTool({
  name: "define_subrooms",
  title: "Definir habitaciones",
  description:
    "Define las habitaciones internas del mapa (p. ej. Salón, Bodega, Catacumbas) con su id, nombre y límites en celdas: `bounds.w × bounds.h` es su rejilla (las coordenadas de objetos y tiles son locales a cada habitación; `bounds.x/y` no se guardan). Crea las nuevas y renombra/redimensiona las existentes. La primera habitación recibe un punto de aparición por defecto si no se indican `spawnPoints`.",
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
            w: z.number().int().positive(),
            h: z.number().int().positive(),
          }),
          spawnPoints: z.array(SpawnPointSchema).optional(),
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
          subrooms.map(({ id, name, bounds, spawnPoints }) => ({
            id,
            name,
            grid: { cols: bounds.w, rows: bounds.h },
            ...(spawnPoints ? { spawnPoints } : {}),
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
