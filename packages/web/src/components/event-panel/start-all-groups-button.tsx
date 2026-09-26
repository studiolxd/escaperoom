"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { EventSessionRow, GroupStartResult } from "@escaperoom/shared/services";
import { startAllGroups } from "@/actions/events";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Estados de un grupo que SÍ arrancó (o no había nada que arrancar). */
const RESOLVED_STATUSES = new Set<GroupStartResult["status"]>(["started", "already_started", "empty"]);

function groupName(rows: readonly EventSessionRow[], sessionId: string): string {
  return rows.find((row) => row.sessionId === sessionId)?.name ?? sessionId;
}

/**
 * "Comenzar todos" del panel del organizador (ticket "inicio conjunto",
 * specs/11 §4.1/§4.5, specs/19 §2): sin `force`, todo o nada — si algún grupo
 * no cumple mínimo+listos, no arranca ninguno y se muestra el aviso con el
 * detalle por grupo y tres opciones (Esperar, Refrescar, Comenzar
 * igualmente). Con "Comenzar igualmente" (`force`), arranca todo grupo con
 * algún conectado, saltando el mínimo, salvo los vacíos (nunca arrancan).
 */
export function StartAllGroupsButton({
  eventId,
  rows,
  onStarted,
}: {
  eventId: string;
  rows: readonly EventSessionRow[];
  /** Tras un intento que arranca (parcial o total): el panel refresca el dashboard. */
  onStarted: () => void;
}) {
  const t = useTranslations("EventPanel.startAll");
  const [busy, setBusy] = useState(false);
  const [blocking, setBlocking] = useState<GroupStartResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function attempt(force: boolean) {
    setBusy(true);
    setError(null);
    const result = await startAllGroups(eventId, force);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const stillBlocking = result.data.filter((group) => !RESOLVED_STATUSES.has(group.status));
    if (stillBlocking.length === 0) {
      setBlocking(null);
      onStarted();
      return;
    }
    setBlocking(stillBlocking);
  }

  function describeGroup(group: GroupStartResult): string {
    const name = groupName(rows, group.sessionId);
    if (group.status === "min_not_met") {
      return t("detailMinNotMet", { name, connected: group.connected, min: group.min });
    }
    return t("detailNotReady", { name, missing: group.connected - group.ready });
  }

  return (
    <>
      <Button variant="overlay" disabled={busy} onClick={() => void attempt(false)}>
        {busy ? t("starting") : t("button")}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <Dialog open={blocking !== null} onOpenChange={(open) => !open && setBlocking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("notReadyTitle")}</DialogTitle>
            <DialogDescription>{t("notReadyDescription")}</DialogDescription>
          </DialogHeader>
          <ul className="list-inside list-disc text-sm">
            {blocking?.map((group) => <li key={group.sessionId}>{describeGroup(group)}</li>)}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlocking(null)}>
              {t("wait")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void attempt(false)}>
              {t("refresh")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void attempt(true)}>
              {t("forceButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
