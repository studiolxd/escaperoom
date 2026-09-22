/**
 * Servicios de dominio — única lógica invocada por tRPC (UI), REST, MCP y
 * Colyseus (ADR-022). Placeholder del ticket 0.1; se puebla desde el 0.10.
 */
export type Actor = {
  userId: string;
  organizationId: string | null;
  role: "owner" | "admin" | "member";
};
