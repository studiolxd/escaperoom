"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  PUBLISH_CONFIRM_DISABLED_ERROR,
  type PublishConfirmationErrorCode,
  type RoomPublishErrorCode,
} from "@escaperoom/shared/error-codes";
import { confirmPublish as confirmPublishAction } from "@/actions/publish-confirm";
import { Button } from "@/components/ui/button";

/**
 * Códigos de error de `POST /api/publish-confirm` con mensaje propio: mismo
 * conjunto que `publish-confirm/page.tsx` (fuente: `PublishConfirm.errors` en
 * `messages/es.json`). Antes le faltaba `NOTHING_TO_PUBLISH` (ADR-035) por
 * copiar la lista a mano; ya la traducción existía sin usarse aquí.
 */
export const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  ...(["UNAUTHORIZED", "FORBIDDEN", "INVALID_TOKEN", "EXPIRED"] satisfies readonly PublishConfirmationErrorCode[]),
  ...([
    "NOT_FOUND",
    "DRAFT_CHANGED",
    "VERSION_CHANGED",
    "VALIDATION_FAILED",
    "ASSETS_NOT_PUBLISHABLE",
    "ROOM_NOT_PUBLISHABLE",
    "CONTENT_BLOCKED",
    "ACCOUNT_FROZEN",
    "CREATOR_SUSPENDED",
    "CREATOR_BANNED",
    "NOTHING_TO_PUBLISH",
  ] satisfies readonly RoomPublishErrorCode[]),
  PUBLISH_CONFIRM_DISABLED_ERROR,
]);

type State =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "done"; semver: string }
  | { kind: "error"; code: string };

export interface ConfirmPublishProps {
  token: string;
}

/**
 * Botón de la confirmación humana de una publicación (ticket 4.5). Confirmar
 * exige pulsar (un POST con la sesión del creador): abrir el enlace no publica.
 */
export function ConfirmPublish({ token }: ConfirmPublishProps) {
  const t = useTranslations("PublishConfirm");
  const [state, setState] = useState<State>({ kind: "idle" });

  const confirm = async () => {
    setState({ kind: "confirming" });
    try {
      const result = await confirmPublishAction({ token });
      if (!result.ok) {
        setState({ kind: "error", code: result.error.code });
        return;
      }
      setState({ kind: "done", semver: result.data.version.semver });
    } catch {
      setState({ kind: "error", code: "UNKNOWN" });
    }
  };

  if (state.kind === "done") {
    return (
      <p role="status" className="text-sm text-emerald-300">
        {t("success", { version: `v${state.semver}` })}
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
