"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { setRoomTimeLimit } from "@escaperoom/editor";
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
import { Switch } from "@/components/ui/switch";

/**
 * Duración de partida de la sala (`meta.timeLimitMinutes`, ticket
 * duración-salas, specs/04 §6): opcional, sin tope máximo, marcable como
 * "sin duración". El servidor es siempre quien la aplica, nunca el cliente
 * — este ajuste solo declara el valor guardado en la sala.
 */
export function RoomTimeLimitDialog({
  doc,
  timeLimitMinutes,
}: {
  doc: Y.Doc;
  timeLimitMinutes: number | null | undefined;
}) {
  const t = useTranslations("RoomEditor.duration");
  const [open, setOpen] = useState(false);
  const initialUnlimited = timeLimitMinutes === null;
  const [unlimited, setUnlimited] = useState(initialUnlimited);
  const [minutes, setMinutes] = useState(String(timeLimitMinutes ?? 60));
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    if (next) {
      setUnlimited(timeLimitMinutes === null);
      setMinutes(String(timeLimitMinutes ?? 60));
      setError(null);
    }
    setOpen(next);
  }

  function onSave() {
    if (unlimited) {
      setRoomTimeLimit(doc, null);
      setOpen(false);
      return;
    }
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < 1) {
      setError(t("errorInvalid"));
      return;
    }
    setRoomTimeLimit(doc, value);
    setOpen(false);
  }

  const buttonLabel =
    timeLimitMinutes === null ? t("buttonUnlimited") : t("button", { minutes: timeLimitMinutes ?? 60 });

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
          <Label htmlFor="room-duration-unlimited">{t("unlimited")}</Label>
          <Switch
            id="room-duration-unlimited"
            checked={unlimited}
            onCheckedChange={(checked) => setUnlimited(checked === true)}
          />
        </div>
        {!unlimited && (
          <div className="flex flex-col gap-1 text-sm">
            <Label htmlFor="room-duration-minutes">{t("minutes")}</Label>
            <Input
              id="room-duration-minutes"
              type="number"
              min={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
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
          <Button onClick={onSave}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
