import { z } from "zod";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { isAnonymous, type Actor } from "./actor";

/**
 * Piezas comunes de los servicios de administración de plataforma (specs/13
 * §10): guard `isAdmin` y error de dominio. El flag `user.isAdmin` no viaja en
 * el `Actor` (ADR-022): se consulta en cada llamada, de modo que retirar el
 * permiso tiene efecto inmediato aunque la sesión siga viva.
 */

export type AdminErrorCode =
  "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "CONFLICT";

/** Error de dominio de admin; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class AdminError extends Error {
  readonly code: AdminErrorCode;
  /** Detalle por campo cuando `code === "VALIDATION_ERROR"`. */
  readonly issues: ReadableIssue[];
  constructor(code: AdminErrorCode, message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "AdminError";
    this.code = code;
    this.issues = issues;
  }
}

/** Puerto mínimo para saber si un usuario es administrador de plataforma. */
export interface AdminDirectory {
  isAdmin(userId: string): Promise<boolean>;
}

/** Sin sesión → `UNAUTHORIZED`; con sesión pero sin `isAdmin` → `FORBIDDEN`. */
export async function requireAdmin(actor: Actor, directory: AdminDirectory): Promise<void> {
  if (isAnonymous(actor)) throw new AdminError("UNAUTHORIZED", "No hay sesión");
  if (!(await directory.isAdmin(actor.userId))) {
    throw new AdminError("FORBIDDEN", "Solo administradores de plataforma");
  }
}

/** Valida `input` con `schema` o lanza `VALIDATION_ERROR` con el detalle de Zod. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AdminError("VALIDATION_ERROR", "Datos no válidos", toReadableIssues(parsed.error));
  }
  return parsed.data;
}

/** Directorio en memoria (tests y superficies sin base de datos). */
export function createInMemoryAdminDirectory(adminIds: Iterable<string> = []): AdminDirectory {
  const admins = new Set(adminIds);
  return {
    async isAdmin(userId) {
      return admins.has(userId);
    },
  };
}
