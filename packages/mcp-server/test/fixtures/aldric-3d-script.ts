import type { RoomPackage } from "@escaperoom/shared/schemas";
import { aldricScript, type ScriptStep } from "./aldric-script";

/**
 * Guion del test de paridad 3D (encargo 7.10b, specs/27 §11): la secuencia de llamadas que haría
 * un agente para construir «La Maldición del Rey Aldric» en 3D ENTERA solo con el toolset del MCP,
 * a partir del fixture `docs/reference/roompackage-rey-aldric-3d.v1.json`.
 *
 * Parte del guion 2D (`aldric-script.ts`): mismo orden y mismas herramientas para ítems, puzles,
 * diálogos, pistas, reglas y objetos (`add_object` con `transform`). Solo cambia la estructura:
 * en lugar de `set_map` con capas, `paint_tiles` y la decoración de `decorate_subroom`, el 3D usa
 * `define_subrooms` (metros), `set_map` solo con el tileset, `place_pieces` (en lotes de hasta
 * `PIECES_PER_CALL`) y `set_spawn_points`. Las antorchas siguen yendo con `decorate_subroom`
 * (`lighting`, con `h`).
 */

/** Tope de piezas por llamada de `place_pieces`. */
export const PIECES_PER_CALL = 500;

export function aldric3dScript(pkg: RoomPackage): {
  createRoom: ScriptStep;
  steps: (roomId: string) => ScriptStep[];
} {
  const base = aldricScript(pkg);
  const createRoom: ScriptStep = {
    ...base.createRoom,
    args: { meta: { ...(base.createRoom.args.meta as Record<string, unknown>), dimension: "3d" } },
  };

  const steps = (roomId: string): ScriptStep[] => {
    const structure: ScriptStep[] = [];
    const push = (tool: string, label: string, args: Record<string, unknown>) =>
      structure.push({ tool, label, args: { roomId, ...args } });

    push("define_subrooms", "habitaciones", {
      subrooms: pkg.map.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        bounds: { x: 0, y: 0, w: room.grid.cols, h: room.grid.rows },
      })),
    });
    push("set_map", "tileset", { tileset: pkg.map.tileset });
    for (const room of pkg.map.rooms) {
      // El MCP genera los ids de las piezas: se envían sin `id`.
      const pieces = (pkg.world3d?.rooms[room.id]?.pieces ?? []).map((piece) => {
        const { id, ...rest } = piece;
        void id;
        return rest;
      });
      for (let from = 0; from < pieces.length; from += PIECES_PER_CALL) {
        push("place_pieces", `piezas ${room.id} ${from}-${from + PIECES_PER_CALL}`, {
          subroomId: room.id,
          pieces: pieces.slice(from, from + PIECES_PER_CALL),
        });
      }
      push("set_spawn_points", `aparición ${room.id}`, {
        subroomId: room.id,
        spawnPoints: structuredClone(room.spawnPoints),
      });
    }

    // Resto del guion 2D, sin su fase de estructura (define_subrooms, set_map, paint_tiles) y con
    // la decoración de `decorate_subroom` fuera (en 3D la decoración son piezas): solo las luces.
    const content = base
      .steps(roomId)
      .filter((step) => !["define_subrooms", "set_map", "paint_tiles"].includes(step.tool))
      .map((step) => {
        if (step.tool !== "decorate_subroom") return step;
        const args = { ...step.args };
        delete args.decorations;
        return { ...step, args };
      });
    return [...structure, ...content];
  };

  return { createRoom, steps };
}
