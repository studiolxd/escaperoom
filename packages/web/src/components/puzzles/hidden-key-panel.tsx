"use client";

import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { HiddenKeyPublicView } from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";

/** Resultado del último reveal, tal como lo devolvió el servidor. */
export type HiddenKeyFeedback = "revealed" | "already_revealed" | "unavailable" | null;

export interface HiddenKeyPanelProps {
  /** Única fuente de verdad del panel: la proyección pública (sin el objeto antes del reveal). */
  view: HiddenKeyPublicView;
  /** Envía el reveal al servidor; nunca se resuelve aquí. */
  onReveal: () => void;
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Último resultado del servidor para pintar el feedback. */
  feedback?: HiddenKeyFeedback;
}

/**
 * Panel de inspección del `hidden_key` (specs/06 §2.1). Es puramente
 * presentacional: solo lee `HiddenKeyPublicView` y delega el reveal en
 * `onReveal`. La validación y la entrega del objeto viven en
 * `@escaperoom/shared/templates` (servidor). `revealAnimation` se expone como
 * dato (`data-animation`) para que la capa visual/Phaser lo reproduzca.
 */
export function HiddenKeyPanel({
  view,
  onReveal,
  pending = false,
  feedback = null,
}: HiddenKeyPanelProps) {
  const t = useTranslations("HiddenKey");
  const revealed = view.revealed;
  const unavailable = view.state === "locked" || view.state === "failed";
  const disabled = revealed || unavailable || pending;

  let status = t("spot");
  if (revealed) status = t("revealed", { item: view.itemId ?? "?" });
  else if (view.state === "locked") status = t("locked");
  else if (view.state === "failed") status = t("unavailable");
  else if (feedback === "already_revealed") status = t("alreadyRevealed");
  else if (feedback === "unavailable") status = t("unavailable");

  return (
    <section
      aria-label={t("title")}
      data-state={view.state}
      data-animation={view.revealAnimation}
      className="flex w-fit flex-col gap-4 rounded-xl border border-white/10 bg-black/60 p-4 text-white backdrop-blur"
    >
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p className="text-xs text-white/60">{t("spot")}</p>
      </header>

      <div
        data-slot="hidden-key-reveal"
        data-animation={view.revealAnimation}
        className={cn(
          "grid h-16 place-items-center rounded-md border text-center text-sm",
          revealed
            ? "border-amber-300/60 bg-amber-300/10 text-amber-100"
            : "border-white/15 bg-white/5 text-white/40",
        )}
      >
        {revealed ? (view.itemId ?? "?") : t("hidden")}
      </div>

      <Button disabled={disabled} onClick={onReveal}>
        {pending ? t("pending") : t("reveal")}
      </Button>

      <p
        aria-live="polite"
        data-tone={revealed ? "success" : unavailable ? "locked" : "info"}
        className={cn(
          "text-center text-xs",
          revealed ? "text-emerald-300" : unavailable ? "text-amber-300" : "text-white/60",
        )}
      >
        {status}
      </p>
    </section>
  );
}
