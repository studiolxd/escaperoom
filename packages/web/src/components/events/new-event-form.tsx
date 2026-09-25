"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

type PricingSnapshot = {
  tiers: Array<{ minPlayers: number; maxPlayers: number | null; priceCentsPerPlayer: number; currency: string }>;
};

type State = "idle" | "loading" | "error";

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
  const format = useFormatter();
  const router = useRouter();
  const [tiers, setTiers] = useState<PricingSnapshot["tiers"] | null>(null);
  const [title, setTitle] = useState("");
  const [players, setPlayers] = useState(10);
  const [state, setState] = useState<State>("idle");

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("loading");
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomVersionId,
          title,
          playersPlanned: players,
          maxSimultaneousSessions: 1,
          groupingMode: "free",
          requireConfirmation: false,
          expiryRules: [],
          audience: "general",
        }),
      });
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      if (!res.ok || !json?.id) throw new Error("sin id");
      router.push(`/events/${json.id}`);
    } catch {
      setState("error");
    }
  };

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-event-title">{t("titleLabel")}</Label>
        <Input
          id="new-event-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-event-players">{t("playersLabel")}</Label>
        <Input
          id="new-event-players"
          type="number"
          min={1}
          max={10000}
          value={players}
          onChange={(e) => setPlayers(Number(e.target.value) || 1)}
          required
        />
      </div>
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
      {state === "error" && <p className="text-sm text-destructive">{t("submitError")}</p>}
      <Button type="submit" disabled={state === "loading"} className="w-fit">
        {state === "loading" && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
        {t("submit")}
      </Button>
    </form>
  );
}
