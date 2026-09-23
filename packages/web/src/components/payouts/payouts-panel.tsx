"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type ConnectStatus = "not_started" | "pending" | "complete";
type State =
  | { kind: "loading" }
  | { kind: "ready"; status: ConnectStatus }
  | { kind: "error" };
type ActionState = "idle" | "onboarding" | "dashboard";

const STATUS_VARIANT: Record<ConnectStatus, "secondary" | "outline" | "default"> = {
  not_started: "secondary",
  pending: "outline",
  complete: "default",
};

async function readUrl(res: Response): Promise<string | null> {
  const json = (await res.json().catch(() => null)) as { url?: string } | null;
  return res.ok && json?.url ? json.url : null;
}

/**
 * Panel de cobros del creador (ticket 5.1, specs/02 §2, specs/13 §2): estado
 * en vivo de la cuenta Connect Express `recipient` y el CTA que corresponde
 * — iniciar/continuar el onboarding, o abrir el dashboard Express si ya
 * está completo. El estado nunca se cachea aquí: se relee en cada visita.
 */
export function PayoutsPanel() {
  const t = useTranslations("Payouts");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [action, setAction] = useState<ActionState>("idle");
  const [actionError, setActionError] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/me/stripe-connect/status", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { status?: ConnectStatus } | null;
      if (!res.ok || !json?.status) throw new Error("sin estado");
      setState({ kind: "ready", status: json.status });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startOnboarding = async () => {
    setAction("onboarding");
    setActionError(false);
    try {
      const res = await fetch("/api/me/stripe-connect", { method: "POST" });
      const url = await readUrl(res);
      if (!url) throw new Error("sin url");
      window.location.href = url;
    } catch {
      setActionError(true);
      setAction("idle");
    }
  };

  const openDashboard = async () => {
    setAction("dashboard");
    setActionError(false);
    try {
      const res = await fetch("/api/me/stripe-connect/dashboard", { cache: "no-store" });
      const url = await readUrl(res);
      if (!url) throw new Error("sin url");
      window.location.href = url;
    } catch {
      setActionError(true);
      setAction("idle");
    }
  };

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.kind === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("loading")}
          </p>
        )}
        {state.kind === "error" && <p className="text-sm text-destructive">{t("loadError")}</p>}
        {state.kind === "ready" && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("statusLabel")}</span>
            <Badge variant={STATUS_VARIANT[state.status]}>{t(`status.${state.status}`)}</Badge>
          </div>
        )}
        {actionError && <p className="text-sm text-destructive">{t("actionError")}</p>}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        {state.kind === "ready" && state.status !== "complete" && (
          <Button onClick={startOnboarding} disabled={action !== "idle"}>
            {action === "onboarding" && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            {t(state.status === "not_started" ? "startOnboarding" : "continueOnboarding")}
          </Button>
        )}
        {state.kind === "ready" && state.status === "complete" && (
          <Button onClick={openDashboard} disabled={action !== "idle"}>
            {action === "dashboard" && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            {t("openDashboard")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
