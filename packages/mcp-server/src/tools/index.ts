import { addDialogTool } from "./add-dialog";
import { addHintTool } from "./add-hint";
import { addObjectTool } from "./add-object";
import { addPuzzleTool } from "./add-puzzle";
import { addRuleTool } from "./add-rule";
import { createRoomTool } from "./create-room";
import { decorateSubroomTool } from "./decorate-subroom";
import type { CreatorTool } from "./define";
import { defineItemTool } from "./define-item";
import { defineSubroomsTool } from "./define-subrooms";
import { getPuzzleTool } from "./get-puzzle";
import { getRoomTool } from "./get-room";
import { getRoomGraphTool } from "./get-room-graph";
import { getRulesForTool } from "./get-rules-for";
import { getTemplateCatalogTool } from "./get-template-catalog";
import { paintTilesTool } from "./paint-tiles";
import { previewTool } from "./preview";
import { publishTool } from "./publish";
import { setMapTool } from "./set-map";
import { validateTool } from "./validate";

export * from "./define";

/**
 * Toolset del MCP del creador (specs/10 §2), en el orden de las fases de
 * creación. Un módulo por tool (specs/10 §5); las que no tienen `run` son el
 * esqueleto de sus tickets (4.2–4.5).
 */
export const CREATOR_TOOLSET: readonly CreatorTool[] = [
  // Fase A — Estructura
  createRoomTool,
  setMapTool,
  paintTilesTool,
  defineSubroomsTool,
  // Fase B — Contenido
  addObjectTool,
  decorateSubroomTool,
  defineItemTool,
  addPuzzleTool,
  addDialogTool,
  addHintTool,
  // Fase C — Lógica
  addRuleTool,
  getRoomGraphTool,
  // Fase D — Verificación y publicación
  validateTool,
  previewTool,
  publishTool,
  // Fase E — Consulta
  getRoomTool,
  getTemplateCatalogTool,
  getPuzzleTool,
  getRulesForTool,
];

/** Nombres del toolset, en orden. */
export const CREATOR_TOOL_NAMES: readonly string[] = CREATOR_TOOLSET.map((tool) => tool.name);
