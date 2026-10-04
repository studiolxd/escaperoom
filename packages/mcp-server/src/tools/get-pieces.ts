import { buildRoomWorld3D, listIds, listPieces3D, ROOM_DOC_KEYS, roomDimension } from "@escaperoom/editor/room-doc";
import { getModels3DCatalog, MODEL3D_CATEGORIES } from "@escaperoom/shared/packs";
import { z } from "zod";
import { pieceCategory } from "../room-pieces-view";
import { textResult, ToolError } from "../results";
import { readDraftDoc } from "../room-draft-reader";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

const DEFAULT_LIMIT = 300;

/** Fase E — piezas de una habitación 3D (specs/27 §8.2). */
export const getPiecesTool = defineTool({
  name: "get_pieces",
  title: "Ver piezas 3D",
  description:
    "Lista las piezas de una habitación de una sala 3D, una por línea (`id model x y h yaw`; metros y grados). " +
    "Filtra por `model` y/o `category` (categoría del modelo en el catálogo: suelo, muro, estructura, mueble, pared, suelto; `propio` = modelo de la sala; `desconocido` = ni del catálogo ni propio). " +
    "Pagina con `offset` y `limit` (por defecto 300, máx. 500; 300 piezas caben holgadas en una respuesta): la primera línea indica el total y el `offset` de la página siguiente.",
  phase: "query",
  ticket: "7.9",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    subroomId: z.string().min(1).describe("Habitación interna (id de define_subrooms)"),
    model: z.string().min(1).optional().describe("Solo las piezas de este modelo"),
    category: z
      .enum([...MODEL3D_CATEGORIES, "propio", "desconocido"])
      .optional()
      .describe("Solo las piezas cuyo modelo es de esta categoría"),
    offset: z.number().int().min(0).optional().describe("Piezas a saltar (por defecto 0)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe(`Máximo de piezas a devolver (por defecto ${DEFAULT_LIMIT})`),
  }),
  annotations: READ_ONLY,
  async run({ roomId, subroomId, model, category, offset = 0, limit = DEFAULT_LIMIT }, { actor, deps }) {
    const all = await readDraftDoc(deps, actor, roomId, (doc) => {
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
      const tileset = String(doc.getMap<unknown>(ROOM_DOC_KEYS.map).get("tileset") ?? "");
      const catalog = getModels3DCatalog(tileset);
      const custom = category ? buildRoomWorld3D(doc).models : undefined;
      return listPieces3D(doc, subroomId)
        .filter((piece) => model === undefined || piece.model === model)
        .filter(
          (piece) => category === undefined || pieceCategory(piece.model, catalog, custom) === category,
        )
        .map((piece) => {
          const { roomId: _unused, ...rest } = piece;
          void _unused;
          return rest;
        });
    });
    const total = all.length;
    if (total > 0 && offset >= total) {
      throw new ToolError(
        "INVALID_INPUT",
        `offset ${offset} fuera de rango: hay ${total} pieza(s) en "${subroomId}" con estos filtros (offset válido: 0–${total - 1}).`,
        { reason: "OFFSET_OUT_OF_RANGE", total },
      );
    }
    const pieces = all.slice(offset, offset + limit);
    const end = offset + pieces.length;
    const nextOffset = end < total ? end : null;
    const filters =
      model || category
        ? ` (${[model ? `modelo ${model}` : "", category ? `categoría ${category}` : ""].filter(Boolean).join(", ")})`
        : "";
    const header =
      total === 0
        ? `0 pieza(s) en "${subroomId}"${filters}`
        : `Piezas ${offset + 1}–${end} de ${total} en "${subroomId}"${filters}${
            nextOffset !== null ? ` — siguiente página: offset ${nextOffset}` : ""
          }`;
    const lines = pieces.map(
      (p) => `${p.id} ${p.model} ${p.x} ${p.y} ${p.h} ${p.yaw}${p.scale !== undefined ? ` ×${p.scale}` : ""}`,
    );
    return textResult(`${header}${lines.length ? `\n${lines.join("\n")}` : ""}`, {
      pieces,
      total,
      offset,
      limit,
      nextOffset,
    });
  },
});
