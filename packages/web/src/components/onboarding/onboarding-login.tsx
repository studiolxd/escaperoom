"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error" };

/**
 * Login del wizard de onboarding (ticket 6.7, specs/20 §1 "Registro"): Google
 * o enlace mágico por email, igual que `ConsentLogin` (4.7) pero con destino
 * al propio wizard en vez del consentimiento del MCP.
 */
export function OnboardingLogin({ callbackURL }: { callbackURL: string }) {
  const t = useTranslations("Onboarding.loginRequired");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");

  const signInWithGoogle = async () => {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL }),
      });
      const json = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !json?.url) throw new Error("sin url");
      window.location.href = json.url;
    } catch {
      setState({ kind: "error" });
    }
  };

  const sendMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, callbackURL }),
      });
      setState(res.ok ? { kind: "sent" } : { kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground">
      <p className="text-sm">{t("intro")}</p>
      <Button type="button" onClick={signInWithGoogle} disabled={state.kind === "sending"}>
        {t("google")}
      </Button>
      <form onSubmit={sendMagicLink} className="space-y-2">
        <Label htmlFor="onboarding-login-email" className="text-sm">
          {t("emailLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="onboarding-login-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-auto min-w-0 flex-1 rounded-lg px-3 py-1.5 text-sm"
          />
          <Button type="submit" variant="outline" disabled={state.kind === "sending"}>
            {t("emailSubmit")}
          </Button>
        </div>
        {state.kind === "sent" && (
          <p role="status" className="text-xs text-emerald-600">
            {t("emailSent")}
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" className="text-xs text-destructive">
            {t("error")}
          </p>
        )}
      </form>
    </div>
  );
}
