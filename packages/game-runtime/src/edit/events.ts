/**
 * Eventos del runtime en modo edición (specs/09 §1): la escena no edita nada
 * por su cuenta, solo traduce el puntero a celdas de la rejilla isométrica y
 * dice qué objeto hay debajo. Las herramientas (pincel, relleno, borrador,
 * colocar, arrastrar) viven fuera, en la capa de comandos del editor, y
 * escriben en el doc Yjs; el runtime se vuelve a pintar desde el doc.
 */

/** Nombre del evento de Phaser con el que la escena emite `EditPointerEvent`. */
export const EDIT_EVENT = "edit:event";

export interface EditCell {
  x: number;
  y: number;
}

export interface EditPointerEvent {
  type: "pointer";
  phase: "down" | "move" | "up";
  /** Celda bajo el puntero (puede caer fuera de la rejilla). */
  cell: EditCell;
  /** ¿Está `cell` dentro de la habitación activa? */
  inside: boolean;
  /** Objeto de más arriba bajo el puntero, si lo hay. */
  objectId?: string;
  /** Habitación activa. */
  roomId: string;
}

export type EditSceneEvent = EditPointerEvent;
