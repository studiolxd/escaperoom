/**
 * URL base del WebSocket de edición (ticket 3.3) para el proveedor del editor
 * (`EditorSyncProvider` de `@escaperoom/editor`). Viene de
 * `NEXT_PUBLIC_EDITOR_SYNC_URL` (se inlinea en el bundle) con
 * `ws://localhost:2568` por defecto.
 */
export const EDITOR_SYNC_URL = process.env.NEXT_PUBLIC_EDITOR_SYNC_URL ?? "ws://localhost:2568";
