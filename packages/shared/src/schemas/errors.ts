import { z } from "zod";

type Issue = z.ZodError["issues"][number];

export interface ReadableIssue {
  /** Ruta del campo, p. ej. `puzzles.0.recipes.0.output`; `""` = raíz. */
  path: string;
  /** Mensaje de Zod, en una línea. */
  message: string;
}

function hasUnionErrors(issue: Issue): issue is Issue & { errors: Issue[][] } {
  return (
    issue.code === "invalid_union" &&
    "errors" in issue &&
    Array.isArray((issue as { errors?: unknown }).errors)
  );
}

function collect(issues: readonly Issue[], prefix: string, out: ReadableIssue[]): void {
  for (const issue of issues) {
    const path = [...prefix.split(".").filter(Boolean), ...issue.path.map(String)].join(".");
    if (hasUnionErrors(issue)) {
      out.push({
        path,
        message: "no coincide con ninguna de las variantes válidas de esta plantilla",
      });
      for (const alternative of issue.errors) {
        collect(alternative, path, out);
      }
    } else {
      out.push({ path, message: issue.message });
    }
  }
}

/**
 * Convierte los `issues` de Zod en una lista de `{ path, message }` con rutas de
 * campo claras y sin anidar, apta para mostrar al creador o registrar en logs.
 */
export function toReadableIssues(error: z.ZodError): ReadableIssue[] {
  const out: ReadableIssue[] = [];
  collect(error.issues, "", out);
  return out;
}

/**
 * Formatea un `ZodError` como texto legible de varias líneas, con la ruta del
 * campo delante de cada mensaje (p. ej. `meta.title: Too small: ...`).
 */
export function formatZodIssues(error: z.ZodError): string {
  return toReadableIssues(error)
    .map((issue) => `${issue.path || "(raíz)"}: ${issue.message}`)
    .join("\n");
}

/** Alias semántico para errores de validación de un `RoomPackage`. */
export function formatRoomPackageError(error: z.ZodError): string {
  return formatZodIssues(error);
}
