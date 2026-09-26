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
import { findToolsTool } from "./find-tools";
import { getPuzzleTool } from "./get-puzzle";
import { getRoomTool } from "./get-room";
import { getRoomGraphTool } from "./get-room-graph";
import { getRulesForTool } from "./get-rules-for";
import { getTemplateCatalogTool } from "./get-template-catalog";
import { paintTilesTool } from "./paint-tiles";
import { previewTool } from "./preview";
import { publishTool } from "./publish";
import { runToolTool } from "./run-tool";
import { setMapTool } from "./set-map";
import { setRoomDurationTool } from "./set-room-duration";
import { toolSchemaTool } from "./tool-schema";
import { uploadTool } from "./upload";
import { validateTool } from "./validate";

export * from "./define";

/**
 * Toolset "de contenido" del MCP del creador (specs/10 §2): construyen y
 * consultan la sala. Un módulo por tool (specs/10 §5); es el universo sobre
 * el que buscan/leen/ejecutan las meta-tools de abajo — así `run_tool` no
 * puede alcanzarse a sí misma ni a las otras tres meta-tools (D-12): nunca
 * están en esta lista.
 */
export const CONTENT_TOOLSET: readonly CreatorTool[] = [
  // Fase A — Estructura
  createRoomTool,
  setMapTool,
  setRoomDurationTool,
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

/**
 * Meta-herramientas del propio MCP (specs/10 §1.1, ADR-010; auditoría D-12):
 * descubrimiento diferido (`find_tools` → `tool_schema` → `run_tool`) y
 * `upload` para binarios, que MCP no transporta por streaming.
 */
export const META_TOOLSET: readonly CreatorTool[] = [
  findToolsTool,
  toolSchemaTool,
  runToolTool,
  uploadTool,
];

/** Toolset completo que registra el servidor MCP (specs/10 §2 + meta-tools). */
export const CREATOR_TOOLSET: readonly CreatorTool[] = [...CONTENT_TOOLSET, ...META_TOOLSET];

/** Nombres del toolset, en orden. */
export const CREATOR_TOOL_NAMES: readonly string[] = CREATOR_TOOLSET.map((tool) => tool.name);
