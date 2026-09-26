import type { Actor } from "@escaperoom/shared/services";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { CreatorMcpDeps } from "../deps";

/**
 * Fases de creación del toolset (specs/10 §2). `"meta"` son las 4
 * meta-herramientas del propio MCP (`find_tools`, `tool_schema`, `run_tool`,
 * `upload`, auditoría D-12): no construyen la sala, así que quedan fuera del
 * ensayo `dryRun` de las mutaciones del draft (specs/10 §3).
 */
export type ToolPhase = "structure" | "content" | "logic" | "verification" | "query" | "meta";

/** Contexto de ejecución de una tool: actor identificado + servicios. */
export type ToolContext = { actor: Actor; deps: CreatorMcpDeps };

/**
 * Una tool del MCP del creador: esquema Zod de entrada (reutilizando los de
 * `@escaperoom/shared/schemas`), anotaciones y handler. Sin `run`, la tool
 * forma parte del esqueleto y responde "no implementado (ticket …)".
 */
export interface CreatorTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  phase: ToolPhase;
  /** Ticket de la Fase 4 que implementa (o implementó) la tool. */
  ticket: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  /** `false` solo para consultas públicas (catálogo); por defecto exige identidad. */
  requiresIdentity?: boolean;
  run?(input: z.output<S>, ctx: ToolContext): Promise<CallToolResult>;
}

export function defineTool<S extends z.ZodObject>(tool: CreatorTool<S>): CreatorTool<S> {
  return tool;
}

/** Id del draft sobre el que opera la tool (el mismo `:roomId` de la REST del editor). */
export const RoomIdSchema = z
  .string()
  .min(1)
  .describe("Id (UUID) de la sala en borrador sobre la que operar");

/** Anotaciones de una consulta: no muta nada. */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

/**
 * Anotaciones de una mutación del draft (ADR-010, revisado 2026-09-26 — D-12
 * de la auditoría). El draft es reversible (historial Yjs, validador
 * incremental en cada paso), así que estas mutaciones NO exigen `confirm` ni
 * pasan por ningún gate: se escriben directas. Solo `publish` (irreversible)
 * exige confirmación humana explícita, y ya la tiene (4.5,
 * `PublishConfirmationService`). `destructiveHint`/`readOnlyHint` se
 * mantienen igual: son información estándar del protocolo MCP para que el
 * cliente decida cómo mostrar la tool, no un mecanismo propio de gate.
 */
export const MUTATION: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** Opción común de las tools de alta: sustituir la entrada del mismo id. */
export const ReplaceSchema = z
  .boolean()
  .optional()
  .describe("true = sustituye la entrada existente con el mismo id (conserva su orden)");

/**
 * Opción común de las tools que mutan (4.4): ensaya la mutación (Zod, dry-run y
 * validador incremental) y devuelve el resultado SIN escribir en el draft.
 */
export const DryRunSchema = z
  .boolean()
  .optional()
  .describe(
    "true = ensayo: valida y devuelve el resultado (avisos o error del validador) sin escribir nada en el draft",
  );
