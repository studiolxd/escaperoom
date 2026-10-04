import { useMemo, useRef } from "react";
import type { useTranslations } from "next-intl";
import type { ToolError } from "@escaperoom/editor";
import { toRuntimeModel, type RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomPackage } from "@escaperoom/shared/schemas";

/** Piezas comunes de los espacios de trabajo 2D y 3D del editor. */

/** Botón secundario legible sobre el fondo oscuro del editor. */
export const QUIET_BUTTON = "border border-white/15 text-white hover:bg-white/10";

/** Estado de la conexión que muestra la cabecera. */
export type RoomEditorStatus = "local" | "connecting" | "connected" | "offline";

/** Pestañas del área central (specs/09 §4.1): lienzo WYSIWYG o grafo de reglas. */
export const CANVAS_TABS = ["map", "rules"] as const;
export type CanvasTab = (typeof CANVAS_TABS)[number];

/** Último `RuntimeModel` válido del paquete: un estado intermedio inválido no vacía el lienzo. */
export function useRuntimeModel(pkg: RoomPackage, locale: string) {
  const lastValid = useRef<RuntimeModel | null>(null);
  return useMemo(() => {
    try {
      const model = toRuntimeModel(pkg, { locale });
      lastValid.current = model;
      return { model, error: undefined };
    } catch (error) {
      return {
        model: lastValid.current,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [pkg, locale]);
}

export type EditorTranslator = ReturnType<typeof useTranslations<"RoomEditor">>;

const ERROR_CODES = [
  "UNKNOWN_ROOM",
  "UNKNOWN_OBJECT",
  "OUT_OF_BOUNDS",
  "DUPLICATE_ID",
  "INVALID_ID",
  "REFERENCED_ID",
  "UNKNOWN_DECORATION",
  "UNKNOWN_LIGHT",
  "INVALID_VALUE",
  "WRONG_DIMENSION",
  "UNKNOWN_PIECE",
] as const;

export function errorText(t: EditorTranslator, error: ToolError): string {
  return (ERROR_CODES as readonly string[]).includes(error.code)
    ? t(`errors.${error.code as (typeof ERROR_CODES)[number]}`)
    : error.message;
}
