/**
 * UI del editor. Placeholder del ticket 0.1: el editor visual es la Fase 3.
 */
export const EDITOR_MODE = { draft: "draft", published: "published" } as const;
export type EditorMode = (typeof EDITOR_MODE)[keyof typeof EDITOR_MODE];
