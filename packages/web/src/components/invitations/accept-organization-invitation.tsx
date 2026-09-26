"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "idle" }
  | { kind: "accepting" }
  | { kind: "rejecting" }
  | { kind: "accepted" }
  | { kind: "rejected" }
  | { kind: "error" };

export interface AcceptOrganizationInvitationProps {
  invitationId: string;
  /** A dónde ir tras aceptar o rechazar (no hay panel de organización todavía). */
  homeHref: string;
}

/**
 * Aceptar/rechazar una invitación a organización (A-8) contra las rutas de
 * Better Auth `/organization/{accept,reject}-invitation` (exigen sesión ya
 * comprobada por la página del servidor). Mismo patrón de estado que
 * `ConfirmAttendance` (`components/invitations/confirm-attendance.tsx`).
 */
export function AcceptOrganizationInvitation({
  invitationId,
  homeHref,
}: AcceptOrganizationInvitationProps) {
  const t = useTranslations("OrganizationInvitation");
  const [state, setState] = useState<State>({ kind: "idle" });

  const send = async (action: "accept" | "reject") => {
    setState({ kind: action === "accept" ? "accepting" : "rejecting" });
    try {
      const res = await fetch(`/api/auth/organization/${action}-invitation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId }),
      });
      setState(res.ok ? { kind: action === "accept" ? "accepted" : "rejected" } : { kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  };

  if (state.kind === "accepted" || state.kind === "rejected") {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm text-emerald-300">
          {state.kind === "accepted" ? t("accepted") : t("rejected")}
        </p>
        <a href={homeHref} className="inline-block text-sm text-blue-300 underline">
          {t("goHome")}
        </a>
      </div>
    );
  }

  const busy = state.kind === "accepting" || state.kind === "rejecting";
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Button type="button" disabled={busy} onClick={() => void send("accept")}>
          {state.kind === "accepting" ? t("accepting") : t("accept")}
        </Button>
        <Button type="button" variant="overlay" disabled={busy} onClick={() => void send("reject")}>
          {state.kind === "rejecting" ? t("rejecting") : t("reject")}
        </Button>
      </div>
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-red-300">
          {t("genericError")}
        </p>
      ) : null}
    </div>
  );
}
