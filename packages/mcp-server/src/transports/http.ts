import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { Actor } from "@escaperoom/shared/services";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { hasIdentity, unauthorizedResponse, type HttpAuthenticator } from "../auth";
import type { CreatorMcpDeps } from "../deps";
import { createCreatorMcpServer, MCP_ENDPOINT } from "../server";

export type CreatorHttpOptions = {
  /** Resuelve el actor de la petición (hoy sesión de Better Auth; en 4.7, OAuth). */
  authenticate: HttpAuthenticator;
  /** Servicios de dominio para el actor ya identificado. */
  createDeps: (actor: Actor) => Omit<CreatorMcpDeps, "actor">;
};

/**
 * Maneja una petición del MCP por HTTP streamable (sin estado: un servidor por
 * petición, respuestas JSON). Sin identidad responde 401 antes de tocar el
 * protocolo. La usan la ruta de Next `/mcp/creator` y `startHttpServer`.
 */
export async function handleCreatorMcpRequest(
  request: Request,
  options: CreatorHttpOptions,
): Promise<Response> {
  const actor = await options.authenticate(request);
  if (!hasIdentity(actor)) return unauthorizedResponse();
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
 */
export async function startHttpServer(
  options: CreatorHttpOptions & { port?: number; host?: string; path?: string },
): Promise<RunningHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const path = options.path ?? MCP_ENDPOINT;
  let origin = "";
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = toWebRequest(req, origin);
        if (new URL(request.url).pathname !== path) {
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
