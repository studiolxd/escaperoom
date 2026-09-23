import { RoomPackageMetaSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION } from "./define";

/** Fase A — crea el draft de una sala nueva (specs/10 §2). */
export const createRoomTool = defineTool({
  name: "create_room",
  title: "Crear sala",
  description:
    "Crea un draft de sala nuevo con su metadata: título, tema, idiomas, dificultad (1–3) y nº de jugadores. Devuelve el id del draft.",
  phase: "structure",
  ticket: "4.2",
  inputSchema: z.object({
    meta: RoomPackageMetaSchema.pick({
      title: true,
      theme: true,
      languages: true,
      defaultLanguage: true,
      difficulty: true,
      players: true,
    }).extend({
      description: RoomPackageMetaSchema.shape.description.optional(),
      estimatedMinutes: RoomPackageMetaSchema.shape.estimatedMinutes.optional(),
    }),
  }),
  annotations: MUTATION,
});
