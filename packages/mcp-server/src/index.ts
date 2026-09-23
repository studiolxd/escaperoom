/**
 * MCP del creador (specs/10, ADR-010): servidor con el toolset de specs/10 §2
 * sobre los servicios de dominio compartidos, con transporte stdio (Claude
 * Desktop) y HTTP streamable (`/mcp/creator`, chat web).
 */
export * from "./auth";
export * from "./deps";
export * from "./results";
export * from "./room-draft-reader";
export * from "./server";
export * from "./tools";
export * from "./transports/http";
export * from "./transports/stdio";
