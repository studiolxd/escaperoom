import { setRoomTimeLimit } from "@escaperoom/editor/room-doc";
import { RoomPackageMetaSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/**
 * Ticket duración-salas (specs/04 §6): única tool del MCP que edita la
 * metadata de un draft YA creado (a diferencia de `create_room`, que solo
 * fija los valores iniciales). Se acota a la duración porque es el único
 * ajuste post-creación pedido hasta ahora; si en el futuro hace falta editar
 * más campos de `meta`, esta tool es el sitio natural donde ampliarlos.
 */
export const setRoomDurationTool = defineTool({
  name: "set_room_duration",
  title: "Fijar duración de la sala",
  description:
    "Cambia el límite de partida de un draft ya creado (`meta.timeLimitMinutes`, en minutos, sin tope máximo). `null` marca la sala como sin duración (sin límite de tiempo); el servidor es siempre quien lo aplica, nunca el cliente.",
  phase: "structure",
  ticket: "duración-salas",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    timeLimitMinutes: RoomPackageMetaSchema.shape.timeLimitMinutes.unwrap(),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, timeLimitMinutes, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft(
      { actor, deps, tool: "set_room_duration", dryRun },
      roomId,
      (doc) => setRoomTimeLimit(doc, timeLimitMinutes),
    );
    const detail = timeLimitMinutes === null ? "sin duración" : `${timeLimitMinutes} min`;
    return mutationResult(outcome, `✅ set_room_duration — duración de la sala: ${detail}`, {
      roomId,
      timeLimitMinutes,
    });
  },
});
