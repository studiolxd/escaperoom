"use client";

import type { ReviewViewerState } from "@escaperoom/shared/services";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

type Status = "idle" | "saving" | "created" | "updated" | "errorContent" | "errorGeneric";

/**
 * Formulario de reseña (crear o editar la propia: una por usuario y sala).
 * Envía a `POST /api/rooms/:roomId/reviews` y refresca el SSR para que la
 * media, el recuento y la lista reflejen el cambio.
 */
export function ReviewForm({ roomId, initial }: { roomId: string; initial: ReviewViewerState }) {
  const t = useTranslations("Reviews");
  const router = useRouter();
  const [rating, setRating] = useState(initial.review?.rating ?? 0);
  const [text, setText] = useState(initial.review?.text ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [hasReview, setHasReview] = useState(initial.review !== null);

  // Solo se puede reseñar una sala jugada: sin sesión, sin partida jugada o en
  // la propia sala no se muestra nada (ni el formulario ni un aviso previo).
  if (!initial.canReview) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating < 1) return;
    setStatus("saving");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, text }),
      });
      if (response.ok) {
        setStatus(response.status === 201 ? "created" : "updated");
        setHasReview(true);
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setStatus(body?.error?.code === "CONTENT_REJECTED" ? "errorContent" : "errorGeneric");
    } catch {
      setStatus("errorGeneric");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <h3 className="font-semibold">{hasReview ? t("editHeading") : t("formHeading")}</h3>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm">{t("ratingLabel")}</legend>
        <RadioGroup
          name="rating"
          value={rating > 0 ? String(rating) : ""}
          onValueChange={(value) => setRating(Number(value))}
          className="flex w-fit flex-row gap-1"
          required
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Label
              key={n}
              htmlFor={`review-rating-${n}`}
              className="cursor-pointer text-2xl leading-none font-normal"
            >
              <RadioGroupItem id={`review-rating-${n}`} value={String(n)} className="sr-only" />
              <span
                aria-hidden="true"
                className={n <= rating ? "text-amber-500" : "text-muted-foreground/40"}
              >
                ★
              </span>
              <span className="sr-only">{t("star", { n })}</span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <Label className="flex flex-col items-start gap-1 text-sm">
        {t("textLabel")}
        <Textarea
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          rows={4}
        />
      </Label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={status === "saving" || rating < 1}>
          {status === "saving" ? t("saving") : hasReview ? t("update") : t("submit")}
        </Button>
        {status !== "idle" && status !== "saving" ? (
          <p
            role={status.startsWith("error") ? "alert" : "status"}
            className={status.startsWith("error") ? "text-sm text-destructive" : "text-sm"}
          >
            {t(status)}
          </p>
        ) : null}
      </div>
    </form>
  );
}
