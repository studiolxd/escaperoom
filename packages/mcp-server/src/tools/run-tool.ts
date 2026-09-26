import { z } from "zod";
import { ToolError } from "../results";
import { runTool } from "../server";
import { CONTENT_TOOLSET } from "./index";
import { defineTool } from "./define";

/**
 * Meta-tool 3/3 del descubrimiento diferido (D-12): ejecuta por nombre
 * cualquier tool de `CONTENT_TOOLSET` — nunca a sí misma ni a las otras
 * meta-tools (`find_tools`, `tool_schema`, `upload`), que sencillamente no
 * están en `CONTENT_TOOLSET` (ver el comentario de esa lista en `./index`).
 *
 * Delega en `runTool`, el MISMO pipeline que usa el registro directo de la
 * tool en `createCreatorMcpServer` (identidad, traducción de errores de
 * dominio, tope de tamaño de la respuesta): no es un atajo que se salte
 * comprobaciones (specs/10 §1.1). La única diferencia con una llamada directa
 * es que la validación Zod de la entrada ocurre aquí a mano (el SDK MCP la
 * hace por nosotros para las tools registradas normales, pero `run_tool` es
 * ella misma la que decide qué tool y qué esquema aplicar).
 */
export const runToolTool = defineTool({
  name: "run_tool",
  title: "Ejecutar una tool del creador",
  description:
    "Ejecuta una tool del catálogo por su nombre exacto con sus argumentos, por el mismo pipeline que una llamada directa (identidad, validación, autorización del actor sobre la sala, límite de tamaño de respuesta). Consulta find_tools y tool_schema antes de llamarla. No puede ejecutar find_tools, tool_schema, upload ni a sí misma.",
  phase: "meta",
  ticket: "D-12",
  inputSchema: z.object({
    name: z.string().min(1).describe("Nombre exacto de la tool a ejecutar"),
    arguments: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Argumentos de la tool, con la forma de su inputSchema (ver tool_schema)"),
  }),
  // No es de solo lectura (puede alcanzar mutaciones), pero tampoco tiene un
  // efecto propio fijo: el que tenga la tool delegada.
  annotations: { readOnlyHint: false, openWorldHint: false },
  async run({ name, arguments: args }, { deps }) {
    const target = CONTENT_TOOLSET.find((candidate) => candidate.name === name);
    if (!target) {
      throw new ToolError(
        "NOT_FOUND",
        `no existe la tool "${name}" en el catálogo ejecutable por run_tool (las meta-tools no se pueden invocar entre sí). Usa find_tools para ver los nombres disponibles.`,
        { available: CONTENT_TOOLSET.map((t) => t.name) },
      );
    }
    const parsed = target.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      throw new ToolError(
        "INVALID_INPUT",
        `argumentos inválidos para "${name}": ${z.prettifyError(parsed.error)}`,
        { issues: parsed.error.issues },
      );
    }
    return runTool(target, parsed.data, deps);
  },
});
