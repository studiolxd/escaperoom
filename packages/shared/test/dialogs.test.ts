import { describe, expect, it } from "vitest";
import { DialogDefSchema, type DialogDef } from "../src/schemas";
import {
  dialogMatches,
  findDialog,
  isDialogConditioned,
  resolveDialog,
  resolveDialogById,
} from "../src/hints";

const DIALOGS: DialogDef[] = [
  DialogDefSchema.parse({
    id: "d-intro",
    text: { es: { text: "Tenéis 60 minutos." }, en: { text: "You have 60 minutes." } },
  }),
  DialogDefSchema.parse({
    id: "d-brasero",
    text: { es: { text: "El brasero arde.", audioUrl: "audio/d-brasero-es.mp3" } },
    conditions: [{ type: "flag_is", flag: "brasero_encendido", value: true }],
  }),
  DialogDefSchema.parse({
    id: "d-solo-pt",
    text: { pt: { text: "Só em português." } },
  }),
];

describe("dialogs · resolución por idioma", () => {
  it("resuelve el texto al idioma pedido", () => {
    const dialog = resolveDialog(DIALOGS[0]!, "en");
    expect(dialog.id).toBe("d-intro");
    expect(dialog.text).toBe("You have 60 minutes.");
    expect(dialog.locale).toBe("en");
  });

  it("cae al idioma de respaldo `es` cuando falta la traducción", () => {
    const dialog = resolveDialog(DIALOGS[0]!, "fr");
    expect(dialog.text).toBe("Tenéis 60 minutos.");
    expect(dialog.locale).toBe("es");
  });

  it("cae a la primera entrada disponible si no hay idioma ni respaldo", () => {
    const dialog = resolveDialog(DIALOGS[2]!, "de");
    expect(dialog.text).toBe("Só em português.");
    expect(dialog.locale).toBe("pt");
  });

  it("conserva el audioUrl del idioma resuelto", () => {
    const dialog = resolveDialog(DIALOGS[1]!, "es");
    expect(dialog.audioUrl).toBe("audio/d-brasero-es.mp3");
  });

  it("conserva las condiciones si el diálogo las declara", () => {
    const dialog = resolveDialog(DIALOGS[1]!, "es");
    expect(isDialogConditioned(DIALOGS[1]!)).toBe(true);
    expect(isDialogConditioned(DIALOGS[0]!)).toBe(false);
    expect(dialog.conditions).toEqual([
      { type: "flag_is", flag: "brasero_encendido", value: true },
    ]);
  });
});

describe("dialogs · catálogo y condiciones (dialog_show)", () => {
  it("busca y resuelve un diálogo por id", () => {
    expect(findDialog(DIALOGS, "d-intro")?.id).toBe("d-intro");
    expect(findDialog(DIALOGS, "d-fantasma")).toBeUndefined();

    const resolved = resolveDialogById(DIALOGS, "d-intro", "en");
    expect(resolved?.text).toBe("You have 60 minutes.");

    expect(resolveDialogById(DIALOGS, "d-fantasma", "es")).toBeUndefined();
  });

  it("delega la evaluación de condiciones en el predicado del host", () => {
    const conditioned = DIALOGS[1]!;
    expect(dialogMatches(conditioned, () => true)).toBe(true);
    expect(dialogMatches(conditioned, () => false)).toBe(false);
    expect(dialogMatches(DIALOGS[0]!, () => false)).toBe(true);
  });
});
