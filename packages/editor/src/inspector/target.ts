/**
 * Elemento que muestra el inspector (specs/09 §4.1): un objeto del lienzo, un
 * puzzle o una regla. La selección de objetos la lleva `EditToolController`
 * (3.1); la de puzzles y reglas la decide quien monta el inspector (lista del
 * propio inspector, grafo de reglas, panel del validador…).
 */
export const INSPECTOR_TARGET_KINDS = ["object", "puzzle", "rule"] as const;
export type InspectorTargetKind = (typeof INSPECTOR_TARGET_KINDS)[number];
export type InspectorTarget = { kind: InspectorTargetKind; id: string };

export type InspectorErrorCode =
  | "UNKNOWN_TARGET"
  | "INVALID_ID"
  | "DUPLICATE_ID"
  | "OUT_OF_BOUNDS"
  | "UNKNOWN_ROOM"
  | "READ_ONLY_FIELD"
  | "INVALID_JSON";

/** Error de dominio del inspector; la UI lo traduce por `code`. */
export class InspectorError extends Error {
  readonly code: InspectorErrorCode;
  constructor(code: InspectorErrorCode, message: string) {
    super(message);
    this.name = "InspectorError";
    this.code = code;
  }
}

export function sameTarget(
  a: InspectorTarget | null | undefined,
  b: InspectorTarget | null | undefined,
) {
  return a?.kind === b?.kind && a?.id === b?.id;
}
