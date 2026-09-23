import { z } from "zod";
import { appLink, previewPath } from "../links";
import { readDraftRoomPackage } from "../room-draft-reader";
import { textResult, ToolError } from "../results";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/**
 * Fase D — partida de prueba del draft (specs/10 §2): el MISMO playtest de 3.8
 * que el botón «Jugar» del editor. El draft se serializa aquí (misma
 * autorización: solo el autor) y Colyseus lo congela en una room temporal; el
 * agente recibe el link de prueba.
 */
export const previewTool = defineTool({
  name: "preview",
  title: "Previsualizar",
  description:
    "Crea una partida de prueba (playtest) con el estado actual del draft y devuelve su URL. La partida congela el draft: tras cambiarlo, vuelve a llamar a preview. El enlace caduca.",
  phase: "verification",
  ticket: "4.5",
  inputSchema: z.object({ roomId: RoomIdSchema }),
  annotations: READ_ONLY,
  async run({ roomId }, { actor, deps }) {
    if (!deps.playtests || !deps.appUrl) {
      throw new ToolError(
        "NOT_AVAILABLE",
        "el playtest no está configurado en este servidor. Pide al creador que pulse «Jugar» en el editor.",
      );
    }
    const room = await readDraftRoomPackage(deps, actor, roomId);
    let created;
    try {
      created = await deps.playtests.create({
        roomPackage: room,
        authorId: actor.userId,
        draftRoomId: roomId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((error as { code?: unknown } | null)?.code === "UNPLAYABLE") {
        throw new ToolError(
          "INVALID_DRAFT",
          `el servidor de partidas no puede jugar el draft: ${message}`,
        );
      }
      throw new ToolError(
        "NOT_AVAILABLE",
        `el servidor de partidas no está disponible: ${message}`,
      );
    }
    const url = appLink(deps.appUrl, room.meta.defaultLanguage, previewPath(created.token));
    const expiresAt = new Date(created.expiresAt).toISOString();
    return textResult(
      [
        `✅ preview — partida de prueba lista: ${url}`,
        `Caduca: ${expiresAt}. Congela el draft tal y como está ahora; si lo cambias, vuelve a llamar a preview.`,
        "Cualquiera con el enlace puede jugarla hasta que caduque: no se publica ni aparece en el catálogo.",
      ].join("\n"),
      { url, playtestId: created.playtestId, expiresAt },
    );
  },
});
