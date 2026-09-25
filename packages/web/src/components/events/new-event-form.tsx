"use client";

import { useEffect, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { createMinimalEvent } from "@/actions/events";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";

type PricingSnapshot = {
  tiers: Array<{ minPlayers: number; maxPlayers: number | null; priceCentsPerPlayer: number; currency: string }>;
};

/** Límites en sincronía con `CreateEventInput` (`@escaperoom/shared/services/events.ts`). */
function useNewEventSchema() {
  const t = useTranslations("NewEvent.errors");
  return z.object({
    title: z.string().trim().min(1, t("titleRequired")).max(200, t("titleTooLong")),
    players: z
      .number(t("playersInvalid"))
      .int(t("playersInvalid"))
      .min(1, t("playersInvalid"))
      .max(100_000, t("playersTooMany")),
  });
}

type NewEventFormValues = z.infer<ReturnType<typeof useNewEventSchema>>;

/**
 * Flujo MÍNIMO de "Organizar un evento con esta sala" (punto h de "CTA
 * Jugar", `docs/DEUDA.md`): título + jugadores planeados, con el precio por
 * jugador VISIBLE (tramos vigentes, `GET /api/pricing-tiers/current`) antes
 * de pagar. El resto de la configuración (sesiones simultáneas, agrupación,
 * confirmación, caducidad de claves) queda con los valores por defecto más
 * simples y se ajusta después en el panel del organizador ya existente
 * (`/events/:id`) — construir aquí el asistente completo de specs/02 §3 es
 * una tarea mayor que excede el CTA de la ficha de sala.
 */
export function NewEventForm({ roomVersionId }: { roomVersionId: string }) {
  const t = useTranslations("NewEvent");
  const schema = useNewEventSchema();
  const format = useFormatter();
  const router = useRouter();
  const [tiers, setTiers] = useState<PricingSnapshot["tiers"] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewEventFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", players: 10 },
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pricing-tiers/current", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<PricingSnapshot>) : null))
      .then((snapshot) => {
        if (!cancelled) setTiers(snapshot?.tiers ?? []);
      })
      .catch(() => {
        if (!cancelled) setTiers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await createMinimalEvent({
      roomVersionId,
      title: values.title,
      playersPlanned: values.players,
    });
    if (!result.ok) {
      setFormError(t("submitError"));
      return;
    }
    router.push(`/events/${result.data.id}`);
  });

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4" noValidate>
      <Field data-invalid={!!errors.title}>
        <FieldLabel htmlFor="new-event-title">{t("titleLabel")}</FieldLabel>
        <Input
          id="new-event-title"
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? "new-event-title-error" : undefined}
          {...register("title")}
        />
        <FieldError id="new-event-title-error" errors={[errors.title]} />
      </Field>
      <Field data-invalid={!!errors.players}>
        <FieldLabel htmlFor="new-event-players">{t("playersLabel")}</FieldLabel>
        <Input
          id="new-event-players"
          type="number"
          aria-invalid={!!errors.players}
          aria-describedby={errors.players ? "new-event-players-error" : undefined}
          {...register("players", { valueAsNumber: true })}
        />
        <FieldError id="new-event-players-error" errors={[errors.players]} />
      </Field>
      <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3 text-sm">
        <p className="font-medium">{t("pricingTitle")}</p>
        {tiers === null ? (
          <p className="text-muted-foreground">{t("pricingLoading")}</p>
        ) : tiers.length === 0 ? (
          <p className="text-muted-foreground">{t("pricingUnavailable")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {tiers.map((tier) => (
              <li key={`${tier.minPlayers}-${tier.maxPlayers ?? "∞"}`}>
                {tier.maxPlayers === null
                  ? t("pricingRangeOpen", { min: tier.minPlayers })
                  : t("pricingRangeCapped", { min: tier.minPlayers, max: tier.maxPlayers })}{" "}
                {format.number(tier.priceCentsPerPlayer / 100, {
                  style: "currency",
                  currency: tier.currency,
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting} className="w-fit">
        {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
        {t("submit")}
      </Button>
    </form>
  );
}
