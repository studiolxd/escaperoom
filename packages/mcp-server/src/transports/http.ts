import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { Actor } from "@escaperoom/shared/services";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveHttpAuth, unauthorizedResponse, type HttpAuthenticator } from "../auth";
import type { CreatorMcpDeps } from "../deps";
import { MCP_CREATOR_SCOPE } from "../oauth/provider";
import type { RateLimiter } from "../rate-limit";
import { createCreatorMcpServer, MCP_ENDPOINT } from "../server";

export type CreatorHttpOptions = {
  /** Resuelve la identidad de la petición (Bearer OAuth de 4.7 o sesión de Better Auth). */
  authenticate: HttpAuthenticator;
  /** Servicios de dominio para el actor ya identificado. */
  createDeps: (actor: Actor) => Omit<CreatorMcpDeps, "actor">;
  /**
   * URL de la metadata del recurso protegido (RFC 9728) que anuncia el 401 en
   * `WWW-Authenticate` para que el cliente MCP descubra el servidor OAuth.
   */
  resourceMetadataUrl?: string | ((request: Request) => string);
  /** Límite de llamadas a tools por token (4.7). Sin él, no se limita. */
  rateLimiter?: RateLimiter;
};

type JsonRpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string };

/** Mensajes JSON-RPC del cuerpo (uno o un lote); `[]` si no es JSON. */
async function peekMessages(request: Request): Promise<JsonRpcMessage[]> {
  if (request.method !== "POST") return [];
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as unknown;
  const list = Array.isArray(body) ? body : [body];
  return list.filter((m): m is JsonRpcMessage => typeof m === "object" && m !== null);
}

/** 429 con un error JSON-RPC legible para el agente y `Retry-After`. */
function rateLimitedResponse(
  messages: JsonRpcMessage[],
  decision: { retryAfterSeconds: number; limit: number; windowSeconds: number },
): Response {
  const message =
    `Límite de uso del MCP superado: máximo ${decision.limit} llamadas a tools cada ` +
    `${decision.windowSeconds} s por token. Reintenta en ${decision.retryAfterSeconds} s. ` +
    "Para gastar menos llamadas, agrupa cambios y consulta con get_room_graph, get_puzzle o " +
    "get_rules_for en vez de releer get_room.";
  const id = messages.length === 1 ? (messages[0]!.id ?? null) : null;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32029, message, data: { code: "RATE_LIMITED", ...decision } },
      id,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(decision.retryAfterSeconds),
      },
    },
  );
}

/**
 * Maneja una petición del MCP por HTTP streamable (sin estado: un servidor por
 * petición, respuestas JSON). Antes de tocar el protocolo: sin identidad (o
 * con un token caducado/revocado) responde 401 con `WWW-Authenticate` hacia la
 * metadata OAuth, y si el token supera su límite de llamadas a tools, 429. La
 * usan la ruta de Next `/mcp/creator` y `startHttpServer`.
 */
export async function handleCreatorMcpRequest(
  request: Request,
  options: CreatorHttpOptions,
): Promise<Response> {
  const auth = resolveHttpAuth(await options.authenticate(request));
  if (!auth.ok) {
    const metadata = options.resourceMetadataUrl;
    return unauthorizedResponse({
      resourceMetadataUrl: typeof metadata === "function" ? metadata(request) : metadata,
      scope: MCP_CREATOR_SCOPE,
      ...(auth.error ? { error: auth.error } : {}),
    });
  }
  const actor = auth.actor;
  if (options.rateLimiter) {
    const messages = await peekMessages(request);
    const calls = messages.filter((m) => m.method === "tools/call").length;
    if (calls > 0) {
      const decision = options.rateLimiter.consume(auth.rateLimitKey, calls);
      if (!decision.ok) return rateLimitedResponse(messages, decision);
    }
  }
  const server = createCreatorMcpServer({ ...options.createDeps(actor), actor });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/** Convierte una petición de `node:http` en un `Request` web estándar. */
function toWebRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", origin), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    duplex: "half",
  } as RequestInit);
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    res.write(chunk);
  }
  res.end();
}

export type RunningHttpServer = { url: URL; close(): Promise<void> };

/**
 * Servidor HTTP Node autónomo con el MCP en `path` (por defecto
 * `/mcp/creator`). `port: 0` elige un puerto libre. Útil para desarrollo y
 * tests; en producción el endpoint lo sirve la ruta de Next de `packages/web`.
 * `fallback` atiende el resto de rutas (p. ej. los endpoints OAuth de test);
 * sin él, 404.
 */
export async function startHttpServer(
  options: CreatorHttpOptions & {
    port?: number;
    host?: string;
    path?: string;
    fallback?: (request: Request, origin: string) => Promise<Response>;
  },
): Promise<RunningHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const path = options.path ?? MCP_ENDPOINT;
  let origin = "";
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = toWebRequest(req, origin);
        if (new URL(request.url).pathname !== path) {
          if (options.fallback) {
            await writeWebResponse(await options.fallback(request, origin), res);
            return;
          }
          res.statusCode = 404;
          res.end();
          return;
        }
        await writeWebResponse(await handleCreatorMcpRequest(request, options), res);
      } catch (error) {
        if (!res.headersSent) res.statusCode = 500;
        res.end(error instanceof Error ? error.message : String(error));
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  origin = `http://${host}:${port}`;
  return {
    url: new URL(path, origin),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
