import { z } from "zod";
import { textResult, ToolError } from "../results";
import { CONTENT_TOOLSET } from "./index";
import { defineTool, READ_ONLY } from "./define";

/**
 * Meta-tool 2/3 del descubrimiento diferido (D-12): esquema de entrada
 * completo (JSON Schema desde el Zod real de la tool, el mismo con el que
 * valida `run_tool`) de una tool de `CONTENT_TOOLSET`, para pedirlo solo
 * cuando `find_tools` ya la señaló.
 */
export const toolSchemaTool = defineTool({
  name: "tool_schema",
  title: "Esquema de una tool del creador",
  description:
    "Devuelve el esquema de entrada (JSON Schema) de una tool del catálogo, con su descripción y anotaciones. Llámala tras find_tools y antes de run_tool.",
  phase: "meta",
  ticket: "D-12",
  inputSchema: z.object({
    name: z.string().min(1).describe("Nombre exacto de la tool, tal y como lo devuelve find_tools"),
  }),
  annotations: READ_ONLY,
  requiresIdentity: false,
  async run({ name }) {
    const tool = CONTENT_TOOLSET.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new ToolError(
        "NOT_FOUND",
        `no existe la tool "${name}" en el catálogo. Usa find_tools para ver los nombres disponibles.`,
        { available: CONTENT_TOOLSET.map((t) => t.name) },
      );
    }
    const schema = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      phase: tool.phase,
      inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
      annotations: tool.annotations,
    };
    return textResult(JSON.stringify(schema), schema);
  },
});
