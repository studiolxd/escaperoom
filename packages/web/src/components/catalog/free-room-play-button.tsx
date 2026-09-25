"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { roomGamePlayPath } from "@/lib/game-net";

type State = "idle" | "loading" | "error";

type FreeAccess = { eligible: true; gameToken: string } | { eligible: false };

/**
 * "Jugar gratis" de la ficha de sala (punto i, "CTA Jugar", `docs/DEUDA.md`):
 * sin cuenta. `GET /api/rooms/:roomId/free-access` (rate-limitado por IP,
 * `free-room-play`) emite el `gameToken` `kind: "free"`; con él, navega a
 * `/play/room/:roomId` (el token viaja en el fragmento, nunca al servidor).
 */
export function FreeRoomPlayButton({ roomId }: { roomId: string }) {
  const t = useTranslations("RoomDetail");
  const [state, setState] = useState<State>("idle");

  const startFreeGame = async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/rooms/${roomId}/free-access`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as FreeAccess | null;
      if (!res.ok || !json?.eligible) throw new Error("sala no elegible");
      window.location.href = roomGamePlayPath(roomId, json.gameToken);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" className="w-fit" onClick={startFreeGame} disabled={state === "loading"}>
        {state === "loading" && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
        {t("playFreeCta")}
      </Button>
      {state === "error" && <p className="text-sm text-destructive">{t("freeError")}</p>}
    </div>
  );
}
