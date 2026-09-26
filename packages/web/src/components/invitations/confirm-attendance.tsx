"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AccessKeyErrorCode } from "@escaperoom/shared/error-codes";
import { confirmAttendance as confirmAttendanceAction } from "@/actions/attendance";
import { Button } from "@/components/ui/button";

/** Códigos de error de `POST /api/access-keys/:code/confirm` con mensaje propio. */
export const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "CONFIRMATION_INVALID",
  "CONFIRMATION_EXPIRED",
  "CONFIRMATION_UNAVAILABLE",
  "ACCESS_KEY_INVALID",
  "ACCESS_KEY_EXPIRED",
] satisfies readonly AccessKeyErrorCode[]);

type State =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "done"; already: boolean }
  | { kind: "error"; code: string };

export interface ConfirmAttendanceProps {
  code: string;
  token: string;
}

/**
 * Confirmación de asistencia (ticket 5.6, specs/02 §4.4). El enlace del email
 * abre esta página y la confirmación exige pulsar el botón (un POST): los
 * escáneres de enlaces de los clientes de correo hacen GET y no deben
 * confirmar por el asistente.
 */
export function ConfirmAttendance({ code, token }: ConfirmAttendanceProps) {
  const t = useTranslations("InvitationConfirm");
  const [state, setState] = useState<State>({ kind: "idle" });

  const confirm = async () => {
    setState({ kind: "confirming" });
    try {
      const result = await confirmAttendanceAction({ code, token });
      if (!result.ok) {
        setState({ kind: "error", code: result.error.code });
        return;
      }
      setState({ kind: "done", already: result.data.alreadyConfirmed });
    } catch {
      setState({ kind: "error", code: "UNKNOWN" });
    }
  };

  if (state.kind === "done") {
    return (
      <p role="status" className="text-sm text-emerald-300">
        {state.already ? t("already") : t("success")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Button
        variant="overlay"
        disabled={state.kind === "confirming"}
        onClick={() => void confirm()}
      >
        {state.kind === "confirming" ? t("confirming") : t("cta")}
      </Button>
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-red-300">
          {KNOWN_ERRORS.has(state.code) ? t(`errors.${state.code}`) : t("errors.UNKNOWN")}
        </p>
      ) : null}
    </div>
  );
}
