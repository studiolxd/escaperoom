/**
 * Editor de salas (Fase 3). Este punto de entrada es seguro para el navegador:
 * el servidor del WebSocket de edición (Node) se importa desde
 * `@escaperoom/editor/sync-server`.
 */
export const EDITOR_MODE = { draft: "draft", published: "published" } as const;
export type EditorMode = (typeof EDITOR_MODE)[keyof typeof EDITOR_MODE];

export * from "./sync/protocol";
export * from "./sync/provider";
export * from "./i18n-fields";
export * from "./rules-graph";
