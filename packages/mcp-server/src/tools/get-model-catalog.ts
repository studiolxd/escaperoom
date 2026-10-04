import { buildRoomWorld3D, roomDimension, ROOM_DOC_KEYS } from "@escaperoom/editor/room-doc";
import { getModels3DCatalog, MODEL3D_CATEGORIES } from "@escaperoom/shared/packs";
import { z } from "zod";
import { textResult, ToolError } from "../results";
import { readDraftDoc } from "../room-draft-reader";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

type CatalogModel = {
  id: string;
  category: string;
  size: { w: number; d: number; hgt: number };
  snap: boolean;
  clips: string[];
  custom: boolean;
};

/** Fase E — modelos 3D disponibles en una sala 3D (specs/27 §4, §8.2). */
export const getModelCatalogTool = defineTool({
  name: "get_model_catalog",
  title: "Catálogo de modelos 3D",
  description:
    "Lista los modelos 3D que puedes usar en una sala 3D: los del pack gráfico del draft más los propios de la sala. Por modelo: `id — categoría — w×d×hgt m — snap — clips`. `snap` = pieza de kit (imán de 1 m y 90°). Los `id` son los `model` de place_pieces y los `sprite` de add_object. `category` filtra (suelo, muro, estructura, mueble, pared, suelto).",
  phase: "query",
  ticket: "7.9",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    category: z.enum(MODEL3D_CATEGORIES).optional().describe("Solo los modelos de esta categoría"),
  }),
  annotations: READ_ONLY,
  async run({ roomId, category }, { actor, deps }) {
    const models = await readDraftDoc(deps, actor, roomId, (doc): CatalogModel[] => {
      if (roomDimension(doc) !== "3d") {
        throw new ToolError(
          "INVALID_INPUT",
          "get_model_catalog solo existe en salas 3D. Esta sala es 2D: usa set_map, paint_tiles y decorate_subroom.",
          { reason: "WRONG_DIMENSION" },
        );
      }
      const tileset = String(doc.getMap<unknown>(ROOM_DOC_KEYS.map).get("tileset") ?? "");
      const catalog = getModels3DCatalog(tileset);
      const out: CatalogModel[] = Object.entries(catalog?.models ?? {}).map(([id, entry]) => ({
        id,
        category: entry.category,
        size: entry.size,
        snap: entry.snap,
        clips: entry.clips,
        custom: false,
      }));
      for (const [id, own] of Object.entries(buildRoomWorld3D(doc).models)) {
        out.push({ id, category: "propio", size: own.size, snap: false, clips: own.clips, custom: true });
      }
      return out;
    });
    const shown = category ? models.filter((model) => model.category === category) : models;
    const lines = shown.map(
      (m) =>
        `${m.id} — ${m.category} — ${m.size.w}×${m.size.d}×${m.size.hgt} m — ${m.snap ? "snap" : "libre"} — ${m.clips.length ? m.clips.join(", ") : "sin clips"}`,
    );
    return textResult(
      `${shown.length} modelo(s)${category ? ` de categoría ${category}` : ""}${lines.length ? `\n${lines.join("\n")}` : ""}`,
      { models: shown },
    );
  },
});
