/**
 * MCP del creador (specs/10, ADR-010): servidor con el toolset de specs/10 §2
 * sobre los servicios de dominio compartidos, con transporte stdio (Claude
 * Desktop) y HTTP streamable (`/mcp/creator`, chat web).
 */
export * from "./auth";
export * from "./deps";
export * from "./draft-writer";
export * from "./links";
export * from "./mutation-validation";
export * from "./publish-checklist";
export * from "./results";
export * from "./room-draft-reader";
export * from "./room-graph";
export * from "./server";
export * from "./tools";
export * from "./transports/http";
export * from "./transports/stdio";
