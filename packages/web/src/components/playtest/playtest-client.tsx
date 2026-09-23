"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Client, type Room } from "@colyseus/sdk";
import { Button } from "@/components/ui/button";
import { COLYSEUS_URL } from "@/lib/colyseus";
import {
  PLAYTEST_EXPIRED_CLOSE_CODE,
  PLAYTEST_MESSAGES,
  PLAYTEST_ROOM_NAME,
  toPlaytestView,
  type PlaytestStateLike,
  type PlaytestView,
} from "@/lib/playtest-net";

export interface PlaytestClientProps {
  token: string;
  playtestId: string;
  /** Epoch ms. */
  expiresAt: number;
}

type Status = "connecting" | "connected" | "rejected" | "expired" | "closed";

/** Entradas del registro de eventos que se muestran (las más recientes). */
const LOG_LIMIT = 30;

type LogEntry = { id: number; text: string };

/**
 * Cliente de red del playtest (ticket 3.8): entra en la room temporal con el
 * token del link y muestra la partida en vivo — jugadores, fase, objetos con
 * su estado e inventario — con las acciones básicas del protocolo (empezar e
 * interactuar). El cliente visual completo (Phaser + paneles de puzzle sobre
 * la red) es el de la partida publicada y queda fuera de este ticket.
 */
export function PlaytestClient({ token, playtestId, expiresAt }: PlaytestClientProps) {
  const t = useTranslations("EditorPlaytest");
  const [status, setStatus] = useState<Status>("connecting");
  const [view, setView] = useState<PlaytestView | null>(null);
  const [selfId, setSelfId] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const roomRef = useRef<Room<PlaytestStateLike> | null>(null);

  useEffect(() => {
    let disposed = false;
    let nextId = 0;
    const push = (text: string) => {
      if (disposed) return;
      nextId += 1;
      const entry = { id: nextId, text };
      setLog((current) => [entry, ...current].slice(0, LOG_LIMIT));
    };

    setStatus("connecting");
    const client = new Client(COLYSEUS_URL);
    client
      .joinOrCreate<PlaytestStateLike>(PLAYTEST_ROOM_NAME, { playtestId, token })
      .then((room) => {
        if (disposed) {
          void room.leave();
          return;
        }
        roomRef.current = room;
        setSelfId(room.sessionId);
        setStatus("connected");
        const sync = (state: PlaytestStateLike) => {
          if (!disposed) setView(toPlaytestView(state, room.sessionId));
        };
        room.onStateChange(sync);
        room.onMessage<{ dialogId: string }>(PLAYTEST_MESSAGES.dialogShow, (m) =>
          push(t("log.dialog", { id: m.dialogId })),
        );
        room.onMessage<{ objectId: string; state: string }>(
          PLAYTEST_MESSAGES.objectStateChanged,
          (m) => push(t("log.objectState", { id: m.objectId, state: m.state })),
        );
        room.onMessage<{ itemId: string }>(PLAYTEST_MESSAGES.itemGranted, (m) =>
          push(t("log.item", { item: m.itemId })),
        );
        room.onMessage<{ puzzleId: string }>(PLAYTEST_MESSAGES.puzzleSolved, (m) =>
          push(t("log.solved", { id: m.puzzleId })),
        );
        room.onMessage<{ result: string }>(PLAYTEST_MESSAGES.gameEnded, (m) =>
          push(t("log.ended", { result: m.result })),
        );
        room.onMessage<{ message?: string; code?: string }>(PLAYTEST_MESSAGES.error, (m) =>
          push(t("log.error", { message: m.message ?? m.code ?? "" })),
        );
        // Otros mensajes dirigidos (paneles de puzzle, pistas): esta vista no los pinta.
        room.onMessage("*", () => undefined);
        room.onLeave((code) => {
          if (disposed) return;
          roomRef.current = null;
          setStatus(code === PLAYTEST_EXPIRED_CLOSE_CODE ? "expired" : "closed");
        });
      })
      .catch(() => {
        if (!disposed) setStatus(Date.now() >= expiresAt ? "expired" : "rejected");
      });

    return () => {
      disposed = true;
      void roomRef.current?.leave();
      roomRef.current = null;
    };
  }, [token, playtestId, expiresAt, t]);

  const send = (type: string, payload: object) => roomRef.current?.send(type, payload);
  const self = view?.players.find((player) => player.id === selfId);

  if (status !== "connected" || !view) {
    const message =
      status === "connecting"
        ? t("page.connecting")
        : status === "expired"
          ? t("page.expired")
          : status === "rejected"
            ? t("page.invalidLink")
            : t("page.closed");
    return (
      <p role={status === "connecting" ? undefined : "alert"} className="text-sm text-white/70">
        {message}
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/80">
            {t(`page.phase.${phaseKey(view.phase)}`)}
          </span>
          {view.result ? (
            <span className="text-sm text-white">{t("page.result", { result: view.result })}</span>
          ) : null}
          {view.phase === "lobby" ? (
            self?.isHost ? (
              <Button size="sm" onClick={() => send(PLAYTEST_MESSAGES.startGame, {})}>
                {t("page.start")}
              </Button>
            ) : (
              <span className="text-sm text-white/60">{t("page.waitingHost")}</span>
            )
          ) : null}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-white">{t("page.objects")}</h2>
          {view.objects.length === 0 ? (
            <p className="text-sm text-white/60">{t("page.noObjects")}</p>
          ) : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {view.objects.map((object) => (
                <li
                  key={object.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1 text-sm text-white/80"
                >
                  <span>
                    <code>{object.id}</code> <span className="text-white/50">· {object.state}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="border border-white/15 text-white hover:bg-white/10"
                    disabled={view.phase !== "playing"}
                    onClick={() => send(PLAYTEST_MESSAGES.interact, { objectId: object.id })}
                  >
                    {t("page.interact")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-white">{t("page.players")}</h2>
          <ul className="space-y-1 text-sm text-white/80">
            {view.players.map((player) => (
              <li key={player.id} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block size-3 rounded-full"
                  style={{ backgroundColor: player.tint }}
                />
                <span className={player.connected ? undefined : "text-white/40"}>
                  {player.name}
                  {player.id === selfId ? ` (${t("page.you")})` : ""}
                  {player.isHost ? ` · ${t("page.host")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-white">{t("page.inventory")}</h2>
          <p className="text-sm text-white/70">
            {view.inventory.length > 0 ? view.inventory.join(", ") : t("page.emptyInventory")}
          </p>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-white">{t("page.log")}</h2>
          <ol
            className="max-h-64 space-y-1 overflow-y-auto text-xs text-white/70"
            aria-live="polite"
          >
            {log.map((entry) => (
              <li key={entry.id}>{entry.text}</li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}

function phaseKey(phase: string): "lobby" | "playing" | "ended" {
  return phase === "playing" ? "playing" : phase === "lobby" ? "lobby" : "ended";
}
