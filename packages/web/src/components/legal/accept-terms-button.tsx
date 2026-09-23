"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "error" };

/**
 * Botón de aceptación de la pantalla de reaceptación de términos
 * (`/legal/reaccept`): registra la aceptación vía `POST
 * /api/legal/terms-acceptance` y, al confirmarse, navega a `next`.
 */
export function AcceptTermsButton({ next }: { next: string }) {
  const t = useTranslations("Legal.reaccept");
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  const accept = async () => {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/legal/terms-acceptance", { method: "POST" });
      if (!res.ok) throw new Error("fallo al aceptar");
      router.replace(next);
      router.refresh();
    } catch {
      setState({ kind: "error" });
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" onClick={accept} disabled={state.kind === "sending"}>
        {t("accept")}
      </Button>
      {state.kind === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {t("error")}
        </p>
      )}
    </div>
  );
}
