import type {
  CodeLockDefinition,
  CombineItemsDefinition,
  HiddenKeyDefinition,
  MemoryPuzzleDefinition,
  PipesPuzzleDefinition,
  PuzzleDefinition,
  SimultaneousPlatesDefinition,
  SlidingPuzzleDefinition,
  SplitClueDefinition,
} from "@escaperoom/shared/schemas";
import {
  applyCombination,
  attemptCode,
  createCodeLockState,
  createCombineItemsState,
  createHiddenKeyState,
  createMemoryState,
  createPipesState,
  createSimultaneousPlatesState,
  createSlidingRng,
  createSlidingState,
  createSplitClueState,
  flipCard,
  moveSlidingTile,
  openPipesGate,
  pipesSeedFromId,
  placeSoloBridge,
  placeSplitClueBridge,
  revealHiddenKey,
  rotatePipe,
  setPlateActive,
  submitCombination,
  type CodeLockAttemptOutcome,
  type CodeLockState,
  type CombinationOutcome,
  type CombineItemsState,
  type HiddenKeyRevealOutcome,
  type HiddenKeyState,
  type MemoryFlipOutcome,
  type MemoryState,
  type PipesGateOutcome,
  type PipesPuzzleState,
  type PipesRotateOutcome,
  type PlateOutcome,
  type SimultaneousPlatesState,
  type SlidingMoveOutcome,
  type SlidingPuzzleState,
  type SplitClueBridgeOutcome,
  type SplitClueState,
  type SplitClueSubmitOutcome,
} from "@escaperoom/shared/templates";

/**
 * Vista previa jugable del puzzle configurado (ticket 3.5): el mismo estado y
 * las mismas transiciones puras de `@escaperoom/shared/templates` que ejecuta
 * el servidor, pero en local y sin sala. El editor la usa para que el creador
 * resuelva su puzzle antes de publicarlo (specs/09 §1: «`<MemoryPuzzle>` se
 * monta en modo demo dentro del editor»).
 *
 * La vista previa aísla la plantilla del resto de la sala:
 * - `requiresSolved` se ignora (arranca `available`, no `locked`);
 * - el creador «lleva» todos los objetos que la plantilla puede pedir (los de
 *   las compuertas de `pipes`, los ingredientes base de `combine_items`);
 * - las tiradas aleatorias usan una semilla estable del id (reproducible).
 */

/** Actor de la vista previa (el creador). */
export const PREVIEW_PLAYER_ID = "editor-preview";

/** Definición que usa la vista previa: la del doc, sin dependencias de otros puzzles. */
export function previewDefinition<T extends PuzzleDefinition>(puzzle: T): T {
  return { ...puzzle, requiresSolved: [] };
}

/** Semilla estable por id (mismo hash que el tablero de `pipes`). */
function previewRng(id: string): () => number {
  return createSlidingRng(pipesSeedFromId(id));
}

/**
 * Ingredientes de partida de un `combine_items`: todo lo que entra en alguna
 * receta y ninguna receta produce (el resto se obtiene combinando).
 */
export function combineItemsStartingInventory(def: CombineItemsDefinition): string[] {
  const outputs = new Set(def.recipes.map((recipe) => recipe.output));
  return [
    ...new Set(def.recipes.flatMap((recipe) => recipe.inputs).filter((id) => !outputs.has(id))),
  ];
}

/** Objetos de las compuertas de un `pipes` (el creador los tiene todos). */
export function pipesGateItems(def: PipesPuzzleDefinition): string[] {
  return [
    ...new Set(
      (def.blockedCells ?? []).flatMap((cell) =>
        cell.opensWithItem !== undefined ? [cell.opensWithItem] : [],
      ),
    ),
  ];
}

export type CombinePreviewFeedback = { outcome: CombinationOutcome; output: string | null };

export type TemplatePreview =
  | {
      type: "hidden_key";
      def: HiddenKeyDefinition;
      state: HiddenKeyState;
      feedback: HiddenKeyRevealOutcome | null;
    }
  | {
      type: "code_lock";
      def: CodeLockDefinition;
      state: CodeLockState;
      feedback: CodeLockAttemptOutcome | null;
    }
  | {
      type: "simultaneous_plates";
      def: SimultaneousPlatesDefinition;
      state: SimultaneousPlatesState;
      feedback: PlateOutcome | null;
    }
  | {
      type: "combine_items";
      def: CombineItemsDefinition;
      state: CombineItemsState;
      feedback: CombinePreviewFeedback | null;
    }
  | {
      type: "sliding_puzzle";
      def: SlidingPuzzleDefinition;
      state: SlidingPuzzleState;
      feedback: SlidingMoveOutcome | null;
    }
  | {
      type: "memory";
      def: MemoryPuzzleDefinition;
      state: MemoryState;
      feedback: MemoryFlipOutcome | null;
    }
  | {
      type: "split_clue";
      def: SplitClueDefinition;
      state: SplitClueState;
      /** Mirilla desde la que mira el creador (la vista previa deja cambiarla). */
      viewpointId: string;
      feedback: SplitClueSubmitOutcome | SplitClueBridgeOutcome | null;
    }
  | {
      type: "pipes";
      def: PipesPuzzleDefinition;
      state: PipesPuzzleState;
      feedback: PipesRotateOutcome | PipesGateOutcome | null;
    };

