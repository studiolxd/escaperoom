"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { setAllGroupsStartTogether } from "@/actions/events";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * "Todos los grupos comienzan juntos" (ticket "inicio conjunto"): ajuste del
 * evento, apagado por defecto. Editable mientras ningún grupo del evento haya
 * empezado a jugar — `anyGroupStarted` lo decide `EventDashboardView` a
 * partir de `dashboard.rows` (sin depender de una consulta aparte).
 */
export function AllGroupsStartTogetherToggle({
  eventId,
  enabled,
  anyGroupStarted,
  onChanged,
}: {
  eventId: string;
  enabled: boolean;
  anyGroupStarted: boolean;
  onChanged: (enabled: boolean) => void;
}) {
  const t = useTranslations("EventPanel.allGroupsStart");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCheckedChange(next: boolean) {
    setSaving(true);
    setError(null);
    const result = await setAllGroupsStartTogether(eventId, next);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onChanged(result.data.allGroupsStartTogether);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Switch
          id="event-all-groups-start-together"
          checked={enabled}
          disabled={saving || anyGroupStarted}
          onCheckedChange={(checked) => void onCheckedChange(checked === true)}
        />
        <Label htmlFor="event-all-groups-start-together" className="text-sm text-white/80">
          {t("label")}
        </Label>
      </div>
      {anyGroupStarted ? (
        <p className="text-xs text-white/50">{t("lockedHint")}</p>
      ) : (
        <p className="text-xs text-white/50">{t("hint")}</p>
      )}
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
