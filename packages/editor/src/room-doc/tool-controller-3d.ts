import type * as Y from "yjs";
import { MAX_WORLD3D_HEIGHT } from "@escaperoom/shared/schemas";
import { RoomDocError, removeObject } from "./commands";
import {
  applyTransforms3D,
  duplicate3D,
  listPieces3D,
  listSpawnPoints3D,
  placeObject3D,
  placePieces3D,
  removePieces3D,
  setSpawnPoints3D,
  type Transform3DChange,
} from "./commands3d";
import { addTorch, removeLight } from "./decor";
import { toToolError, type ToolError } from "./tool-controller";

/**
 * Controlador de herramientas del editor 3D (encargo 7.7). Traduce los eventos
 * de puntero del lienzo 3D (punto del mundo + elemento bajo el cursor) en
 * comandos sobre el doc Yjs. Headless: sin React ni Three; la interfaz lo lee
 * con `subscribe`/`getState` (compatible con `useSyncExternalStore`). Solo
 * guarda estado de UI; la sala vive siempre en el doc.
 */

export const EDIT_TOOLS_3D = ["select", "place", "spawn", "torch"] as const;
export type EditTool3D = (typeof EDIT_TOOLS_3D)[number];

/** Misma forma que `EditTarget3D` del runtime, redeclarada para no depender de Three (`index` es la posición en `room.lighting`). */
export type EditTarget =
  | { kind: "piece"; id: string }
  | { kind: "object"; id: string }
  | { kind: "spawn"; id: string }
  | { kind: "torch"; index: number };

export type Tool3DState = {
  tool: EditTool3D;
  roomId: string;
  /** Modelo elegido en la paleta y cómo se coloca. */
  placing?: { model: string; as: "piece" | "object"; snap: boolean };
  /** Giro con el que se coloca lo siguiente (múltiplos de 90 con imán). */
  placeYaw: number;
  /** Múltiplos de 0.2, de 0 a `MAX_WORLD3D_HEIGHT`. */
  workHeight: number;
  /** Por defecto `true`. */
  snapEnabled: boolean;
  gizmoMode: "translate" | "rotate" | "scale";
  selection: EditTarget[];
  /** Fantasma que debe pintar el lienzo, o `undefined`. */
  ghost?: { model: string; x: number; y: number; h: number; yaw: number };
  lastPlacedObjectId?: string;
  error?: ToolError;
};

export type Pointer3D = {
  type: "move" | "down" | "up" | "click";
  point: { x: number; y: number; h: number } | null;
  target: EditTarget | { kind: "none" };
  shiftKey: boolean;
  altKey: boolean;
};

export type Edit3DControllerOptions = { roomId: string };

/** Máximo de puntos de aparición por habitación. */
export const MAX_SPAWNS_PER_ROOM_3D = 8;
/** Altura por defecto de una antorcha sobre la altura de trabajo. */
const TORCH_HEIGHT_OFFSET = 1.6;
/** Distancia por debajo de la cual dos piezas del mismo modelo se consideran la misma. */
const SAME_PIECE_EPSILON = 0.01;
const WORK_HEIGHT_STEP = 0.2;

const sameTarget = (a: EditTarget, b: EditTarget): boolean =>
  a.kind === b.kind &&
  (a.kind === "torch" ? a.index === (b as typeof a).index : a.id === (b as { id: string }).id);

export class Edit3DController {
  private readonly doc: Y.Doc;
  private state: Tool3DState;
  private readonly listeners = new Set<() => void>();
  /** Trazo de piezas en curso: celdas ya pisadas (`"i,j"`). */
  private stroke?: { cells: Set<string> };

  constructor(doc: Y.Doc, options: Edit3DControllerOptions) {
    this.doc = doc;
    this.state = {
      tool: "select",
      roomId: options.roomId,
      placeYaw: 0,
      workHeight: 0,
      snapEnabled: true,
      gizmoMode: "translate",
      selection: [],
    };
  }

  getState = (): Tool3DState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<Tool3DState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  setRoom(roomId: string): void {
    this.stroke = undefined;
    this.update({ roomId, selection: [], ghost: undefined, error: undefined });
  }

  setTool(tool: EditTool3D): void {
    this.stroke = undefined;
    this.update({ tool, ghost: undefined, error: undefined });
  }

