import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface DialogButtonProps {
  dialog: { id: string; text: string } | null;
  isIntro: boolean;
  onClose: () => void;
  introLabel: string;
  dialogLabel: string;
  closeLabel: string;
}

/** Diálogo de inspección: un `Button` simple (no shadcn `Dialog`) que se cierra con ESC/clic. */
export function DialogButton({
  dialog,
  isIntro,
  onClose,
  introLabel,
  dialogLabel,
  closeLabel,
}: DialogButtonProps) {
  if (!dialog) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      data-testid="game-dialog"
      data-intro={isIntro}
      onClick={onClose}
      className="absolute inset-x-4 bottom-40 z-30 mx-auto block h-auto max-w-2xl cursor-pointer rounded-xl border border-amber-500/40 bg-card/75 px-5 py-4 text-left text-sm whitespace-normal shadow-lg backdrop-blur dark:border-amber-200/40"
    >
      <span className="block text-[0.65rem] uppercase tracking-wide text-amber-700 dark:text-amber-200/70">
        {isIntro ? introLabel : dialogLabel}
      </span>
      {dialog.text}
      <span className="mt-1 block text-[0.65rem] text-muted-foreground">{closeLabel}</span>
    </Button>
  );
}

export interface ImageDialogProps {
  imagePanel: { image: string; caption?: string } | null;
  pack?: RoomScenePack;
  onOpenChange: (open: boolean) => void;
  inspectImageLabel: string;
}

export function ImageDialog({
  imagePanel,
  pack,
  onOpenChange,
  inspectImageLabel,
}: ImageDialogProps) {
  return (
    <Dialog open={imagePanel !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        data-testid="game-image-panel"
        className="flex w-[min(92vw,40rem)] max-w-none flex-col items-center gap-3 rounded-2xl border-amber-500/30 p-5 text-center shadow-2xl dark:border-amber-200/30"
      >
        <DialogTitle className="sr-only">{inspectImageLabel}</DialogTitle>
        <DialogDescription className="sr-only">
          {imagePanel?.caption ?? inspectImageLabel}
        </DialogDescription>
        {imagePanel && pack ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen de inspección servida por el pack, fuera de next/image
          <img
            src={`${pack.baseUrl.replace(/\/$/, "")}/inspect/${imagePanel.image}.png`}
            alt={imagePanel.caption ?? ""}
            className="max-h-[70vh] w-auto max-w-full rounded-lg border border-border object-contain"
          />
        ) : null}
        {imagePanel?.caption ? <p className="text-sm text-muted-foreground">{imagePanel.caption}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
