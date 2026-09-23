"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { RoomPlaytestResponse } from "@/server/rest/room-playtest";

/** Códigos de error de `POST /api/rooms/:roomId/playtest` con mensaje propio. */
const KNOWN_ERRORS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_DRAFT",
  "PLAYTEST_UNPLAYABLE",
  "PLAYTEST_DISABLED",
  "PLAYTEST_UNAVAILABLE",
]);

type State =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "ready"; url: string; expiresAt: string; copied: boolean }
  | { kind: "error"; code: string };

export interface PlaytestButtonProps {
  roomId: string;
  /** Borrador local (demo sin servidor): no hay draft que jugar. */
  disabled?: boolean;
}

/**
 * «Jugar» (ticket 3.8, specs/09 §3): pide al servidor una partida de prueba
 * con el borrador guardado, la abre en otra pestaña y deja a mano el link de
 * prueba para compartirlo. El navegador no envía el paquete: el servidor lo
 * serializa desde el doc Yjs persistido (lo que el autosave ya guardó).
 */
export function PlaytestButton({ roomId, disabled }: PlaytestButtonProps) {
  const t = useTranslations("EditorPlaytest");
  const tHeader = useTranslations("RoomEditor.header");
  const format = useFormatter();
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: "idle" });

  const create = async () => {
    // La pestaña se abre en el gesto del usuario (si no, el navegador la bloquea).
    const tab = window.open("about:blank", "_blank");
    setState({ kind: "creating" });
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/playtest`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        tab?.close();
        setState({ kind: "error", code: json?.error?.code ?? "UNKNOWN" });
        return;
      }
      const created = (await res.json()) as RoomPlaytestResponse;
      const url = new URL(`/${locale}${created.path}`, window.location.origin).toString();
      if (tab) tab.location.href = url;
      setState({ kind: "ready", url, expiresAt: created.expiresAt, copied: false });
    } catch {
      tab?.close();
      setState({ kind: "error", code: "PLAYTEST_UNAVAILABLE" });
    }
  };

  const copy = async (url: string, expiresAt: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setState({ kind: "ready", url, expiresAt, copied: true });
    } catch {
      // Sin permiso de portapapeles: el link sigue visible para copiarlo a mano.
    }
  };

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className="border border-white/15 text-white hover:bg-white/10"
        disabled={disabled || state.kind === "creating"}
        title={disabled ? t("editor.localDraft") : undefined}
        onClick={() => void create()}
      >
        {state.kind === "creating" ? t("editor.creating") : tHeader("playtest")}
      </Button>
      {state.kind === "ready" || state.kind === "error" ? (
        <div
          role={state.kind === "error" ? "alert" : "status"}
          className="absolute right-0 top-full z-20 mt-2 w-80 space-y-2 rounded-lg border border-white/15 bg-slate-950 p-3 text-sm text-white shadow-lg"
        >
          {state.kind === "error" ? (
            <p className="text-red-200">
              {t(`editor.errors.${KNOWN_ERRORS.has(state.code) ? state.code : "UNKNOWN"}`)}
            </p>
          ) : (
            <>
              <p className="font-medium">{t("editor.ready")}</p>
              <p className="text-white/70">{t("editor.shareHint")}</p>
              <input
                readOnly
                value={state.url}
                aria-label={t("editor.linkLabel")}
                className="w-full rounded border border-white/15 bg-transparent px-2 py-1 text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <p className="text-xs text-white/60">
                {t("editor.expires", {
                  time: format.dateTime(new Date(state.expiresAt), {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void copy(state.url, state.expiresAt)}>
                  {state.copied ? t("editor.copied") : t("editor.copy")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="border border-white/15 text-white hover:bg-white/10"
                  onClick={() => window.open(state.url, "_blank", "noopener")}
                >
                  {t("editor.open")}
                </Button>
              </div>
            </>
          )}
          <button
            type="button"
            className="text-xs text-white/50 underline"
            onClick={() => setState({ kind: "idle" })}
          >
            {t("editor.dismiss")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
