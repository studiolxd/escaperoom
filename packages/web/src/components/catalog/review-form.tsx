"use client";

import type { ReviewViewerState } from "@escaperoom/shared/services";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

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

  if (!initial.canReview) {
    const key =
      initial.reason === "anonymous"
        ? "anonymous"
        : initial.reason === "own_room"
          ? "ownRoom"
          : "notPlayed";
    return <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{t(key)}</p>;
  }

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
        <div className="flex gap-1" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer text-2xl leading-none">
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
                required
              />
              <span
                aria-hidden="true"
                className={n <= rating ? "text-amber-500" : "text-muted-foreground/40"}
              >
                ★
              </span>
              <span className="sr-only">{t("star", { n })}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        {t("textLabel")}
        <textarea
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          rows={4}
          className="rounded-lg border border-input bg-background p-2 text-sm"
        />
      </label>
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
