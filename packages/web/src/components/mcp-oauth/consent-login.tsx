"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error" };

export interface ConsentLoginProps {
  /** Ruta a la que vuelve Better Auth tras el login (el propio consentimiento). */
  callbackURL: string;
}

/**
 * Login con Better Auth dentro del consentimiento OAuth del MCP (ticket 4.7):
 * Google o enlace mágico por email (los métodos de `lib/auth.ts`). Al volver,
 * la pantalla ya tiene sesión y muestra el formulario de consentimiento.
 */
export function ConsentLogin({ callbackURL }: ConsentLoginProps) {
  const t = useTranslations("McpConsent.login");
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
    <div className="space-y-4">
      <p className="text-sm text-white/80">{t("intro")}</p>
      <Button
        type="button"
        variant="overlay"
        onClick={signInWithGoogle}
        disabled={state.kind === "sending"}
      >
        {t("google")}
      </Button>
      <form onSubmit={sendMagicLink} className="space-y-2">
        <label className="block text-sm" htmlFor="mcp-consent-email">
          {t("emailLabel")}
        </label>
        <div className="flex gap-2">
          <input
            id="mcp-consent-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white"
          />
          <Button type="submit" disabled={state.kind === "sending"}>
            {t("emailSubmit")}
          </Button>
        </div>
      </form>
      {state.kind === "sent" && (
        <p role="status" className="text-sm text-emerald-300">
          {t("emailSent")}
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-red-300">
          {t("error")}
        </p>
      )}
    </div>
  );
}
