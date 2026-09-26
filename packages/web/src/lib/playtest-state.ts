/**
 * Lógica pura del playtest de la Sala 1 (ticket 1.14, specs/04 §4 y §8-UI).
 *
 * Aísla las decisiones de interacción/UX del componente React para poder
 * probarlas sin DOM ni Phaser: bloqueo por intro, gating del mundo con el
 * inventario abierto, cierre de diálogo al completar una acción y selección de
 * parejas para combinar. El componente solo aplica el resultado.
 */

/** Id del diálogo de intro: bloquea el juego hasta cerrarse (specs/04 §4). */
export const INTRO_DIALOG_ID = "d-intro";

/** Vista mínima de un diálogo abierto. */
export interface DialogView {
  id: string;
  text: string;
}

/** ¿El diálogo abierto es la intro que bloquea el juego? */
export function isIntroOpen(dialog: DialogView | null): boolean {
  return dialog?.id === INTRO_DIALOG_ID;
}

export interface WorldInputState {
  /** La intro está abierta: bloquea mover/interactuar. */
  introOpen: boolean;
  /** El panel de inventario está abierto: el mundo no recibe clics. */
  inventoryOpen: boolean;
  /** Hay un panel de puzzle modal abierto. */
  panelOpen?: boolean;
}

/**
 * ¿Debe el mundo (Phaser) aceptar input del jugador? Falso mientras la intro o
 * el inventario estén abiertos (o un panel modal), para que los clics no se
 * cuelen por debajo (specs/04 §4 y §8-UI).
 */
export function isWorldInputEnabled(state: WorldInputState): boolean {
  return !state.introOpen && !state.inventoryOpen && !state.panelOpen;
}

/**
 * Alterna la selección de un item del inventario: pulsar uno seleccionado lo
 * quita; con dos ya seleccionados, el tercero reemplaza al más antiguo.
 */
export function toggleSelection(current: readonly string[], id: string): string[] {
  if (current.includes(id)) {
    return current.filter((value) => value !== id);
  }
  if (current.length >= 2) {
    return [...current.slice(1), id];
  }
  return [...current, id];
}

/**
 * Entradas listas para combinar: dos items distintos, o **uno solo** (las
 * recetas de un ingrediente, como «Inspeccionar la llave de plata» del Rey
 * Aldric, paso 8; sin esto la ruta crítica no se podía completar desde la UI).
 */
export function combineInputs(staged: readonly string[]): string[] | null {
  const [a, b] = staged;
  if (a === undefined || a === b) {
    return null;
  }
  return b === undefined ? [a] : [a, b];
}
