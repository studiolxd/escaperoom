"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error" };

/**
 * Waitlist de la landing pública (ticket 6.7, specs/25 §2.1): captura el
 * email antes de que exista producto jugable. Sin autenticación: `POST
 * /api/waitlist` acepta cualquier visitante.
 */
export function WaitlistForm({ source = "landing-hero" }: { source?: string }) {
  const t = useTranslations("Landing.waitlist");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [created, setCreated] = useState(true);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale, source }),
      });
      if (!res.ok) throw new Error("waitlist join failed");
      const json = (await res.json()) as { created: boolean };
      setCreated(json.created);
      setState({ kind: "sent" });
    } catch {
      setState({ kind: "error" });
    }
  };

  if (state.kind === "sent") {
    return (
      <p role="status" className="text-sm text-emerald-200">
        {created ? t("success") : t("alreadyIn")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="waitlist-email">
        {t("emailLabel")}
      </label>
      <input
        id="waitlist-email"
        type="email"
        required
        placeholder={t("emailLabel")}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50"
      />
      <Button type="submit" variant="overlay" disabled={state.kind === "sending"}>
        {state.kind === "sending" ? t("sending") : t("submit")}
      </Button>
      {state.kind === "error" && (
        <p role="alert" className="text-xs text-red-300 sm:basis-full">
          {t("error")}
        </p>
      )}
    </form>
  );
}
