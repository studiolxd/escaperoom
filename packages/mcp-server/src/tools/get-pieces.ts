import { listIds, listPieces3D, roomDimension } from "@escaperoom/editor/room-doc";
import { z } from "zod";
import { textResult, ToolError } from "../results";
import { readDraftDoc } from "../room-draft-reader";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/** Fase E — piezas de una habitación 3D (specs/27 §8.2). */
export const getPiecesTool = defineTool({
  name: "get_pieces",
  title: "Ver piezas 3D",
  description:
    "Lista las piezas de una habitación de una sala 3D, una por línea (`id model x y h yaw`; metros y grados). `model` filtra por modelo: filtra por `model` si la habitación tiene muchas piezas.",
  phase: "query",
  ticket: "7.9",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    subroomId: z.string().min(1).describe("Habitación interna (id de define_subrooms)"),
    model: z.string().min(1).optional().describe("Solo las piezas de este modelo"),
  }),
  annotations: READ_ONLY,
  async run({ roomId, subroomId, model }, { actor, deps }) {
    const pieces = await readDraftDoc(deps, actor, roomId, (doc) => {
      if (roomDimension(doc) !== "3d") {
        throw new ToolError(
          "INVALID_INPUT",
          "get_pieces solo existe en salas 3D. Esta sala es 2D: usa get_room.",
          { reason: "WRONG_DIMENSION" },
        );
      }
      const rooms = listIds(doc, "subrooms");
      if (!rooms.includes(subroomId)) {
        throw new ToolError(
          "NOT_FOUND",
          `No existe la habitación "${subroomId}". Habitaciones disponibles: [${rooms.join(", ")}]`,
          { reason: "UNKNOWN_ROOM", available: rooms },
        );
      }
      return listPieces3D(doc, subroomId)
        .filter((piece) => model === undefined || piece.model === model)
        .map((piece) => {
          const { roomId: _unused, ...rest } = piece;
          void _unused;
          return rest;
        });
    });
    const lines = pieces.map(
      (p) => `${p.id} ${p.model} ${p.x} ${p.y} ${p.h} ${p.yaw}${p.scale !== undefined ? ` ×${p.scale}` : ""}`,
    );
    return textResult(
      `${pieces.length} pieza(s) en "${subroomId}"${model ? ` (modelo ${model})` : ""}${lines.length ? `\n${lines.join("\n")}` : ""}`,
      { pieces },
    );
  },
});
