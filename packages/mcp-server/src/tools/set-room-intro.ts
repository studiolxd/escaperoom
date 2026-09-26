import { setRoomIntro } from "@escaperoom/editor/room-doc";
import {
  LocalizedTextSchema,
  MAX_INTRO_TEXT_LENGTH,
  isLanguageCode,
} from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/** Referencia de medio de un borrador, tal y como la devuelve `upload` (`media:<uuid>`). */
const MediaRefSchema = z
  .string()
  .regex(
    /^media:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "debe ser una referencia `media:<uuid>` devuelta por la tool upload",
  );

const IntroInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: LocalizedTextSchema.describe(
      `Texto por idioma declarado de la sala ({ es: { text }, en: { text } }), hasta ${MAX_INTRO_TEXT_LENGTH} caracteres cada uno`,
    ),
  }),
  z.object({
    type: z.literal("video"),
    video: MediaRefSchema.describe(
      'Ref del vídeo (mp4/webm) devuelta por upload con kind "intro_video"',
    ),
    subtitles: z
      .record(z.string().refine(isLanguageCode, "Código de idioma inválido"), MediaRefSchema)
      .optional()
      .describe(
        'Subtítulos WebVTT opcionales por idioma declarado: { es: "media:<uuid>" } (refs de upload con kind "intro_subtitles")',
      ),
  }),
]);

/**
 * Introducción de la sala (`meta.intro`, encargo lobby-diseño, specs/04 §10):
 * texto multiidioma o vídeo con subtítulos, que cada jugador ve tras «Empezar»
 * y antes de su cuenta atrás 3-2-1. Los binarios se suben antes con `upload`
 * (`kind: "intro_video"` / `"intro_subtitles"`); aquí solo se guardan sus
 * referencias. Usa el mismo comando que el editor (`setRoomIntro`).
 */
export const setRoomIntroTool = defineTool({
  name: "set_room_intro",
  title: "Fijar introducción de la sala",
  description:
    'Fija la introducción que cada jugador ve antes de la cuenta atrás 3-2-1 (se cierra cuando quiere, no se puede volver a ver): `{type: "text", text: {es: {text}}}` (idiomas declarados de la sala) o `{type: "video", video: "media:<uuid>", subtitles?: {es: "media:<uuid>"}}` con las refs que devuelve upload (kind "intro_video" / "intro_subtitles"). `null` quita la introducción. Sustituye la anterior entera.',
  phase: "structure",
  ticket: "lobby-diseño",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    intro: IntroInputSchema.nullable().describe("Introducción nueva, o null para quitarla"),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, intro, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft(
      { actor, deps, tool: "set_room_intro", dryRun },
      roomId,
      (doc) => setRoomIntro(doc, intro),
    );
    const detail =
      intro === null
        ? "sin introducción"
        : intro.type === "text"
          ? `texto (${Object.keys(intro.text).join(", ")})`
          : `vídeo${intro.subtitles && Object.keys(intro.subtitles).length > 0 ? ` con subtítulos (${Object.keys(intro.subtitles).join(", ")})` : ""}`;
    return mutationResult(outcome, `✅ set_room_intro — introducción: ${detail}`, {
      roomId,
      intro,
    });
  },
});
