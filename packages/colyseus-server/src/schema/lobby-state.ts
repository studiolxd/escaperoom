import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Mensaje de chat sincronizado (specs/11 §3, §6), compartido por `GameRoom`
 * (`chat.ts`, `schema/game-state.ts`). Refleja el esquema Zod de
 * `@escaperoom/shared/chat`; el texto que llega aquí ya está desinfectado y, si
 * tocaba, censurado.
 *
 * Se define con el builder `schema()` / `t.*` (sin decoradores) para no exigir
 * `experimentalDecorators` ni configuración especial del toolchain.
 */
export const ChatMessageState = schema(
  {
    id: t.string(),
    authorId: t.string(),
    authorName: t.string(),
    text: t.string(),
    ts: t.number(),
    filtered: t.boolean(),
  },
  "ChatMessageState",
);

export type ChatMessageState = SchemaType<typeof ChatMessageState>;
