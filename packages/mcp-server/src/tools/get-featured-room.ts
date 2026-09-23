import { z } from "zod";
import { textResult } from "../results";
import { defineTool, READ_ONLY } from "./define";

/**
 * Tool de ejemplo del ticket 0.10 (paridad tRPC == REST == MCP). Consulta
 * pública del catálogo: no exige identidad.
 */
export const getFeaturedRoomTool = defineTool({
  name: "get_featured_room",
  title: "Sala destacada",
  description:
    "Devuelve la sala destacada del catálogo (La Maldición del Rey Aldric) usando el servicio de dominio compartido.",
  phase: "query",
  ticket: "0.10",
  inputSchema: z.object({}),
  annotations: READ_ONLY,
  requiresIdentity: false,
  async run(_input, { actor, deps }) {
    const room = await deps.catalog.getFeaturedRoom(actor);
    return textResult(JSON.stringify(room));
  },
});
