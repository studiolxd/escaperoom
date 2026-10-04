import type { Models3DCatalog } from "@escaperoom/shared/packs";
import type { RoomPackage } from "@escaperoom/shared/schemas";

/** Categoría de una pieza para filtrar: las del catálogo, `propio` (modelo de la sala) o `desconocido`. */
export type PieceCategory = Models3DCatalog["models"][string]["category"] | "propio" | "desconocido";

export type OmittedKind = { count: number; models: Record<string, number> };
export type OmittedPieces = Record<string, { suelo: OmittedKind; muro: OmittedKind }>;

/**
 * Categoría de un modelo: primero los propios de la sala (como `resolveModel3D`), después el
 * catálogo del pack; si no está en ninguno, `desconocido`.
 */
export function pieceCategory(
  model: string,
  catalog: Models3DCatalog | undefined,
  custom: Record<string, unknown> | undefined,
): PieceCategory {
  if (custom && Object.hasOwn(custom, model)) return "propio";
  if (catalog && Object.hasOwn(catalog.models, model)) return catalog.models[model]!.category;
  return "desconocido";
}

/**
 * Vista de `get_room` en una sala 3D: quita las piezas cuyo modelo es de categoría `suelo` o
 * `muro` del catálogo del pack (las de modelos propios y desconocidos se conservan) y cuenta lo
 * omitido por habitación y por modelo. Una sala sin `world3d` (2D) sale igual.
 */
export function splitFloorsAndWalls(
  pkg: RoomPackage,
  catalog: Models3DCatalog | undefined,
): { room: RoomPackage; omitted: OmittedPieces; omittedTotal: number } {
  const world3d = pkg.world3d;
  if (!world3d) return { room: pkg, omitted: {}, omittedTotal: 0 };

  const omitted: OmittedPieces = {};
  let omittedTotal = 0;
  const rooms: typeof world3d.rooms = {};
  for (const [subroomId, room] of Object.entries(world3d.rooms)) {
    const kept = [];
    for (const piece of room.pieces) {
      const category = pieceCategory(piece.model, catalog, world3d.models);
      if (category !== "suelo" && category !== "muro") {
        kept.push(piece);
        continue;
      }
      const entry = (omitted[subroomId] ??= {
        suelo: { count: 0, models: {} },
        muro: { count: 0, models: {} },
      });
      entry[category].count += 1;
      entry[category].models[piece.model] = (entry[category].models[piece.model] ?? 0) + 1;
      omittedTotal += 1;
    }
    rooms[subroomId] = { ...room, pieces: kept };
  }
  if (omittedTotal === 0) return { room: pkg, omitted: {}, omittedTotal: 0 };
  return { room: { ...pkg, world3d: { ...world3d, rooms } }, omitted, omittedTotal };
}

/** Nota del texto de `get_room` cuando se omiten suelos y muros. */
export function omittedNote(omitted: OmittedPieces, omittedTotal: number): string {
  const perRoom = Object.entries(omitted)
    .map(([id, o]) => `${id}: ${o.suelo.count} suelos, ${o.muro.count} muros`)
    .join("; ");
  return (
    `ℹ️ Omitidas ${omittedTotal} piezas de suelo y muro (por habitación: ${perRoom}). ` +
    'Para verlas: get_pieces({ roomId, subroomId, category: "suelo" | "muro" }) o get_room({ roomId, includeFloorsAndWalls: true }).'
  );
}
