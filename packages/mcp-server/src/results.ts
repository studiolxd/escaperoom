import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Códigos de error estables de las tools. Los mensajes son legibles para el
 * agente; el código va además en `structuredContent.error` para los clientes.
 */
export type ToolErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_IMPLEMENTED"
  | "NOT_AVAILABLE"
  | "INVALID_DRAFT"
  | "INTERNAL";

/** Error de dominio que una tool traduce a resultado MCP con `isError`. */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

/** Resultado de éxito: texto para el agente y, opcionalmente, datos estructurados. */
export function textResult(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** Resultado de error de una tool (el agente lo ve; no es un error de protocolo). */
export function errorResult(
  tool: string,
  code: ToolErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `❌ ${tool}: ${message}` }],
    structuredContent: { error: { code, message, ...extra } },
  };
}

/** Error claro de una tool del esqueleto cuya implementación llega en otro ticket. */
export function notImplementedResult(tool: string, ticket: string): CallToolResult {
  return errorResult(
    tool,
    "NOT_IMPLEMENTED",
    `no implementado todavía (ticket ${ticket}). El esquema de entrada ya es el definitivo.`,
    { ticket },
  );
}
