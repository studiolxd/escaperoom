"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateEventTimeLimit } from "@/actions/events";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Duración de partida de ESTE evento (specs/02 §7, ticket duración-salas): el
 * organizador puede fijar cualquier duración (más corta, más larga o sin
 * límite) por encima de la de la sala. Solo editable mientras el evento está
 * en `draft` (`EventDashboardView` no la muestra si no). El servidor avisa
 * (no bloquea) si el override queda por debajo del `estimatedMinutes` de la
 * sala.
 */
export function EventTimeLimitDialog({
  eventId,
  timeLimitMinutes,
  onSaved,
}: {
  eventId: string;
  timeLimitMinutes: number | null | undefined;
  onSaved: (timeLimitMinutes: number | null | undefined) => void;
}) {
  const t = useTranslations("EventPanel.duration");
  const [open, setOpen] = useState(false);
  const [unlimited, setUnlimited] = useState(timeLimitMinutes === null);
  const [minutes, setMinutes] = useState(String(timeLimitMinutes ?? 60));
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const [saving, setSaving] = useState(false);

  function onOpenChange(next: boolean) {
    if (next) {
      setUnlimited(timeLimitMinutes === null);
      setMinutes(String(timeLimitMinutes ?? 60));
      setError(null);
      setWarning(false);
    }
    setOpen(next);
  }

  async function onSave() {
    let value: number | null = null;
    if (!unlimited) {
      value = Number(minutes);
      if (!Number.isInteger(value) || value < 1) {
        setError(t("errorInvalid"));
        return;
      }
    }
    setSaving(true);
    setError(null);
    const result = await updateEventTimeLimit(eventId, value);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSaved(result.data.timeLimitMinutes);
    if (result.data.timeLimitBelowEstimate) {
      setWarning(true);
      return;
    }
    setOpen(false);
  }

  const buttonLabel =
    timeLimitMinutes === undefined
      ? t("buttonDefault")
      : timeLimitMinutes === null
        ? t("buttonUnlimited")
        : t("button", { minutes: timeLimitMinutes });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="border border-white/15 text-white hover:bg-white/10"
        >
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="event-duration-unlimited">{t("unlimited")}</Label>
          <Switch
            id="event-duration-unlimited"
            checked={unlimited}
            onCheckedChange={(checked) => setUnlimited(checked === true)}
          />
        </div>
        {!unlimited && (
          <div className="flex flex-col gap-1 text-sm">
            <Label htmlFor="event-duration-minutes">{t("minutes")}</Label>
            <Input
              id="event-duration-minutes"
              type="number"
              min={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
        )}
        {warning && (
          <p role="alert" className="text-sm text-amber-600">
            {t("warningBelowEstimate")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
