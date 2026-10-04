import { setSpawnPoints3D } from "@escaperoom/editor/room-doc";
import { ID_PATTERN, Transform3DSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/** Fase A — puntos de aparición de una habitación 3D (specs/27 §3). */
export const setSpawnPointsTool = defineTool({
  name: "set_spawn_points",
  title: "Puntos de aparición 3D",
  description:
    "Sustituye los puntos de aparición de una habitación de una sala 3D: `spawnPoints` (1–8) con `id`, `x`, `y`, `h` (metros dentro de la habitación) y `yaw` (grados [0, 360), 0 = mirando al sur). Cada jugador aparece en uno; define uno por jugador como mínimo si la sala admite varios.",
  phase: "structure",
  ticket: "7.9",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    subroomId: z.string().min(1).describe("Habitación interna (id de define_subrooms)"),
    spawnPoints: z
      .array(Transform3DSchema.omit({ scale: true }).extend({ id: z.string().regex(ID_PATTERN) }))
      .min(1)
      .max(8),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, subroomId, spawnPoints, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft(
      { actor, deps, tool: "set_spawn_points", dryRun },
      roomId,
      (doc) => setSpawnPoints3D(doc, subroomId, spawnPoints),
    );
    return mutationResult(
      outcome,
      `✅ set_spawn_points — ${spawnPoints.length} punto(s) en "${subroomId}"`,
      { roomId, subroomId, ids: spawnPoints.map((spawn) => spawn.id) },
    );
  },
});
