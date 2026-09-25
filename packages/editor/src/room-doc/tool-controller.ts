import type * as Y from "yjs";
import {
  eraseTiles,
  fillTiles,
  isCellInRoom,
  moveObject,
  paintTiles,
  placeObject,
  readObject,
  removeObject,
  RoomDocError,
  type Cell,
  type RoomDocErrorCode,
} from "./commands";
import { addDecoration, addTorch } from "./decor";
import type { EditorTileLayer } from "./doc-model";

/**
 * Controlador de herramientas del modo edición. Traduce los eventos de puntero
 * que emite el runtime en `mode: 'edit'` (celda + objeto bajo el cursor) a
 * comandos sobre el doc Yjs. Es headless (sin Phaser ni DOM): la página del
 * editor le pasa los eventos y React lee su estado con `subscribe`/`getState`
 * (compatible con `useSyncExternalStore`).
 *
 * Solo guarda estado de UI (herramienta, capa, tile, selección, arrastre en
 * curso); la sala vive siempre en el doc.
 */

export const EDIT_TOOLS = [
  "select",
  "brush",
  "fill",
  "eraser",
  "place",
  "decorate",
  "torch",
] as const;
export type EditTool = (typeof EDIT_TOOLS)[number];

/** Evento de puntero del runtime en modo edición (misma forma que `EditPointerEvent`). */
export type ToolPointerEvent = {
  phase: "down" | "move" | "up";
  cell: Cell;
  /** Objeto bajo el puntero (el de más arriba), si lo hay. */
  objectId?: string;
};

export type ToolError = { code: RoomDocErrorCode | "UNKNOWN"; message: string };

