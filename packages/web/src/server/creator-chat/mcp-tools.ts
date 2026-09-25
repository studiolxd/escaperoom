import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ChatToolDefinition } from "./provider";

/** Resultado aplanado de una tool del MCP. */
export type CreatorToolResult = {
  isError: boolean;
  /** Texto legible para el agente (el que el MCP escribe para Claude Desktop). */
  text: string;
  structured: Record<string, unknown> | null;
};

/** Lo que el orquestador necesita del MCP: listar tools y llamarlas. */
export interface CreatorToolClient {
  listTools(): Promise<ChatToolDefinition[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<CreatorToolResult>;
  close(): Promise<void>;
}

/**
 * Tools del MCP que no se ofrecen al modelo del chat. Vacío por defecto: el
 * ejemplo de paridad del ticket 0.10 (`get_featured_room`) que ocupaba este
 * hueco se retiró del toolset de producción (D-28), así que ya no hace falta
 * ocultarlo; el conjunto queda como punto de extensión para el futuro.
 */
export const CHAT_HIDDEN_TOOLS: ReadonlySet<string> = new Set();

export type McpHttpToolClientOptions = {
  /** URL de `/mcp/creator`. */
  url: URL;
  /**
   * Cabeceras de identidad que se reenvían en cada petición: la cookie de
   * sesión de Better Auth del creador (en 4.7, lo que acepte su `authenticate`).
   */
  headers: Record<string, string>;
  /**
   * `fetch` del transporte. Por defecto el global (red); la ruta de Next le
   * pasa uno que entrega la petición al handler de `/mcp/creator` en el mismo
   * proceso, sin salir a la red.
   */
  fetch?: FetchLike;
};

function flatten(result: Awaited<ReturnType<Client["callTool"]>>): CreatorToolResult {
  const content = Array.isArray(result.content)
    ? (result.content as Array<{ type: string; text?: string }>)
    : [];
  return {
    isError: result.isError === true,
    text: content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n"),
    structured:
      typeof result.structuredContent === "object" && result.structuredContent !== null
        ? (result.structuredContent as Record<string, unknown>)
        : null,
  };
}

/**
 * Cliente MCP del chat: habla con el MISMO servidor que Claude Desktop, por el
 * transporte HTTP streamable de `/mcp/creator` y con la identidad del creador
 * (specs/10 §5; sin lógica paralela). Se conecta en la primera llamada.
 */
export function createMcpHttpToolClient(options: McpHttpToolClientOptions): CreatorToolClient {
  let connected: Promise<Client> | null = null;
  const client = () => {
    connected ??= (async () => {
      const mcp = new Client({ name: "escaperoom-creator-chat", version: "0.1.0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(options.url, {
          requestInit: { headers: options.headers },
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }),
      );
      return mcp;
    })();
    return connected;
  };

  return {
    async listTools() {
      const mcp = await client();
      const tools: ChatToolDefinition[] = [];
      let cursor: string | undefined;
      do {
        const page = await mcp.listTools(cursor ? { cursor } : undefined);
        for (const tool of page.tools) {
          if (CHAT_HIDDEN_TOOLS.has(tool.name)) continue;
          tools.push({
            name: tool.name,
            description: tool.description ?? tool.title ?? tool.name,
            inputSchema: tool.inputSchema as Record<string, unknown>,
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    },
    async callTool(name, input) {
      const mcp = await client();
      try {
        return flatten(await mcp.callTool({ name, arguments: input }));
      } catch (error) {
        // 429 del rate limit por token del MCP (4.7): el modelo y la UI lo ven
        // como error de la tool, con el mensaje legible del servidor.
        if (error instanceof StreamableHTTPError && error.code === 429) {
          return {
            isError: true,
            text: `❌ ${name}: límite de uso del MCP superado; no se ha ejecutado. Detén los cambios y pide al creador que espere un minuto antes de continuar. (${error.message})`,
            structured: { error: { code: "RATE_LIMITED", message: error.message } },
          };
        }
        throw error;
      }
    },
    async close() {
      if (!connected) return;
      const mcp = await connected.catch(() => null);
      await mcp?.close();
    },
  };
}
