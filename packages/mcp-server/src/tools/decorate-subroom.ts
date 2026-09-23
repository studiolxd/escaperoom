import { setDecorations, setLighting } from "@escaperoom/editor/room-doc";
import { DecorationSchema, LightConfigSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { ToolError } from "../results";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/**
 * Fase B — decoración e iluminación de una habitación interna
 * (`SubRoom.decorations` / `SubRoom.lighting`, specs/08 §2.1, specs/04 §3.3–3.4).
 * Es la contrapartida de las herramientas «Decorar» y «Antorcha» y del panel
 * de la sala del editor: mismos comandos de `room-doc` (`setDecorations`,
 * `setLighting`), declarativa (cada lista que se envía sustituye a la que
 * había, en ese orden) para que el agente no tenga que razonar con índices.
 *
 * Va en la fase de contenido y no en `define_subrooms` porque una antorcha
 * puede estar gobernada por un objeto (`objectId`), que tiene que existir ya.
 */
export const decorateSubroomTool = defineTool({
  name: "decorate_subroom",
  title: "Decorar habitación",
  description:
    "Fija la decoración y/o la iluminación de una habitación interna. `decorations` son sprites del pack sin interacción (tapices, barriles, columnas…) en celdas de la habitación; `lighting` combina antorchas ({type: 'torch', x, y, objectId?}: con `objectId` se encienden/apagan según el estado de ese objeto, que debe existir) y luz ambiente ({type: 'ambient', color: '#rrggbb', intensity: 0–1}). Cada lista que se envía SUSTITUYE a la actual (en ese orden); la que se omite no se toca. `[]` la vacía.",
  phase: "content",
  ticket: "4.8",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    subroomId: z.string().min(1).describe("Id de la habitación interna (SubRoom) a decorar"),
    decorations: z
      .array(DecorationSchema)
      .optional()
      .describe("Lista completa de decoraciones de la habitación (sustituye la actual)"),
    lighting: z
      .array(LightConfigSchema)
      .optional()
      .describe("Lista completa de luces de la habitación (sustituye la actual)"),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, subroomId, decorations, lighting, dryRun }, { actor, deps }) {
    if (!decorations && !lighting) {
      throw new ToolError(
        "INVALID_INPUT",
        "indica `decorations`, `lighting` o ambas (la lista que se omite no se toca)",
      );
    }
    const outcome = await mutateDraft(
      { actor, deps, tool: "decorate_subroom", dryRun },
      roomId,
      (doc) => {
        if (decorations) setDecorations(doc, subroomId, decorations);
        if (lighting) setLighting(doc, subroomId, lighting);
      },
    );
    const torches = lighting?.filter((light) => light.type === "torch").length ?? 0;
    const ambient = lighting?.find((light) => light.type === "ambient");
    const parts = [
      decorations ? `${decorations.length} decoración(es)` : "",
      lighting
        ? `${torches} antorcha(s)${ambient ? `, ambiente ${ambient.color} al ${ambient.intensity}` : ", sin ambiente"}`
        : "",
    ].filter(Boolean);
    return mutationResult(outcome, `✅ decorate_subroom — "${subroomId}": ${parts.join("; ")}`, {
      roomId,
      subroomId,
      ...(decorations ? { decorations: decorations.length } : {}),
      ...(lighting ? { lights: lighting.length } : {}),
    });
  },
});
