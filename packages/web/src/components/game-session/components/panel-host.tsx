import type { RuntimePuzzle } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { GameAttempt } from "@escaperoom/game-runtime/session";
import type { HintPublicView, HintRequestErrorCode } from "@escaperoom/shared/hints";
import type { RoomPuzzlePublicView } from "@escaperoom/shared/session";
import type {
  CodeLockPublicView,
  HiddenKeyPublicView,
  MemoryPublicView,
  PipesPuzzlePublicView,
  SimultaneousPlatesPublicView,
  SlidingPuzzlePublicView,
  SplitCluePublicView,
} from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { HintPanel } from "@/components/hints/hint-panel";
import { CodeLockPanel, type CodeLockFeedback } from "@/components/puzzles/code-lock-panel";
import { HiddenKeyPanel, type HiddenKeyFeedback } from "@/components/puzzles/hidden-key-panel";
import { MemoryPanel, type MemoryFeedback } from "@/components/puzzles/memory-panel";
import { PipesPanel, type PipesFeedback } from "@/components/puzzles/pipes-panel";
import { PlatesPanel, type PlatesFeedback } from "@/components/puzzles/plates-panel";
import { SlidingPanel, type SlidingFeedback } from "@/components/puzzles/sliding-panel";
import { SplitCluePanel, type SplitClueFeedback } from "@/components/puzzles/split-clue-panel";
import type { PanelFeedback } from "../hooks/use-game-hud";

export interface PanelHostProps {
  open: boolean;
  container: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
  onClose: () => void;
  panel: string | null;
  activePuzzle: RuntimePuzzle | undefined;
  activeView: RoomPuzzlePublicView | undefined;
  feedback: PanelFeedback;
  pack?: RoomScenePack;
  playing: boolean;
  hintPuzzleId: string | undefined;
  hintView: HintPublicView;
  hintError: HintRequestErrorCode | null;
  onRequestHint: (puzzleId: string) => void;
  onAttempt: (puzzleId: string, attempt: GameAttempt) => void;
  onTogglePlate: (puzzleId: string, objectId: string, active: boolean) => void;
  onPlacePlatesBridge: (puzzleId: string) => void;
  onPlaceMirror: (puzzleId: string) => void;
  /**
   * Reloj para la cuenta atrás de `PlatesPanel` (F-43..47 punto 1): el reloj
   * del servidor compensado con el desfase del jugador, nunca `Date.now()` a
   * secas (ver `PlatesPanel.getNow`).
   */
  platesGetNow: () => number;
  panelTitle: (panel: string | null) => string;
  closeLabel: string;
  loadingLabel: string;
}

/** F-17: panel de puzzle/pistas — `Dialog` modal igual que el inventario. */
export function PanelHost({
  open,
  container,
  onOpenChange,
  onEscapeKeyDown,
  onClose,
  panel,
  activePuzzle,
  activeView,
  feedback,
  pack,
  playing,
  hintPuzzleId,
  hintView,
  hintError,
  onRequestHint,
  onAttempt,
  onTogglePlate,
  onPlacePlatesBridge,
  onPlaceMirror,
  platesGetNow,
  panelTitle,
  closeLabel,
  loadingLabel,
}: PanelHostProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={container}
        showCloseButton={false}
        overlayClassName="hidden"
        onEscapeKeyDown={onEscapeKeyDown}
        className="absolute inset-0 top-auto left-auto z-20 grid w-full max-w-none translate-x-0 translate-y-0 place-items-center overflow-auto rounded-none bg-black/50 p-4 ring-0"
      >
        <DialogTitle className="sr-only">{panelTitle(panel)}</DialogTitle>
        <DialogDescription className="sr-only">{closeLabel}</DialogDescription>
        <div className="flex flex-col items-end gap-2">
          <Button size="sm" variant="overlayGhost" onClick={onClose}>
            {closeLabel}
          </Button>
          {panel === "hints" && hintPuzzleId ? (
            <HintPanel
              view={hintView}
              puzzleId={hintPuzzleId}
              onRequest={onRequestHint}
              disabled={!playing}
              error={hintError}
            />
          ) : null}
          {activePuzzle && !activeView ? <p className="text-sm text-white/70">{loadingLabel}</p> : null}
          {activePuzzle?.type === "hidden_key" && activeView ? (
            <HiddenKeyPanel
              view={activeView as HiddenKeyPublicView}
              onReveal={() => onAttempt(activePuzzle.id, {})}
              feedback={feedback.hidden as HiddenKeyFeedback}
            />
          ) : null}
          {activePuzzle?.type === "code_lock" && activeView ? (
            <CodeLockPanel
              view={activeView as CodeLockPublicView}
              onAttempt={(code) => onAttempt(activePuzzle.id, { code })}
              feedback={feedback.code as CodeLockFeedback}
            />
          ) : null}
          {activePuzzle?.type === "simultaneous_plates" && activeView ? (
            <PlatesPanel
              view={activeView as SimultaneousPlatesPublicView}
              onTogglePlate={(objectId, active) => onTogglePlate(activePuzzle.id, objectId, active)}
              onPlaceBridge={() => onPlacePlatesBridge(activePuzzle.id)}
              feedback={feedback.plates as PlatesFeedback}
              getNow={platesGetNow}
            />
          ) : null}
          {activePuzzle?.type === "sliding_puzzle" && activeView ? (
            <SlidingPanel
              view={activeView as SlidingPuzzlePublicView}
              onMove={(move) => onAttempt(activePuzzle.id, { move })}
              baseUrl={pack?.baseUrl}
              feedback={feedback.sliding as SlidingFeedback}
            />
          ) : null}
          {activePuzzle?.type === "memory" && activeView ? (
            <MemoryPanel
              view={activeView as MemoryPublicView}
              onFlip={(flip) => onAttempt(activePuzzle.id, { flip })}
              feedback={feedback.memory as MemoryFeedback}
            />
          ) : null}
          {activePuzzle?.type === "split_clue" && activeView ? (
            <SplitCluePanel
              view={activeView as SplitCluePublicView}
              symbols={activePuzzle.symbols}
              onSubmit={(combination) =>
                onAttempt(
                  activePuzzle.id,
                  Array.isArray(combination) ? { symbols: combination } : { code: combination },
                )
              }
              onPlaceBridge={() => onPlaceMirror(activePuzzle.id)}
              feedback={feedback.split as SplitClueFeedback}
            />
          ) : null}
          {activePuzzle?.type === "pipes" && activeView ? (
            <PipesPanel
              view={activeView as PipesPuzzlePublicView}
              onRotate={(rotate) => onAttempt(activePuzzle.id, { rotate })}
              onOpenGate={(gate) => onAttempt(activePuzzle.id, { gate })}
              feedback={feedback.pipes as PipesFeedback}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
