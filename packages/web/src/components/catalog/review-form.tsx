"use client";

import type { ReviewViewerState } from "@escaperoom/shared/services";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { upsertRoomReview } from "@/actions/reviews";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { StarRating } from "./star-rating";

type Status = "idle" | "created" | "updated" | "errorContent" | "errorGeneric";

/**
 * Zonas clicables del selector: la primera estrella es una única zona
 * (mínimo 1, no 0,5 — valores válidos {1, 1.5, …, 5}); las otras cuatro se
 * parten en mitad izquierda (medio punto) y mitad derecha (punto entero).
 */
const RATING_ZONES = [1, 2, 3, 4, 5].flatMap((star) =>
  star === 1
    ? [{ value: 1, width: "w-[20%]" }]
    : [
        { value: star - 0.5, width: "w-[10%]" },
        { value: star, width: "w-[10%]" },
      ],
);

/**
 * En sincronía con `REVIEW_TEXT_MAX_LENGTH`
 * (`@escaperoom/shared/services/reviews.ts`). No se importa el valor real:
 * el barrel `@escaperoom/shared/services` reexporta también servicios de
 * servidor (colas de BullMQ, etc.) que romperían el bundle de este
 * componente cliente.
 */
const REVIEW_TEXT_MAX_LENGTH = 2000;

function useReviewSchema() {
  const t = useTranslations("Reviews.errors");
  return z.object({
    rating: z.number().min(1, t("ratingRequired")),
    text: z.string().max(REVIEW_TEXT_MAX_LENGTH, t("textTooLong")),
  });
}

type ReviewFormValues = z.infer<ReturnType<typeof useReviewSchema>>;

/**
 * Formulario de reseña (crear o editar la propia: una por usuario y sala).
 * Server action `upsertRoomReview` (mismo `ReviewService` que la ruta REST) y
 * refresca el SSR para que la media, el recuento y la lista reflejen el
 * cambio.
 */
export function ReviewForm({ roomId, initial }: { roomId: string; initial: ReviewViewerState }) {
  const t = useTranslations("Reviews");
  const schema = useReviewSchema();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [hasReview, setHasReview] = useState(initial.review !== null);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReviewFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      rating: initial.review?.rating ?? 0,
      text: initial.review?.text ?? "",
    },
  });

  // Solo se puede reseñar una sala jugada: sin sesión, sin partida jugada o en
  // la propia sala no se muestra nada (ni el formulario ni un aviso previo).
  if (!initial.canReview) return null;

  const onSubmit = handleSubmit(async (values) => {
    setStatus("idle");
    const result = await upsertRoomReview(roomId, { rating: values.rating, text: values.text });
    if (result.ok) {
      setStatus(result.data.created ? "created" : "updated");
      setHasReview(true);
      router.refresh();
      return;
    }
    setStatus(result.error.code === "CONTENT_REJECTED" ? "errorContent" : "errorGeneric");
  });

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
    >
      <h3 className="font-semibold">{hasReview ? t("editHeading") : t("formHeading")}</h3>
      <Controller
        name="rating"
        control={control}
        render={({ field }) => (
          <Field data-invalid={!!errors.rating}>
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm">{t("ratingLabel")}</legend>
              <div className="relative inline-block w-fit text-2xl leading-none">
                <StarRating value={field.value} className="pointer-events-none" />
                <RadioGroup
                  name={field.name}
                  value={field.value > 0 ? String(field.value) : ""}
                  onValueChange={(value) => field.onChange(Number(value))}
                  className="absolute inset-0 flex flex-row"
                  aria-invalid={!!errors.rating}
                  aria-describedby={errors.rating ? "review-rating-error" : undefined}
                >
                  {RATING_ZONES.map(({ value, width }) => (
                    <Label
                      key={value}
                      htmlFor={`review-rating-${value}`}
                      className={`block h-full cursor-pointer ${width}`}
                    >
                      <RadioGroupItem
                        id={`review-rating-${value}`}
                        value={String(value)}
                        className="sr-only"
                      />
                      <span className="sr-only">{t("ratingOption", { n: value })}</span>
                    </Label>
                  ))}
                </RadioGroup>
              </div>
            </fieldset>
            <FieldError id="review-rating-error" errors={[errors.rating]} />
          </Field>
        )}
      />
      <Field data-invalid={!!errors.text}>
        <FieldLabel htmlFor="review-text">{t("textLabel")}</FieldLabel>
        <Textarea
          id="review-text"
          rows={4}
          aria-invalid={!!errors.text}
          aria-describedby={errors.text ? "review-text-error" : undefined}
          {...register("text")}
        />
        <FieldError id="review-text-error" errors={[errors.text]} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : hasReview ? t("update") : t("submit")}
        </Button>
        {status !== "idle" ? (
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
