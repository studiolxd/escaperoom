"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { setRoomPlayers } from "@escaperoom/editor";
import { MAX_PLAYERS_PER_ROOM_CEILING } from "@escaperoom/shared/schemas";
import type * as Y from "yjs";
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

/**
 * Ajustes de jugadores de la sala (`meta.players.min/max`, techo real
 * `MAX_PLAYERS_PER_ROOM_CEILING`). Único punto del editor donde se cambia el
 * rango tras crear la sala: el validador (panel de la derecha) recalcula
 * `solo_bridge_missing` con el nuevo rango en la siguiente pasada y avisa si
 * alguna prueba ya colocada exige más jugadores de los que admite.
 */
export function RoomPlayersDialog({
  doc,
  players,
}: {
  doc: Y.Doc;
  players: { min: number; max: number };
}) {
  const t = useTranslations("RoomEditor.players");
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(String(players.min));
  const [max, setMax] = useState(String(players.max));
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    if (next) {
      setMin(String(players.min));
      setMax(String(players.max));
      setError(null);
    }
    setOpen(next);
  }

  function onSave() {
    const minValue = Number(min);
    const maxValue = Number(max);
    if (
      !Number.isInteger(minValue) ||
      !Number.isInteger(maxValue) ||
      minValue < 1 ||
      maxValue < 1 ||
      minValue > MAX_PLAYERS_PER_ROOM_CEILING ||
      maxValue > MAX_PLAYERS_PER_ROOM_CEILING
    ) {
      setError(t("errorRange", { ceiling: MAX_PLAYERS_PER_ROOM_CEILING }));
      return;
    }
    if (minValue > maxValue) {
      setError(t("errorOrder"));
      return;
    }
    setRoomPlayers(doc, { min: minValue, max: maxValue });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="border border-white/15 text-white hover:bg-white/10"
        >
          {t("button")} ({players.min}–{players.max})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { ceiling: MAX_PLAYERS_PER_ROOM_CEILING })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <Label htmlFor="room-players-min">{t("min")}</Label>
            <Input
              id="room-players-min"
              type="number"
              min={1}
              max={MAX_PLAYERS_PER_ROOM_CEILING}
              value={min}
              onChange={(event) => setMin(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <Label htmlFor="room-players-max">{t("max")}</Label>
            <Input
              id="room-players-max"
              type="number"
              min={1}
              max={MAX_PLAYERS_PER_ROOM_CEILING}
              value={max}
              onChange={(event) => setMax(event.target.value)}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={onSave}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
