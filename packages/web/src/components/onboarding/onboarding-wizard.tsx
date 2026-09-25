"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PlaytestButton } from "@/components/room-editor/playtest-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Link } from "@/i18n/navigation";
import { trackOnboardingStep } from "@/lib/analytics-client";

const STEP_IDS = ["theme", "firstRoom", "firstPuzzle", "playtest", "publish"] as const;
type StepId = (typeof STEP_IDS)[number];

type CreateState =
  { kind: "idle" } | { kind: "creating" } | { kind: "done"; roomId: string } | { kind: "error" };

/**
 * Wizard de onboarding del creador de 5 pasos (ticket 6.7, specs/20 §2): tema
 * → primera sala (plantilla del Rey Aldric o en blanco, specs/20 §3) → primer
 * puzzle guiado → playtest → publicar. Cada transición emite `onboarding_step`
 * (specs/16 §2.1, specs/20 §5). Los pasos 3–5 se apoyan en el editor real
 * (`/editor/:roomId`) en vez de reimplementar sus herramientas aquí.
 */
export function OnboardingWizard() {
  const t = useTranslations("Onboarding");
  const [stepIndex, setStepIndex] = useState(0);
  const [template, setTemplate] = useState<"rey-aldric" | "blank">("rey-aldric");
  const [create, setCreate] = useState<CreateState>({ kind: "idle" });

  const step: StepId = STEP_IDS[stepIndex] ?? "theme";

  useEffect(() => {
    trackOnboardingStep(step);
  }, [step]);

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEP_IDS.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const createRoom = async () => {
    setCreate({ kind: "creating" });
    try {
      const res = await fetch("/api/onboarding/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      if (!res.ok) throw new Error("create failed");
      const json = (await res.json()) as { roomId: string };
      setCreate({ kind: "done", roomId: json.roomId });
      goNext();
    } catch {
      setCreate({ kind: "error" });
    }
  };

  const roomId = create.kind === "done" ? create.roomId : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("progress", { step: stepIndex + 1 })}</p>

      <ol className="mt-4 flex flex-wrap gap-2 text-xs">
        {STEP_IDS.map((id, index) => (
          <li
            key={id}
            data-step={id}
            aria-current={id === step ? "step" : undefined}
            className={`rounded-full border px-3 py-1 ${
              index <= stepIndex
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {t(`stepLabels.${id}`)}
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-xl border border-border bg-card p-6 text-card-foreground">
        {step === "theme" && (
          <div className="space-y-4">
            <h2 className="font-semibold">{t("step1.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("step1.body")}</p>
            <div className="w-fit rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-sm text-primary">
              {t("step1.medievalLabel")}
            </div>
            <Button onClick={goNext}>{t("step1.cta")}</Button>
          </div>
        )}

        {step === "firstRoom" && (
          <div className="space-y-4">
            <h2 className="font-semibold">{t("step2.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("step2.body")}</p>
            <RadioGroup
              name="template"
              value={template}
              onValueChange={(value) => setTemplate(value as "rey-aldric" | "blank")}
              className="space-y-2"
            >
              <Label htmlFor="onboarding-template-rey-aldric" className="items-start text-sm font-normal">
                <RadioGroupItem
                  id="onboarding-template-rey-aldric"
                  value="rey-aldric"
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{t("step2.templateOption")}</span>
                  <br />
                  <span className="text-muted-foreground">{t("step2.templateDesc")}</span>
                </span>
              </Label>
              <Label htmlFor="onboarding-template-blank" className="items-start text-sm font-normal">
                <RadioGroupItem id="onboarding-template-blank" value="blank" className="mt-1" />
                <span>
                  <span className="font-medium">{t("step2.blankOption")}</span>
                  <br />
                  <span className="text-muted-foreground">{t("step2.blankDesc")}</span>
                </span>
              </Label>
            </RadioGroup>

            {create.kind !== "done" && (
              <Button onClick={createRoom} disabled={create.kind === "creating"}>
                {create.kind === "creating" ? t("step2.creating") : t("step2.cta")}
              </Button>
            )}
            {create.kind === "error" && (
              <p role="alert" className="text-sm text-destructive">
                {t("step2.error")}
              </p>
            )}
            {roomId && (
              <p className="text-sm">
                <Link
                  href={`/editor/${roomId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline"
                >
                  {t("step2.openEditor")}
                </Link>
              </p>
            )}
          </div>
        )}

        {step === "firstPuzzle" && (
          <div className="space-y-4">
            <h2 className="font-semibold">{t("step3.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("step3.body")}</p>
            <p className="text-sm text-amber-700">{t("step3.hint")}</p>
            {roomId && (
              <Link
                href={`/editor/${roomId}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary underline"
              >
                {t("step2.openEditor")}
              </Link>
            )}
            <div>
              <Button onClick={goNext}>{t("step3.cta")}</Button>
            </div>
          </div>
        )}

        {step === "playtest" && (
          <div className="space-y-4">
            <h2 className="font-semibold">{t("step4.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("step4.body")}</p>
            {roomId && <PlaytestButton roomId={roomId} />}
            <div>
              <Button onClick={goNext}>{t("step4.done")}</Button>
            </div>
          </div>
        )}

        {step === "publish" && (
          <div className="space-y-4">
            <h2 className="font-semibold">{t("step5.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("step5.body")}</p>
            {roomId && (
              <Link
                href={`/editor/${roomId}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary underline"
              >
                {t("step5.ctaOpenEditor")}
              </Link>
            )}
            <div>
              <Button variant="outline" asChild>
                <Link href="/rooms">{t("step5.ctaFinish")}</Link>
              </Button>
            </div>
          </div>
        )}

        {stepIndex > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <Button variant="ghost" onClick={goBack}>
              ← {t("back")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
