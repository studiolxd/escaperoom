import type { IncomingMessage } from "node:http";
import {
  ANONYMOUS_ACTOR,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  allowedOriginsFromEnv,
  createWebEditorSyncServer,
  upgradeRequestToRequest,
} from "../src/server/editor-sync/server";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

/**
 * Resolución de actor de prueba con la MISMA firma que la de las rutas REST
 * (`Request` → `Actor`): la "sesión" es una cookie.
 */
async function resolveActorFromCookie(request: Request): Promise<Actor> {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.includes("session=autora") ? author : ANONYMOUS_ACTOR;
}

function handshakeStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers });
    socket.on("open", () => {
      socket.close();
      resolve(101);
    });
    socket.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0);
      socket.terminate();
    });
    socket.on("error", () => undefined);
  });
}

describe("editor-sync en web", () => {
  it("el handshake usa la sesión de la petición (cookie) y el permiso del draft", async () => {
    const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
    const server = createWebEditorSyncServer({
      drafts: createRoomDraftService({ store }),
      resolveActorFromRequest: resolveActorFromCookie,
      allowedOrigins: ["http://localhost:3000"],
      logger: { warn: () => undefined, error: () => undefined },
    });
    const { port } = await server.listen(0, "127.0.0.1");
    closers.push(() => server.close());
    const url = `ws://127.0.0.1:${port}/rooms/${ROOM_ID}`;

    expect(await handshakeStatus(url, { cookie: "session=autora" })).toBe(101);
    expect(await handshakeStatus(url, { cookie: "session=otra" })).toBe(401);
    expect(
      await handshakeStatus(url, { cookie: "session=autora", origin: "https://evil.test" }),
    ).toBe(403);
  });

  it("convierte la petición de upgrade en un Request con todas las cabeceras", () => {
    const request = upgradeRequestToRequest({
      url: `/rooms/${ROOM_ID}`,
      headers: { host: "sync.local:2568", cookie: "a=1; b=2", "x-multi": ["1", "2"] },
    } as unknown as IncomingMessage);
    expect(request.url).toBe(`http://sync.local:2568/rooms/${ROOM_ID}`);
    expect(request.headers.get("cookie")).toBe("a=1; b=2");
    expect(request.headers.get("x-multi")).toBe("1, 2");
  });

  it("orígenes permitidos desde el entorno", () => {
    expect(
      allowedOriginsFromEnv({ EDITOR_SYNC_ALLOWED_ORIGINS: "https://a.test/, https://b.test" }),
    ).toEqual(["https://a.test", "https://b.test"]);
    expect(allowedOriginsFromEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toEqual([
      "http://localhost:3000",
    ]);
    expect(allowedOriginsFromEnv({})).toBeUndefined();
  });
});