  /** Elige un modelo de la paleta y pasa a `place`. */
  selectModel(model: string, as: "piece" | "object", snap: boolean): void {
    this.stroke = undefined;
    this.update({ placing: { model, as, snap }, tool: "place", ghost: undefined, error: undefined });
  }

  setWorkHeight(h: number): void {
    if (!Number.isFinite(h)) return;
    const stepped = Math.round(h / WORK_HEIGHT_STEP) * WORK_HEIGHT_STEP;
    const clamped = Math.min(MAX_WORLD3D_HEIGHT, Math.max(0, stepped));
    this.update({ workHeight: Number(clamped.toFixed(1)) });
  }

  setSnapEnabled(snapEnabled: boolean): void {
    this.update({ snapEnabled });
  }

  setGizmoMode(gizmoMode: Tool3DState["gizmoMode"]): void {
    this.update({ gizmoMode });
  }

  rotatePlacement(): void {
    const placeYaw = (this.state.placeYaw + 90) % 360;
    const ghost = this.state.ghost ? { ...this.state.ghost, yaw: placeYaw } : undefined;
    this.update({ placeYaw, ghost });
  }

  select(targets: readonly EditTarget[]): void {
    this.update({ selection: [...targets], error: undefined });
  }

  clearError(): void {
    if (this.state.error) this.update({ error: undefined });
  }

  /** Punto de entrada de los eventos de puntero del lienzo. */
  pointer(event: Pointer3D): void {
    try {
      this.handle(event);
    } catch (error) {
      this.stroke = undefined;
      this.update({ error: toToolError(error) });
    }
  }

  /** Del gizmo: con `final`, escribe en el doc (un gesto = un paso de historial). */
  transform(changes: readonly Transform3DChange[], final: boolean): void {
    if (!final || changes.length === 0) return;
    try {
      applyTransforms3D(this.doc, this.state.roomId, changes);
      if (this.state.error) this.update({ error: undefined });
    } catch (error) {
      this.update({ error: toToolError(error) });
    }
  }

  deleteSelection(): void {
    const { selection, roomId } = this.state;
    if (selection.length === 0) return;
    try {
      const pieces = selection.flatMap((t) => (t.kind === "piece" ? [t.id] : []));
      const objects = selection.flatMap((t) => (t.kind === "object" ? [t.id] : []));
      const spawnIds = new Set(selection.flatMap((t) => (t.kind === "spawn" ? [t.id] : [])));
      const torches = selection
        .flatMap((t) => (t.kind === "torch" ? [t.index] : []))
        .sort((a, b) => b - a);

      // Se comprueba todo antes de escribir: o se borra la selección entera o nada.
      let remainingSpawns: ReturnType<typeof listSpawnPoints3D> | undefined;
      if (spawnIds.size > 0) {
        const all = listSpawnPoints3D(this.doc, roomId);
        remainingSpawns = all.filter((spawn) => !spawnIds.has(spawn.id));
        if (remainingSpawns.length === 0 && all.length > 0) {
          throw new RoomDocError(
            "INVALID_VALUE",
            "La habitación necesita al menos un punto de aparición",
          );
        }
      }

      this.doc.transact(() => {
        if (pieces.length > 0) removePieces3D(this.doc, pieces);
        for (const id of objects) removeObject(this.doc, id);
        if (remainingSpawns) {
          setSpawnPoints3D(
            this.doc,
            roomId,
            remainingSpawns.map((s) => ({ ...s, h: s.h ?? 0, yaw: s.yaw ?? 0 })),
          );
        }
        for (const index of torches) removeLight(this.doc, roomId, index);
      });
      this.update({ selection: [], error: undefined });
    } catch (error) {
      this.update({ error: toToolError(error) });
    }
  }

  /** Duplica piezas y objetos de la selección desplazados (1, 0, 0) y selecciona las copias. */
  duplicateSelection(): void {
    const targets = this.state.selection.flatMap((t) =>
      t.kind === "piece" || t.kind === "object" ? [t] : [],
    );
    if (targets.length === 0) return;
    try {
      const created = duplicate3D(this.doc, this.state.roomId, targets, { x: 1, y: 0, h: 0 });
      this.update({
        selection: [
          ...created.pieces.map((id) => ({ kind: "piece" as const, id })),
          ...created.objects.map((id) => ({ kind: "object" as const, id })),
        ],
        error: undefined,
      });
    } catch (error) {
      this.update({ error: toToolError(error) });
    }
  }

  // -------------------------------------------------------------------------

