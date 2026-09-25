import { existsSync } from "node:fs";
import {
  DEFAULT_EDITOR_SYNC_PORT,
  allowedOriginsFromEnv,
  createWebEditorSyncServer,
} from "./server";

/**
 * Punto de entrada del WebSocket de edición (specs/09 §2, ticket 3.3):
 * `pnpm dev:editor-sync` (o `pnpm --filter @escaperoom/web editor-sync`).
 *
 * Proceso propio junto a Next porque los route handlers de Next no admiten
 * `upgrade` de WebSocket; vive en `web` para reutilizar sin duplicar la sesión
 * de Better Auth y el `RoomDraftService` de las rutas REST.
 */
function loadLocalEnv(): void {
  for (const file of ["../shared/.env", ".env", ".env.local"]) {
    const path = `${process.cwd()}/${file}`;
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

loadLocalEnv();
// Import dinámico: `auth` y Prisma leen el entorno al cargarse.
const { resolveActorFromRequest } = await import("../context");
const { getRoomDraftService } = await import("../services");

const port = Number(process.env.EDITOR_SYNC_PORT ?? DEFAULT_EDITOR_SYNC_PORT);
const server = createWebEditorSyncServer({
  drafts: getRoomDraftService(),
  resolveActorFromRequest,
  allowedOrigins: allowedOriginsFromEnv(process.env),
  // C-10: en producción sin `EDITOR_SYNC_ALLOWED_ORIGINS`/`NEXT_PUBLIC_APP_URL`
  // configuradas, fallar cerrado en vez de aceptar cualquier `Origin`.
  strictOriginWithoutAllowlist: process.env.NODE_ENV === "production",
});
const { port: listening } = await server.listen(port);
console.log(`[editor-sync] WebSocket de edición en ws://localhost:${listening}/rooms/:roomId`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
