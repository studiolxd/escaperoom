import { ANONYMOUS_ACTOR } from "@escaperoom/shared/services";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { hasIdentity } from "./auth";
import type { CreatorMcpDeps } from "./deps";
import { errorResult, notImplementedResult, ToolError } from "./results";
import { CREATOR_TOOLSET, type CreatorTool } from "./tools";

/** Endpoint HTTP del MCP del creador (ADR-010). */
export const MCP_ENDPOINT = "/mcp/creator" as const;

export const MCP_SERVER_INFO = { name: "escaperoom-creator", version: "0.1.0" } as const;

/**
 * Tope por defecto del texto de una respuesta de tool (specs/10 §5, coste de
 * tokens): 64 KB ≈ 16k tokens. Una sala mediana (el Rey Aldric, ~25 KB) cabe;
 * una grande debe consultarse por partes con las vistas filtradas.
 */
export const DEFAULT_MAX_TOOL_RESPONSE_BYTES = 64 * 1024;

/** Vistas filtradas que sustituyen a una lectura completa de la sala. */
const FILTERED_VIEWS = ["get_room_graph", "get_puzzle", "get_rules_for"] as const;

function textBytes(result: CallToolResult): number {
  let bytes = 0;
  for (const block of result.content) {
    if (block.type === "text") bytes += Buffer.byteLength(block.text, "utf8");
  }
  return bytes;
}

/** Ids de una lista `[{ id }]` (a lo sumo `max`), para que el agente sepa qué pedir. */
function idsOf(value: unknown, max = 60): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map((entry) =>
      entry && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined,
    )
    .filter((id): id is string => typeof id === "string");
  return ids.slice(0, max);
}

/**
 * Sustituye una respuesta que supera el tope por un error accionable: cuánto
 * ocupa, qué vistas filtradas usar y, si es una sala, los ids de sus puzzles
 * y objetos para pedirlos de uno en uno.
 */
function oversizeResult(tool: CreatorTool, result: CallToolResult, bytes: number, limit: number) {
  const kb = (n: number) => `${Math.ceil(n / 1024)} KB`;
  const room = (result.structuredContent as { room?: Record<string, unknown> } | undefined)?.room;
  const puzzleIds = idsOf(room?.puzzles);
  const objectIds = idsOf(room?.objects);
  const lines = [
    `la respuesta ocupa ${kb(bytes)} y supera el tope de ${kb(limit)} por respuesta (coste de tokens).`,
    "Consulta la sala por partes con las vistas filtradas: get_room_graph({ roomId }) para la estructura y los ids, " +
      "get_puzzle({ roomId, puzzleId }) para un puzzle con sus pistas y reglas, y " +
      "get_rules_for({ roomId, objectId }) para las reglas que tocan un objeto.",
  ];
  if (puzzleIds?.length) lines.push(`Puzzles: [${puzzleIds.join(", ")}]`);
  if (objectIds?.length) lines.push(`Objetos: [${objectIds.join(", ")}]`);
  return errorResult(tool.name, "RESPONSE_TOO_LARGE", lines.join("\n"), {
    bytes,
    limit,
    alternatives: [...FILTERED_VIEWS],
    ...(puzzleIds ? { puzzleIds } : {}),
    ...(objectIds ? { objectIds } : {}),
  });
}

/**
 * Ejecuta una tool con la política común: identidad obligatoria (salvo
 * consultas públicas), "no implementado" para el esqueleto, traducción de
 * errores de dominio a resultados legibles con `isError` y tope de tamaño de
 * la respuesta (4.7).
 */
async function runTool(
  tool: CreatorTool,
  input: unknown,
  deps: CreatorMcpDeps,
): Promise<CallToolResult> {
  const actor = deps.actor;
  const requiresIdentity = tool.requiresIdentity ?? true;
  if (requiresIdentity && !hasIdentity(actor)) {
    return errorResult(
      tool.name,
      "UNAUTHORIZED",
      "sin identidad de creador. En stdio, define ESCAPEROOM_MCP_USER_ID; por HTTP, inicia sesión.",
    );
  }
  if (!tool.run) return notImplementedResult(tool.name, tool.ticket);
  try {
    const result = await tool.run(input as never, {
      actor: actor ?? ANONYMOUS_ACTOR,
      deps,
    });
    const limit = deps.maxToolResponseBytes ?? DEFAULT_MAX_TOOL_RESPONSE_BYTES;
    const bytes = textBytes(result);
    return bytes > limit ? oversizeResult(tool, result, bytes, limit) : result;
  } catch (error) {
    if (error instanceof ToolError) {
      return errorResult(tool.name, error.code, error.message, error.details);
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(tool.name, "INTERNAL", message);
  }
}

/**
 * Servidor MCP del creador: registra el toolset de specs/10 §2 sobre los
 * mismos servicios de dominio que tRPC y REST (ADR-010/022). Es independiente
 * del transporte: stdio (`runStdioServer`), HTTP Node (`startHttpServer`) o la
 * ruta de Next (`/mcp/creator`) lo conectan igual.
 */
export function createCreatorMcpServer(deps: CreatorMcpDeps): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions:
      "MCP del creador de escape rooms: construye y edita salas en borrador (draft) con las mismas reglas que el editor visual. Empieza por get_room y valida con validate. Cada mutación se valida antes de escribirse: si introduce errores nuevos se rechaza con el motivo; pasa `dryRun: true` para ensayarla sin escribir. Para publicar: validate (checklist en verde), preview para probarla y publish, que NO publica: devuelve un enlace que el creador confirma en la web.",
  });

  for (const tool of CREATOR_TOOLSET) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        _meta: { "escaperoom/phase": tool.phase, "escaperoom/ticket": tool.ticket },
      },
      (input: unknown) => runTool(tool, input, deps),
    );
  }

  return server;
}
