"use client";

import { useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

type State = "idle" | "loading" | "error";
type ButtonSize = VariantProps<typeof buttonVariants>["size"];

/**
 * "Comprar" de la ficha de sala (punto b, "CTA Jugar", `docs/DEUDA.md`):
 * `POST /api/purchases/room-checkout` → redirige a `checkoutUrl` (patrón de
 * `payouts-panel.tsx`, adaptado al campo `checkoutUrl` en vez de `url`).
 */
export function BuyRoomButton({
  roomVersionId,
  size = "lg",
}: {
  roomVersionId: string;
  size?: ButtonSize;
}) {
  const t = useTranslations("RoomDetail");
  const [state, setState] = useState<State>("idle");

  const startCheckout = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/purchases/room-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomVersionId }),
      });
      const json = (await res.json().catch(() => null)) as { checkoutUrl?: string } | null;
      if (!res.ok || !json?.checkoutUrl) throw new Error("sin checkoutUrl");
      window.location.href = json.checkoutUrl;
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button size={size} className="w-fit" onClick={startCheckout} disabled={state === "loading"}>
        {state === "loading" && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
        {t("buyCta")}
      </Button>
      {state === "error" && <p className="text-sm text-destructive">{t("buyError")}</p>}
    </div>
  );
}