/** Estado inicial de la vista previa de un puzzle (el que vería el jugador al abrirlo). */
export function createTemplatePreview(puzzle: PuzzleDefinition): TemplatePreview {
  switch (puzzle.type) {
    case "hidden_key": {
      const def = previewDefinition(puzzle);
      return { type: def.type, def, state: createHiddenKeyState(def), feedback: null };
    }
    case "code_lock": {
      const def = previewDefinition(puzzle);
      return { type: def.type, def, state: createCodeLockState(def), feedback: null };
    }
    case "simultaneous_plates": {
      const def = previewDefinition(puzzle);
      return { type: def.type, def, state: createSimultaneousPlatesState(def), feedback: null };
    }
    case "combine_items": {
      const def = previewDefinition(puzzle);
      const inventory = combineItemsStartingInventory(def);
      return {
        type: def.type,
        def,
        state: createCombineItemsState(def, inventory),
        feedback: null,
      };
    }
    case "sliding_puzzle": {
      const def = previewDefinition(puzzle);
      const rng = def.scramble === "random" ? previewRng(def.id) : undefined;
      return { type: def.type, def, state: createSlidingState(def, rng), feedback: null };
    }
    case "memory": {
      const def = previewDefinition(puzzle);
      return {
        type: def.type,
        def,
        state: createMemoryState(def, previewRng(def.id)),
        feedback: null,
      };
    }
    case "split_clue": {
      const def = previewDefinition(puzzle);
      return {
        type: def.type,
        def,
        state: createSplitClueState(def),
        viewpointId: def.viewpoints[0]?.objectId ?? "",
        feedback: null,
      };
    }
    case "pipes": {
      const def = previewDefinition(puzzle);
      return { type: def.type, def, state: createPipesState(def), feedback: null };
    }
  }
}

/** Intenciones del jugador en la vista previa (las mismas que el panel envía al servidor). */
export type TemplatePreviewAction =
  | { type: "reveal" }
  | { type: "attempt_code"; code: string }
  | { type: "toggle_plate"; objectId: string; active: boolean }
  | { type: "place_plates_bridge" }
  | { type: "combine"; inputs: string[] }
  | { type: "slide"; index: number }
  | { type: "flip"; cardId: string }
  | { type: "submit_clue"; combination: string | string[] }
  | { type: "place_clue_bridge" }
  | { type: "select_viewpoint"; viewpointId: string }
  | { type: "rotate_pipe"; index: number }
  | { type: "open_gate"; index: number };

/**
 * Aplica una intención a la vista previa con la transición pura de la
 * plantilla. Una intención que no corresponde a la plantilla no cambia nada.
 */
export function applyTemplatePreview(
  preview: TemplatePreview,
  action: TemplatePreviewAction,
  now: number,
): TemplatePreview {
  const actor = PREVIEW_PLAYER_ID;
  switch (preview.type) {
    case "hidden_key": {
      if (action.type !== "reveal") return preview;
      const result = revealHiddenKey(preview.state, preview.def, now, actor);
      return { ...preview, state: result.state, feedback: result.outcome };
    }
    case "code_lock": {
      if (action.type !== "attempt_code") return preview;
      const result = attemptCode(preview.state, preview.def, action.code, now);
      return { ...preview, state: result.state, feedback: result.outcome };
    }
    case "simultaneous_plates": {
      if (action.type === "toggle_plate") {
        const result = setPlateActive(
          preview.state,
          preview.def,
          action.objectId,
          action.active,
          now,
          actor,
        );
        return { ...preview, state: result.state, feedback: result.outcome };
      }
      if (action.type === "place_plates_bridge") {
        const result = placeSoloBridge(preview.state, preview.def, now, undefined, actor);
        return { ...preview, state: result.state, feedback: result.outcome };
      }
      return preview;
    }
    case "combine_items": {
      if (action.type !== "combine") return preview;
      const result = applyCombination(preview.state, preview.def, action.inputs, now);
      return {
        ...preview,
        state: result.state,
        feedback: { outcome: result.outcome, output: result.output },
      };
    }
    case "sliding_puzzle": {
      if (action.type !== "slide") return preview;
      const result = moveSlidingTile(preview.state, preview.def, action.index, now);
      return { ...preview, state: result.state, feedback: result.outcome };
    }
    case "memory": {
      if (action.type !== "flip") return preview;
      const result = flipCard(preview.state, preview.def, action.cardId, actor, now);
      return { ...preview, state: result.state, feedback: result.outcome };
    }
    case "split_clue": {
      if (action.type === "submit_clue") {
        const result = submitCombination(
          preview.state,
          preview.def,
          action.combination,
          now,
          actor,
        );
        return { ...preview, state: result.state, feedback: result.outcome };
      }
      if (action.type === "place_clue_bridge") {
        const result = placeSplitClueBridge(preview.state, preview.def, actor);
        return { ...preview, state: result.state, feedback: result.outcome };
      }
      if (action.type === "select_viewpoint") {
        return { ...preview, viewpointId: action.viewpointId, feedback: null };
      }
      return preview;
    }
    case "pipes": {
      if (action.type === "rotate_pipe") {
        const result = rotatePipe(preview.state, preview.def, action.index, now, 1, actor);
        return { ...preview, state: result.state, feedback: result.outcome };
      }
      if (action.type === "open_gate") {
        const held = pipesGateItems(preview.def);
        const result = openPipesGate(preview.state, preview.def, action.index, held, now, actor);
        return { ...preview, state: result.state, feedback: result.outcome };
      }
      return preview;
    }
  }
}

/** `true` si el creador ya resolvió el puzzle en la vista previa. */
export function isTemplatePreviewSolved(preview: TemplatePreview): boolean {
  return preview.state.state === "solved";
}
