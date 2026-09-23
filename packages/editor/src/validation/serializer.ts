import {
  safeParseRoomPackage,
  toReadableIssues,
  type RoomPackage,
} from "@escaperoom/shared/schemas";
import type * as Y from "yjs";
import { readRules } from "../rules-graph/yjs-rules";

/**
 * Doc Yjs → `RoomPackage` (specs/09 §2). La serialización real es de 3.1; el
 * validador del editor la recibe inyectada para no acoplarse a su forma: basta
 * con una función que devuelva el paquete (o su JSON crudo) a partir del doc.
 * El resultado siempre se valida con el esquema Zod antes de usarse, así que
 * un doc a medio editar produce errores de contrato en vez de romper.
 */
export type RoomPackageSerializer = (doc: Y.Doc) => unknown;

/** Error de contrato: el doc aún no forma un `RoomPackage` válido. */
export type DocConversionError = { path: string; message: string };

export type DocConversionResult =
  { ok: true; pkg: RoomPackage } | { ok: false; errors: DocConversionError[] };

/** Serializa y valida el contrato; nunca lanza. */
export function docToRoomPackage(
  doc: Y.Doc,
  serialize: RoomPackageSerializer,
): DocConversionResult {
  let raw: unknown;
  try {
    raw = serialize(doc);
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: "", message: err instanceof Error ? err.message : String(err) }],
    };
  }
  const parsed = safeParseRoomPackage(raw);
  if (!parsed.success) return { ok: false, errors: toReadableIssues(parsed.error) };
  return { ok: true, pkg: parsed.data };
}

/**
 * Adaptador provisional hasta que 3.1 publique la serialización completa: un
 * paquete base con las reglas leídas del mapa `rules` del doc (3.6). Lo usan
 * la demo de desarrollo y los tests; el resto de secciones no se edita aún en
 * el doc, así que salen tal cual del paquete base.
 */
export function createRulesOverlaySerializer(base: RoomPackage): RoomPackageSerializer {
  return (doc) => ({ ...base, rules: readRules(doc) });
}
