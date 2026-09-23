import { randomUUID } from "node:crypto";

/**
 * Id de ESTE proceso para la propagación del draft entre procesos
 * `editor-sync` (specs/09 §2, decisión 2026-09-23): lo usa
 * `getRoomDraftService()` al publicar (`@escaperoom/kit/room-sync`) y
 * `createWebEditorSyncServer` al suscribirse, para que un proceso ignore su
 * propio eco en vez de reaplicarlo. Un valor por proceso (no por sala):
 * memoizado a nivel de módulo, igual que los singletons de `services.ts`.
 */
let originId: string | undefined;

export function getEditorSyncOriginId(): string {
  originId ??= randomUUID();
  return originId;
}