export function toToolError(error: unknown): ToolError {
  if (error instanceof RoomDocError) return { code: error.code, message: error.message };
  return { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
}

export type ToolState = {
  tool: EditTool;
  layer: EditorTileLayer;
  tileId: number;
  /** Sprite que coloca la herramienta `place` (objeto) o `decorate` (decoración). */
  sprite?: string;
  roomId: string;
  selectedObjectId?: string;
  /**
   * Arrastre en curso: el objeto se pinta en `cell` pero el doc no cambia hasta
   * soltar. El desplazamiento es relativo a la celda donde se pulsó (`grab`),
   * así que un clic sin mover no desplaza el objeto.
   */
  drag?: { objectId: string; cell: Cell; grab: Cell; from: Cell };
  /** Último id colocado (para enfocar el campo de renombrado). */
  lastPlacedId?: string;
  /** Última decoración o antorcha colocada (índice en su lista de la habitación). */
  lastPlacedDecor?: { kind: "decoration" | "torch"; roomId: string; index: number };
  /**
   * Último error de un comando. `code` es el de `RoomDocError` (la UI lo
   * traduce) o `UNKNOWN`.
   */
  error?: ToolError;
};

export type EditToolControllerOptions = {
  roomId: string;
  tool?: EditTool;
  layer?: EditorTileLayer;
  tileId?: number;
};

/**
 * Cadencia máxima de transacciones Yjs durante un trazo de pincel/borrador
 * (auditoría D-17): sin tope, cada `pointermove` (y cada celda interpolada de
 * `lineCells`) escribía en una transacción propia, y `useRoomPackage`
 * re-serializa el doc ENTERO por transacción — una pincelada rápida sobre una
 * sala grande podía disparar decenas de re-render completos por segundo. Las
 * celdas se acumulan en memoria y se vuelcan como mucho cada
 * `STROKE_FLUSH_INTERVAL_MS`, más un volcado final al soltar (`pointerup`) o
 * al cambiar de herramienta/habitación a media pincelada.
 */
export const STROKE_FLUSH_INTERVAL_MS = 32;

export class EditToolController {
  private readonly doc: Y.Doc;
  private state: ToolState;
  private readonly listeners = new Set<() => void>();
  /** Trazo de pincel/borrador en curso: última celda pintada. */
  private stroke?: { lastCell: Cell };
  /** Celdas del trazo en curso aún no volcadas al doc, por clave `"x,y"`. */
  private pendingStroke = new Map<string, Cell>();
  private pendingStrokeTool?: "brush" | "eraser";
  private pendingStrokeRoomId?: string;
  private pendingStrokeLayer?: EditorTileLayer;
  private pendingStrokeTileId?: number;
  private lastStrokeFlushAt = 0;

  constructor(doc: Y.Doc, options: EditToolControllerOptions) {
    this.doc = doc;
    this.state = {
      tool: options.tool ?? "select",
      layer: options.layer ?? "ground",
      tileId: options.tileId ?? 1,
      roomId: options.roomId,
    };
  }

  getState = (): ToolState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ToolState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  setTool(tool: EditTool): void {
    this.flushStroke();
    this.stroke = undefined;
    this.update({ tool, drag: undefined, error: undefined });
  }

  setLayer(layer: EditorTileLayer): void {
    this.update({ layer });
  }

  /** Elige un tile de la palette (pasa a pincel si la herramienta no pinta). */
  selectTile(tileId: number, layer?: EditorTileLayer): void {
    const paints = this.state.tool === "brush" || this.state.tool === "fill";
    this.update({
      tileId,
      ...(layer ? { layer } : {}),
      ...(paints ? {} : { tool: "brush" as const }),
      error: undefined,
    });
  }

  /**
   * Elige un sprite de la palette: la herramienta pasa a `place` (objeto),
   * salvo que ya estuviera en `decorate`, que lo coloca como decoración.
   */
  selectSprite(sprite: string): void {
    this.flushStroke();
    this.stroke = undefined;
    const tool = this.state.tool === "decorate" ? "decorate" : "place";
    this.update({ sprite, tool, drag: undefined, error: undefined });
  }

  /** Elige un sprite de la palette para colocarlo como decoración (herramienta `decorate`). */
  selectDecorationSprite(sprite: string): void {
    this.flushStroke();
    this.stroke = undefined;
    this.update({ sprite, tool: "decorate", drag: undefined, error: undefined });
  }

  setRoom(roomId: string): void {
    this.flushStroke();
    this.stroke = undefined;
    this.update({ roomId, selectedObjectId: undefined, drag: undefined, error: undefined });
  }

  select(objectId: string | undefined): void {
    this.update({ selectedObjectId: objectId, error: undefined });
  }

  /** Borra el objeto seleccionado. */
  deleteSelection(): void {
    const id = this.state.selectedObjectId;
    if (!id || !readObject(this.doc, id)) return;
    removeObject(this.doc, id);
    this.update({ selectedObjectId: undefined });
  }

  /** Punto de entrada de los eventos de puntero del runtime. */
  pointer(event: ToolPointerEvent): void {
    try {
      this.handle(event);
    } catch (error) {
      this.flushStroke();
      this.stroke = undefined;
      this.update({ drag: undefined, error: toToolError(error) });
    }
  }

  private handle(event: ToolPointerEvent): void {
    const { tool } = this.state;
    switch (tool) {
      case "brush":
      case "eraser":
        this.handleStroke(event);
        return;
      case "fill":
        if (event.phase === "down") {
          fillTiles(this.doc, this.state.roomId, this.state.layer, event.cell, this.state.tileId);
        }
        return;
      case "place":
        if (event.phase === "down") this.handlePlace(event.cell);
        return;
      case "decorate":
        if (event.phase === "down") this.handleDecorate(event.cell);
        return;
      case "torch":
        if (event.phase === "down") this.handleTorch(event);
        return;
      case "select":
        this.handleSelect(event);
        return;
    }
  }

  /** Acumula una celda del trazo en curso; no toca el doc todavía (D-17). */
  private paintCell(cell: Cell): void {
    const { roomId, layer, tileId, tool } = this.state;
    this.pendingStrokeTool = tool === "eraser" ? "eraser" : "brush";
    this.pendingStrokeRoomId = roomId;
    this.pendingStrokeLayer = layer;
    this.pendingStrokeTileId = tileId;
    this.pendingStroke.set(`${cell.x},${cell.y}`, cell);
    const now = Date.now();
    if (now - this.lastStrokeFlushAt >= STROKE_FLUSH_INTERVAL_MS) this.flushStroke();
  }

  /**
   * Vuelca las celdas acumuladas del trazo en curso en UNA transacción Yjs.
   * Se llama al ritmo de `STROKE_FLUSH_INTERVAL_MS`, al soltar (`pointerup`) y
   * en cualquier punto donde el trazo se interrumpe (cambio de herramienta,
   * de sprite, de habitación, error) para no perder celdas ya pintadas.
   */
  private flushStroke(): void {
    this.lastStrokeFlushAt = Date.now();
    if (this.pendingStroke.size === 0) return;
    const cells = [...this.pendingStroke.values()];
    const roomId = this.pendingStrokeRoomId!;
    const layer = this.pendingStrokeLayer!;
    this.pendingStroke.clear();
    if (this.pendingStrokeTool === "eraser") eraseTiles(this.doc, roomId, layer, cells);
    else paintTiles(this.doc, roomId, layer, cells, this.pendingStrokeTileId!);
  }

  private handleStroke(event: ToolPointerEvent): void {
    if (event.phase === "down") {
      this.stroke = { lastCell: event.cell };
      this.paintCell(event.cell);
      return;
    }
    if (event.phase === "move" && this.stroke) {
      const { lastCell } = this.stroke;
      if (lastCell.x === event.cell.x && lastCell.y === event.cell.y) return;
      // Interpola para no dejar huecos si el puntero salta celdas entre eventos.
      for (const cell of lineCells(lastCell, event.cell).slice(1)) this.paintCell(cell);
      this.stroke = { lastCell: event.cell };
      return;
    }
    if (event.phase === "up") {
      this.flushStroke();
      this.stroke = undefined;
    }
  }

  private handlePlace(cell: Cell): void {
    const { sprite, roomId } = this.state;
    if (!sprite || !isCellInRoom(this.doc, roomId, cell)) return;
    const id = placeObject(this.doc, { roomId, sprite, position: cell });
    this.update({ selectedObjectId: id, lastPlacedId: id, error: undefined });
  }

  private handleDecorate(cell: Cell): void {
    const { sprite, roomId } = this.state;
    if (!sprite || !isCellInRoom(this.doc, roomId, cell)) return;
    const index = addDecoration(this.doc, roomId, { sprite, x: cell.x, y: cell.y });
    this.update({ lastPlacedDecor: { kind: "decoration", roomId, index }, error: undefined });
  }

  /** Antorcha en la celda; si se pulsa sobre un objeto, queda gobernada por él (specs/04 §3.4). */
  private handleTorch(event: ToolPointerEvent): void {
    const { roomId } = this.state;
    const { cell } = event;
    if (!isCellInRoom(this.doc, roomId, cell)) return;
    const objectId =
      event.objectId && readObject(this.doc, event.objectId) ? event.objectId : undefined;
    const index = addTorch(this.doc, roomId, {
      x: cell.x,
      y: cell.y,
      ...(objectId ? { objectId } : {}),
    });
    this.update({ lastPlacedDecor: { kind: "torch", roomId, index }, error: undefined });
  }

  private handleSelect(event: ToolPointerEvent): void {
    const { drag } = this.state;
    if (event.phase === "down") {
      const object = event.objectId ? readObject(this.doc, event.objectId) : undefined;
      if (object) {
        const from = { x: object.position.x, y: object.position.y };
        this.update({
          selectedObjectId: object.id,
          drag: { objectId: object.id, cell: from, grab: event.cell, from },
          error: undefined,
        });
      } else {
        this.update({ selectedObjectId: undefined, drag: undefined, error: undefined });
      }
      return;
    }
    if (!drag) return;
    const target = {
      x: drag.from.x + event.cell.x - drag.grab.x,
      y: drag.from.y + event.cell.y - drag.grab.y,
    };
    const inside = isCellInRoom(this.doc, this.state.roomId, target);
    if (event.phase === "move") {
      if (inside && (drag.cell.x !== target.x || drag.cell.y !== target.y)) {
        this.update({ drag: { ...drag, cell: target } });
      }
      return;
    }
    // up: se confirma en el doc la última celda válida del arrastre.
    this.update({ drag: undefined });
    const final = inside ? target : drag.cell;
    if (final.x !== drag.from.x || final.y !== drag.from.y) {
      if (readObject(this.doc, drag.objectId)) moveObject(this.doc, drag.objectId, final);
    }
  }
}

/** Celdas de una línea entre dos celdas (Bresenham), extremos incluidos. */
export function lineCells(from: Cell, to: Cell): Cell[] {
  // Redondeo defensivo: con coordenadas no enteras el bucle no llegaría al final.
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const toX = Math.round(to.x);
  const toY = Math.round(to.y);
  const cells: Cell[] = [];
  const dx = Math.abs(toX - x);
  const dy = -Math.abs(toY - y);
  const sx = x < toX ? 1 : -1;
  const sy = y < toY ? 1 : -1;
  let err = dx + dy;
  for (let steps = 0; steps <= dx - dy; steps++) {
    cells.push({ x, y });
    if (x === toX && y === toY) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}
