"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { eventPlayPath } from "@/lib/game-net";

/** Códigos de error de `POST /api/access-keys/redeem` con mensaje propio. */
const KNOWN_ERRORS = new Set([
  "ACCESS_KEY_INVALID",
  "ACCESS_KEY_USED",
  "ACCESS_KEY_EXPIRED",
  "ACCESS_KEY_NOT_CONFIRMED",
  "SESSION_FULL",
  "SESSION_REQUIRED",
  "RATE_LIMITED",
  "REDEEM_UNAVAILABLE",
]);

type State = { kind: "idle" } | { kind: "redeeming" } | { kind: "error"; code: string };

export interface RedeemFormProps {
  /** Clave que trae el QR (`?code=`); el asistente también puede teclearla. */
  initialCode: string;
}

/**
 * Formulario de canje: clave + nombre visible → `POST /api/access-keys/redeem`
 * → la partida de la sesión asignada (`/play?session=…#joinToken=…`). El
 * `joinToken` viaja en el fragmento para que no llegue a logs ni a `Referer`.
 */
export function RedeemForm({ initialCode }: RedeemFormProps) {
  const t = useTranslations("Redeem");
  const locale = useLocale();
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const redeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ kind: "redeeming" });
    try {
      const res = await fetch("/api/access-keys/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          ...(name.trim() ? { displayName: name.trim() } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        sessionId?: string;
        joinToken?: string;
        error?: { code?: string };
      } | null;
      if (!res.ok || !json?.sessionId || !json.joinToken) {
        setState({ kind: "error", code: json?.error?.code ?? "UNKNOWN" });
        return;
      }
      window.location.assign(`/${locale}${eventPlayPath(json.sessionId, json.joinToken)}`);
    } catch {
      setState({ kind: "error", code: "UNKNOWN" });
    }
  };

  return (
    <form className="space-y-3" onSubmit={(event) => void redeem(event)}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-white/80">{t("codeLabel")}</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 font-mono text-base uppercase tracking-widest text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-white/80">{t("nameLabel")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={32}
          placeholder={t("namePlaceholder")}
          className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        />
      </label>
      <Button type="submit" variant="overlay" disabled={state.kind === "redeeming"}>
        {state.kind === "redeeming" ? t("redeeming") : t("cta")}
      </Button>
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-red-300">
          {KNOWN_ERRORS.has(state.code) ? t(`errors.${state.code}`) : t("errors.UNKNOWN")}
        </p>
      ) : null}
    </form>
  );
}
