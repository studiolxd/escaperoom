import type { RuntimeDialog, RuntimeObject } from "../loader";

/**
 * Tipos puros del sistema de objetos del mundo (specs/04 §3). Este módulo no
 * depende de Phaser ni de React: es la lógica de estados, inventario interno e
 * inspección que consumen tanto la escena como (más adelante) el motor de
 * reglas de 1.4.
 */

/** Modo de reparto del inventario interno de un objeto (specs/04 §3.2). */
export type DistributionMode = NonNullable<RuntimeObject["distribution"]>;

/** Estado actual de cada objeto por `objectId` (strings libres del creador). */
export type ObjectStateMap = Record<string, string>;

/** Resultado de inspeccionar un objeto: diálogo resuelto + panel asociado. */
export interface InspectionResult {
  objectId: string;
  /** ¿El objeto admite interacción? */
  interactable: boolean;
  /** Id del diálogo asociado (`on_interact` + `show_dialog`). */
  dialogId?: string;
  /** Diálogo con `text` resuelto al locale pedido (con fallback). */
  dialog?: RuntimeDialog;
  /** Puzzle de panel que abre la interacción (`open_panel_puzzle`), si procede. */
  panelPuzzleId?: string;
  /** `true` si la regla de inspección tiene condiciones (las evalúa 1.4). */
  conditioned: boolean;
  /** Contenido interno pendiente si el objeto declara `inventory`. */
  contents?: string[];
  /** Modo de reparto del contenido. */
  distribution?: DistributionMode;
  /** ¿Se abrió ya el contenedor? */
  opened?: boolean;
  /** Imagen grande de inspección (`on_interact` + `show_image`, specs/26 §6.1). */
  image?: { image: string; caption?: string };
}
