import type { RoomPackage } from "@escaperoom/shared/schemas";
import type { Models3DCatalog } from "@escaperoom/shared/packs";
import { createRoomNavFor, type NavPoint } from "./nav";

export type ReachIssue =
  | { code: "spawn_off_navmesh"; spawnId: string }
  | { code: "object_unreachable"; objectId: string }
  | { code: "no_floor" };

/** Tolerancia con la que un objeto interactuable «toca» la navmesh (su propia huella la bloquea). */
const OBJECT_TOLERANCE = { plan: 1.5, height: 1.5 } as const;

/**
 * Avisos de alcance de una habitación para el editor (encargo 7.7): puntos de
 * aparición fuera de la zona transitable y objetos interactuables a los que no
 * se puede llegar. `no_floor` si la navmesh está vacía (y nada más).
 * Requiere `initNav3D()`. Destruye la navmesh antes de devolver.
 */
export function checkRoomReach(
  pkg: RoomPackage,
  roomId: string,
  catalog: Models3DCatalog | undefined,
): ReachIssue[] {
  const nav = createRoomNavFor(pkg, roomId, catalog);
  try {
    if (nav.empty) return [{ code: "no_floor" }];
    const issues: ReachIssue[] = [];
    const room = pkg.map.rooms.find((r) => r.id === roomId);
    const spawns = room?.spawnPoints ?? [];

    let origin: NavPoint | null = null;
    for (const spawn of spawns) {
      const snapped = nav.closest({ x: spawn.x, y: spawn.y, h: spawn.h ?? 0 });
      if (!snapped) issues.push({ code: "spawn_off_navmesh", spawnId: spawn.id });
      else origin ??= snapped;
    }

    for (const object of pkg.objects) {
      if (object.roomId !== roomId || !object.interactable || !object.transform) continue;
      const { x, y, h } = object.transform;
      const target = nav.closest({ x, y, h }, OBJECT_TOLERANCE);
      // Sin ningún spawn válido no hay desde dónde medir: el aviso del spawn ya lo cubre.
      const reachable = target !== null && (origin === null || nav.path(origin, target) !== null);
      if (!reachable) issues.push({ code: "object_unreachable", objectId: object.id });
    }
    return issues;
  } finally {
    nav.destroy();
  }
}
