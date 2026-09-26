import { z } from "zod";
import { textResult, ToolError } from "../results";
import { CONTENT_TOOLSET } from "./index";
import { defineTool, READ_ONLY } from "./define";

const PhaseEnum = z.enum(["structure", "content", "logic", "verification", "query"]);

/**
 * Meta-tool 1/3 del descubrimiento diferido (specs/10 §1.1, ADR-010; D-12 de
 * la auditoría): busca en `CONTENT_TOOLSET` por palabras clave y/o fase y
 * devuelve solo nombre + descripción breve — el agente no necesita cargar el
 * catálogo completo (specs/10 §2) en cada turno. El esquema completo llega
 * con `tool_schema`; la ejecución, con `run_tool`.
 */
export const findToolsTool = defineTool({
  name: "find_tools",
  title: "Buscar tools del creador",
  description:
    "Busca en el catálogo de tools de creación de salas por palabras clave y/o fase (structure, content, logic, verification, query) y devuelve nombre y descripción breve de cada resultado, sin su esquema completo. Sigue con tool_schema para la tool elegida y run_tool para ejecutarla.",
  phase: "meta",
  ticket: "D-12",
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Palabras clave contra el nombre y la descripción de cada tool"),
    phase: PhaseEnum.optional().describe("Filtra por fase del toolset (specs/10 §2)"),
  }),
  annotations: READ_ONLY,
  requiresIdentity: false,
  async run({ query, phase }) {
    if (!query && !phase) {
      throw new ToolError("INVALID_INPUT", "indica `query`, `phase` o ambos");
    }
    const terms = query ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const matches = CONTENT_TOOLSET.filter((tool) => !phase || tool.phase === phase)
      .map((tool) => {
        if (terms.length === 0) return { tool, score: 1 };
        const name = tool.name.toLowerCase();
        const haystack = `${name} ${tool.title} ${tool.description}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (name.includes(term)) score += 2;
          else if (haystack.includes(term)) score += 1;
        }
        return { tool, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ tool }) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        phase: tool.phase,
      }));

    if (matches.length === 0) {
      return textResult("Ninguna tool coincide. Prueba con menos palabras clave o sin `phase`.", {
        matches: [],
      });
    }
    return textResult(
      matches.map((m) => `- ${m.name} (${m.phase}): ${m.description}`).join("\n"),
      { matches },
    );
  },
});
