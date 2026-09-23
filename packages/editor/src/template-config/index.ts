/**
 * Configuradores de plantillas (ticket 3.5, specs/06 y specs/09 §1): campos
 * propios de cada plantilla derivados del esquema, escritura en el doc Yjs,
 * aviso inmediato del oráculo y vista previa jugable en local. Todo headless:
 * los componentes React de juego los monta `packages/web` en el slot
 * `renderPuzzleConfigurator` del inspector (3.4).
 */
export * from "./config-model";
export * from "./preview";
