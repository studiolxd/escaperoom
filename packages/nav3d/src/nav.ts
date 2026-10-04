import { getNavMeshPositionsAndIndices, init, NavMeshQuery, type NavMesh } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import type { Models3DCatalog } from "@escaperoom/shared/packs";
import { NAV3D, recastConfig } from "./config";
import { buildNavInput, type NavInput } from "./input";

/** Coordenadas lógicas (specs/27 §2); recast usa `X = x`, `Y = h`, `Z = y`. */
export interface NavPoint {
  x: number;
  y: number;
  h: number;
}

export interface RoomNav {
  /** Punto de la navmesh más cercano dentro de la tolerancia, o `null`. */
  closest(p: NavPoint, tol?: { plan: number; height: number }): NavPoint | null;
  /** Ruta de `from` a `to` (ambos se ajustan antes a la navmesh). `null` si no hay. */
  path(from: NavPoint, to: NavPoint): NavPoint[] | null;
  /** Avanza de `from` hacia `to` deslizándose por los bordes; devuelve dónde acaba. */
  slide(from: NavPoint, to: NavPoint): NavPoint;
  /** `true` si la navmesh no tiene ningún polígono. */
  readonly empty: boolean;
  /** Triángulos de la navmesh para dibujarla (depuración); coordenadas Three (X, Y, Z) = (x, h, y). */
  debugGeometry(): { positions: Float32Array; indices: Uint32Array };
  destroy(): void;
}

type RecastPoint = { x: number; y: number; z: number };

const toRecast = (p: NavPoint): RecastPoint => ({ x: p.x, y: p.h, z: p.y });
const fromRecast = (p: RecastPoint): NavPoint => ({ x: p.x, y: p.z, h: p.y });

/** Distancia máxima entre el final de la ruta y el destino ajustado para darla por completa. */
const PATH_END_EPSILON = 0.05;

let initPromise: Promise<void> | undefined;

/** Inicializa recast (WASM). Idempotente: llamadas repetidas comparten la misma promesa. */
export function initNav3D(): Promise<void> {
  initPromise ??= init().then(() => undefined);
  return initPromise;
}

const EMPTY_NAV: RoomNav = {
  empty: true,
  closest: () => null,
  path: () => null,
  slide: (from) => from,
  debugGeometry: () => ({ positions: new Float32Array(0), indices: new Uint32Array(0) }),
  destroy: () => undefined,
};

/** Requiere `initNav3D()` resuelto. Con entrada vacía devuelve una `RoomNav` con `empty: true`. */
export function createRoomNav(input: NavInput): RoomNav {
  if (input.indices.length === 0) return EMPTY_NAV;
  const result = generateSoloNavMesh(input.positions, input.indices, recastConfig());
  if (!result.success) return EMPTY_NAV;
  const navMesh: NavMesh = result.navMesh;
  const query = new NavMeshQuery(navMesh);

  const nearest = (p: NavPoint, tol: { plan: number; height: number }) => {
    const found = query.findNearestPoly(toRecast(p), {
      halfExtents: { x: tol.plan, y: tol.height, z: tol.plan },
    });
    if (!found.success || found.nearestRef === 0) return null;
    const point = fromRecast(found.nearestPoint);
    // La caja de búsqueda es cuadrada; la tolerancia en planta es circular.
    if (Math.hypot(point.x - p.x, point.y - p.y) > tol.plan) return null;
    if (Math.abs(point.h - p.h) > tol.height) return null;
    return { ref: found.nearestRef, point };
  };
  const DEFAULT_TOL = { plan: NAV3D.snapPlan, height: NAV3D.snapHeight };

  return {
    empty: false,
    closest: (p, tol = DEFAULT_TOL) => nearest(p, tol)?.point ?? null,
    path(from, to) {
      const a = nearest(from, DEFAULT_TOL);
      const b = nearest(to, DEFAULT_TOL);
      if (!a || !b) return null;
      const computed = query.computePath(toRecast(a.point), toRecast(b.point), {
        halfExtents: { x: NAV3D.snapPlan, y: NAV3D.snapHeight, z: NAV3D.snapPlan },
      });
      if (!computed.success || computed.path.length === 0) return null;
      const path = computed.path.map(fromRecast);
      const end = path[path.length - 1]!;
      // Detour devuelve una ruta parcial hasta el punto alcanzable más cercano: no vale.
      if (Math.hypot(end.x - b.point.x, end.y - b.point.y, end.h - b.point.h) > PATH_END_EPSILON) {
        return null;
      }
      return path;
    },
    slide(from, to) {
      const start = nearest(from, DEFAULT_TOL);
      if (!start) return from;
      const moved = query.moveAlongSurface(start.ref, toRecast(start.point), toRecast({ ...to, h: start.point.h }));
      if (!moved.success) return start.point;
      const end = fromRecast(moved.resultPosition);
      const last = moved.visited[moved.visited.length - 1];
      if (last !== undefined) {
        const height = query.getPolyHeight(last, moved.resultPosition);
        if (height.success) end.h = height.height;
      }
      return end;
    },
    debugGeometry() {
      const [positions, indices] = getNavMeshPositionsAndIndices(navMesh);
      return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
    },
    destroy() {
      query.destroy();
      navMesh.destroy();
    },
  };
}

/** Atajo: `createRoomNav(buildNavInput(...))`. */
export function createRoomNavFor(
  pkg: RoomPackage,
  roomId: string,
  catalog: Models3DCatalog | undefined,
): RoomNav {
  return createRoomNav(buildNavInput(pkg, roomId, catalog));
}
