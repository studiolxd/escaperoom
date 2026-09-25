import type { IncomingMessage } from "node:http";
import {
  createEditorSyncServer,
  type EditorSyncServer,
  type EditorSyncServerOptions,
} from "@escaperoom/editor/sync-server";
import { subscribeDraftUpdates } from "@escaperoom/kit/room-sync";
import type { Actor, RoomDraftService } from "@escaperoom/shared/services";
import { getEditorSyncOriginId } from "../room-sync";

/** Puerto por defecto del WebSocket de edición (Colyseus usa 2567). */
export const DEFAULT_EDITOR_SYNC_PORT = 2568;

/**
 * Convierte la petición de upgrade de Node en un `Request` web para reutilizar
 * EXACTAMENTE la resolución de sesión de las rutas REST
 * (`resolveActorFromRequest`: cookie de Better Auth o `Authorization: Bearer`).
 */
export function upgradeRequestToRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const host = request.headers.host ?? "localhost";
  return new Request(new URL(request.url ?? "/", `http://${host}`), { headers });
}

/** Lista de orígenes permitidos: `EDITOR_SYNC_ALLOWED_ORIGINS` (CSV) o el de la app. */
export function allowedOriginsFromEnv(
  env: Record<string, string | undefined>,
): string[] | undefined {
  const raw = env.EDITOR_SYNC_ALLOWED_ORIGINS ?? env.NEXT_PUBLIC_APP_URL ?? env.APP_URL;
  if (!raw) return undefined;
  const origins = raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return origins.length > 0 ? origins : undefined;
}

/**
 * Servidor del WebSocket de edición con las dependencias de la app web: el
 * MISMO `RoomDraftService` (persistencia de 3.2) y la MISMA resolución de
 * actor que `/api/rooms/:roomId/{draft,update,history}`.
 */
export function createWebEditorSyncServer(deps: {
  drafts: RoomDraftService;
  resolveActorFromRequest: (request: Request) => Promise<Actor>;
  allowedOrigins?: readonly string[];
  /** C-10: `true` en producción — sin `allowedOrigins`, falla cerrado en vez de aceptar cualquier `Origin`. */
  strictOriginWithoutAllowlist?: boolean;
  logger?: EditorSyncServerOptions["logger"];
}): EditorSyncServer {
  return createEditorSyncServer({
    drafts: deps.drafts,
    resolveActor: (request) => deps.resolveActorFromRequest(upgradeRequestToRequest(request)),
    allowedOrigins: deps.allowedOrigins,
    strictOriginWithoutAllowlist: deps.strictOriginWithoutAllowlist,
    logger: deps.logger,
    // Sincronización entre procesos (specs/09 §2, decisión 2026-09-23):
    // updates persistidos por OTRO proceso (otra instancia de `editor-sync`
    // al escalar, o un REST/MCP sin sesión viva aquí) llegan por Redis y se
    // aplican al doc en memoria de este proceso si tiene la sala cargada. Sin
    // `REDIS_URL`, `subscribeDraftUpdates` es un no-op: este proceso sigue
    // sirviendo a sus propios clientes, solo pierde la propagación cruzada.
    remoteUpdates: { subscribe: subscribeDraftUpdates, originId: getEditorSyncOriginId() },
  });
}
