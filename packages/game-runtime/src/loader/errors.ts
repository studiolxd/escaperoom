import type { ReadableIssue } from "@escaperoom/shared/schemas";

/**
 * Error de carga de un `RoomPackage`. Lleva el detalle de los campos inválidos
 * (`issues`) y un `message` legible de varias líneas con la ruta de cada campo,
 * para mostrarlo al creador o registrarlo en logs.
 */
export class RoomPackageLoadError extends Error {
  readonly issues: ReadableIssue[];

  constructor(message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "RoomPackageLoadError";
    this.issues = issues;
  }
}
