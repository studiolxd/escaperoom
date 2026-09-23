import { MCP_ENDPOINT } from "@escaperoom/mcp-server";
import { POST as handleMcpRequest } from "@/app/mcp/creator/route";
import { resolveActorFromRequest } from "@/server/context";
import {
  createAnthropicChatProvider,
  createCreatorChatHandlers,
  createInMemoryConversationStore,
  createMcpHttpToolClient,
  readCreatorChatConfig,
  type ChatConversationStore,
} from "@/server/creator-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Conversaciones del proceso (sobrevive al HMR de desarrollo). */
const globalForChat = globalThis as unknown as { creatorChatStore?: ChatConversationStore };
const store = (globalForChat.creatorChatStore ??= createInMemoryConversationStore());

/** Cabeceras de identidad que se reenvían al MCP: la sesión de Better Auth del creador. */
function identityHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  return headers;
}

/**
 * POST /api/creator-chat — chat del creador (ticket 4.6). Las tools se llaman
 * por el transporte HTTP streamable de `/mcp/creator`: por defecto la petición
 * se entrega al handler de esa ruta en el mismo proceso (sin salir a la red);
 * con `CREATOR_CHAT_MCP_URL` se usa esa URL por red.
 */
export function POST(request: Request) {
  const remoteMcp = process.env.CREATOR_CHAT_MCP_URL?.trim();
  return createCreatorChatHandlers({
    resolveActor: resolveActorFromRequest,
    config: () => readCreatorChatConfig(),
    createProvider: (config) =>
      createAnthropicChatProvider({ apiKey: config.apiKey, model: config.model }),
    createToolClient: (req) =>
      createMcpHttpToolClient({
        url: remoteMcp ? new URL(remoteMcp) : new URL(MCP_ENDPOINT, req.url),
        headers: identityHeaders(req),
        ...(remoteMcp ? {} : { fetch: (url, init) => handleMcpRequest(new Request(url, init)) }),
      }),
    store,
  }).postMessage(request);
}