  /** Punto con imán (centro de celda) o libre; en ambos casos `h = workHeight`. */
  private adjusted(
    point: { x: number; y: number },
    snap: boolean,
  ): { x: number; y: number; h: number } {
    const h = this.state.workHeight;
    return snap
      ? { x: Math.floor(point.x) + 0.5, y: Math.floor(point.y) + 0.5, h }
      : { x: point.x, y: point.y, h };
  }

  private handle(event: Pointer3D): void {
    switch (this.state.tool) {
      case "place":
        this.handlePlace(event);
        return;
      case "select":
        this.handleSelect(event);
        return;
      case "spawn":
        if (event.type === "click" && event.point) this.handleSpawn(event);
        return;
      case "torch":
        if (event.type === "click" && event.point) this.handleTorch(event);
        return;
    }
  }

  private handlePlace(event: Pointer3D): void {
    const { placing, roomId, placeYaw } = this.state;
    if (!placing) return;
    const snap = this.state.snapEnabled && placing.snap && !event.altKey;
    const point = event.point ? this.adjusted(event.point, snap) : undefined;

    if (event.type === "move" || event.type === "down") {
      this.update({
        ghost: point ? { model: placing.model, ...point, yaw: placeYaw } : undefined,
      });
    }

    if (placing.as === "piece") {
      if (event.type === "up") {
        this.stroke = undefined;
        return;
      }
      if (!point || (event.type !== "down" && !(event.type === "move" && this.stroke))) return;
      if (event.type === "down") this.stroke = { cells: new Set() };
      const key = `${Math.floor(point.x)},${Math.floor(point.y)}`;
      if (this.stroke!.cells.has(key)) return;
      this.stroke!.cells.add(key);
      const duplicate = listPieces3D(this.doc, roomId).some(
        (p) =>
          p.model === placing.model &&
          Math.hypot(p.x - point.x, p.y - point.y, p.h - point.h) < SAME_PIECE_EPSILON,
      );
      if (duplicate) return;
      placePieces3D(this.doc, roomId, [{ model: placing.model, ...point, yaw: placeYaw }]);
      if (this.state.error) this.update({ error: undefined });
      return;
    }

    if (event.type !== "click" || !point) return;
    const id = placeObject3D(this.doc, {
      roomId,
      sprite: placing.model,
      transform: { ...point, yaw: placeYaw },
      type: "decorativo",
      interactable: true,
    });
    this.update({
      selection: [{ kind: "object", id }],
      lastPlacedObjectId: id,
      tool: "select",
      ghost: undefined,
      error: undefined,
    });
  }

  private handleSelect(event: Pointer3D): void {
    if (event.type !== "click") return;
    const { target } = event;
    if (target.kind === "none") {
      this.update({ selection: [], error: undefined });
      return;
    }
    const current = this.state.selection;
    if (!event.shiftKey) {
      this.update({ selection: [target], error: undefined });
      return;
    }
    const selection = current.some((t) => sameTarget(t, target))
      ? current.filter((t) => !sameTarget(t, target))
      : [...current, target];
    this.update({ selection, error: undefined });
  }

  private handleSpawn(event: Pointer3D): void {
    const { roomId, placeYaw } = this.state;
    const spawns = listSpawnPoints3D(this.doc, roomId);
    if (spawns.length >= MAX_SPAWNS_PER_ROOM_3D) {
      throw new RoomDocError(
        "INVALID_VALUE",
        `Una habitación admite como mucho ${MAX_SPAWNS_PER_ROOM_3D} puntos de aparición`,
      );
    }
    const point = this.adjusted(event.point!, this.state.snapEnabled && !event.altKey);
    const used = new Set(spawns.map((s) => s.id));
    let n = 1;
    while (used.has(`spawn-${n}`)) n += 1;
    setSpawnPoints3D(this.doc, roomId, [
      ...spawns.map((s) => ({ ...s, h: s.h ?? 0, yaw: s.yaw ?? 0 })),
      { id: `spawn-${n}`, ...point, yaw: placeYaw },
    ]);
    if (this.state.error) this.update({ error: undefined });
  }

  private handleTorch(event: Pointer3D): void {
    const { x, y } = event.point!;
    addTorch(this.doc, this.state.roomId, {
      x,
      y,
      h: this.state.workHeight + TORCH_HEIGHT_OFFSET,
    });
    if (this.state.error) this.update({ error: undefined });
  }
}
