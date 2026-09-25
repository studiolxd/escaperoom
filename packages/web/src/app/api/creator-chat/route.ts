import { MCP_ENDPOINT } from "@escaperoom/mcp-server";
import { POST as handleMcpRequest } from "@/app/mcp/creator/route";
import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import {
  createAnthropicChatProvider,
  createCreatorChatHandlers,
  createGoogleChatProvider,
  createInMemoryConversationStore,
  createMcpHttpToolClient,
  createOpenAiChatProvider,
  createRedisCreatorChatDailyBudget,
  readCreatorChatConfig,
  type ChatConversationStore,
  type ChatModelProvider,
  type CreatorChatConfig,
} from "@/server/creator-chat";

type ConfiguredChat = Extract<CreatorChatConfig, { configured: true }>;

/** Un proveedor por petición (ticket «migrar-ai-sdk-chat»): `CREATOR_CHAT_PROVIDER` elige cuál. */
function createProviderFor(config: ConfiguredChat): ChatModelProvider {
  const { apiKey, model } = config;
  switch (config.provider) {
    case "openai":
      return createOpenAiChatProvider({ apiKey, model });
    case "google":
      return createGoogleChatProvider({ apiKey, model });
    case "anthropic":
      return createAnthropicChatProvider({ apiKey, model });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Conversaciones del proceso (sobrevive al HMR de desarrollo). */
const globalForChat = globalThis as unknown as { creatorChatStore?: ChatConversationStore };
const store = (globalForChat.creatorChatStore ??= createInMemoryConversationStore());

/** Presupuesto diario de tokens por usuario (B-6): en Redis, no por proceso. */
const dailyBudget = createRedisCreatorChatDailyBudget();

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
export const POST = withRateLimit("creator-chat", (request: Request) => {
  const remoteMcp = process.env.CREATOR_CHAT_MCP_URL?.trim();
  return createCreatorChatHandlers({
    resolveActor: resolveActorFromRequest,
    config: () => readCreatorChatConfig(),
    createProvider: createProviderFor,
    createToolClient: (req) =>
      createMcpHttpToolClient({
        url: remoteMcp ? new URL(remoteMcp) : new URL(MCP_ENDPOINT, req.url),
        headers: identityHeaders(req),
        ...(remoteMcp ? {} : { fetch: (url, init) => handleMcpRequest(new Request(url, init)) }),
      }),
    store,
    dailyBudget,
  }).postMessage(request);
});
