"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import { remainingMs, type GameClient } from "@escaperoom/game-runtime/session";
import { ConnectionBadge } from "@/components/game-session/connection-badge";
import { useGameConnection } from "@/components/game-session/use-game-connection";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { dashboardPath, eventApiPath, readApiError } from "@/lib/event-panel";
import { formatDuration } from "@/lib/session-format";

const KNOWN_ERRORS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SESSION_NOT_FOUND",
  "SESSION_NOT_LIVE",
  "SPECTATOR_UNAVAILABLE",
]);

type Ticket = { sessionId: string; spectatorToken: string };

/**
 * Modo observador (ticket 5.9, specs/19 §2): el organizador pide un token de
 * observador para la sesión (`POST …/spectate`), entra en la room `event` como
 * observador y sigue la partida con el `GameClient` de red envuelto en solo
 * lectura. *Observar* nunca añade un jugador: la room no lo cuenta, rechaza
 * cualquier acción suya y no le manda nada que resuelva un puzzle.
 */
export function SpectatorGame({
  eventId,
  sessionId,
  model,
}: {
  eventId: string;
  sessionId: string;
  model: RuntimeModel;
}) {
  const t = useTranslations("EventPanel");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setTicket(null);
    fetch(eventApiPath(eventId, `sessions/${encodeURIComponent(sessionId)}/spectate`), {
      method: "POST",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(await readApiError(res));
          return;
        }
        setTicket((await res.json()) as Ticket);
      })
      .catch(() => {
        if (!cancelled) setError("UNKNOWN");
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, sessionId, attempt]);

  const back = (
    <Button variant="overlay" size="sm" asChild>
      <Link href={dashboardPath(eventId)}>{t("observer.back")}</Link>
    </Button>
  );

  if (error) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-300">
          {t(`errors.${KNOWN_ERRORS.has(error) ? error : "UNKNOWN"}`)}
        </p>
        <div className="flex gap-2">
          {back}
          <Button variant="overlay" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {t("observer.retry")}
          </Button>
        </div>
      </div>
    );
  }
  if (!ticket) return <p className="text-sm text-white/70">{t("observer.connecting")}</p>;
  return <SpectatorConnection ticket={ticket} model={model} back={back} />;
}

function SpectatorConnection({
  ticket,
  model,
  back,
}: {
  ticket: Ticket;
  model: RuntimeModel;
  back: React.ReactNode;
}) {
  const t = useTranslations("EventPanel");
  const target = useMemo(
    () => ({
      kind: "spectate" as const,
      sessionId: ticket.sessionId,
      spectatorToken: ticket.spectatorToken,
    }),
    [ticket],
  );
  const connection = useGameConnection({ target });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {back}
        <ConnectionBadge status={connection.status} />
        <span className="rounded-full border border-sky-300/40 bg-sky-400/10 px-3 py-1 text-xs text-sky-100">
          {t("observer.readOnly")}
        </span>
      </div>
      {connection.client ? (
        <SpectatorView client={connection.client} model={model} />
      ) : connection.status === "error" ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-300">
            {t("observer.error")}
          </p>
          <Button variant="overlay" size="sm" onClick={connection.retry}>
            {t("observer.retry")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-white/70">{t("observer.connecting")}</p>
      )}
    </div>
  );
}

/**
 * Vista de solo lectura de la partida a partir del `GameSnapshot` (la misma
 * proyección pública que ve un jugador): fase, reloj, jugadores y dónde están,
 * estado de cada puzzle, actividad difundida y chat del grupo.
 */
export function SpectatorView({ client, model }: { client: GameClient; model: RuntimeModel }) {
  const t = useTranslations("EventPanel");
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [log, setLog] = useState<Array<{ id: number; text: string }>>([]);

  useEffect(() => {
    let id = 0;
    return client.onEvent((event) => {
      let text: string | null = null;
      if (event.type === "puzzle_solved") {
        const puzzle = model.puzzlesById[event.puzzleId];
        text = t("observer.logSolved", {
          puzzle: puzzle ? t(`puzzleTypes.${puzzle.type}`) : event.puzzleId,
        });
      } else if (event.type === "game_ended") {
        const result = ["victory", "timeout", "aborted"].includes(event.result)
          ? t(`results.${event.result as "victory" | "timeout" | "aborted"}`)
          : event.result;
        text = t("observer.logEnded", { result });
      }
      if (text) {
        const entry = { id: (id += 1), text };
        setLog((current) => [entry, ...current].slice(0, 20));
      }
    });
  }, [client, model, t]);

  const solved = Object.values(snapshot.puzzles).filter((p) => p.state === "solved").length;
  const started = snapshot.startedAt > 0;
  const phase = (["lobby", "playing", "paused", "ended"] as const).find(
    (p) => p === snapshot.phase,
  );
  const roomName = (roomId: string) => model.subroomsById[roomId]?.name ?? roomId;
  const left = remainingMs(snapshot);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]" data-testid="spectator-view">
      <section className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="font-semibold">
            {phase ? t(`observer.phase.${phase}`) : snapshot.phase}
          </span>
          {started ? (
            <span>
              {t("observer.elapsed")}:{" "}
              <span className="tabular-nums">
                {formatDuration((snapshot.clock - snapshot.startedAt) / 1000)}
              </span>
            </span>
          ) : null}
          {left !== null ? (
            <span>
              {t("observer.timeLeft")}:{" "}
              <span className="tabular-nums">{formatDuration(left / 1000)}</span>
            </span>
          ) : null}
          <span>{t("observer.solved", { solved, total: model.puzzles.length })}</span>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-white/80">{t("observer.puzzles")}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {model.puzzles.map((puzzle) => {
              const state = snapshot.puzzles[puzzle.id]?.state ?? "locked";
              const known = ["locked", "available", "in_progress", "solved", "failed"].includes(
                state,
              );
              return (
                <li
                  key={puzzle.id}
                  className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm"
                >
                  <span>
                    {t(`puzzleTypes.${puzzle.type}`)}
                    <span className="block text-xs text-white/50">{roomName(puzzle.roomId)}</span>
                  </span>
                  <span className={state === "solved" ? "text-emerald-300" : "text-white/70"}>
                    {known
                      ? t(
                          `observer.puzzleStates.${state as "locked" | "available" | "in_progress" | "solved" | "failed"}`,
                        )
                      : state}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h2 className="mb-2 text-sm font-semibold text-white/80">{t("observer.players")}</h2>
          {snapshot.players.length === 0 ? (
            <p className="text-sm text-white/60">{t("observer.noPlayers")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {snapshot.players.map((player) => (
                <li key={player.id} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="tint-dot inline-block size-3 rounded-full"
                    style={{ "--tint": player.tint } as CSSProperties}
                  />
                  <span>{player.name}</span>
                  <span className="text-xs text-white/50">
                    {roomName(player.roomId)}
                    {player.isHost ? ` · ${t("observer.host")}` : ""}
                    {player.connected ? "" : ` · ${t("observer.offline")}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h2 className="mb-2 text-sm font-semibold text-white/80">{t("observer.log")}</h2>
          {log.length === 0 ? (
            <p className="text-sm text-white/60">{t("observer.noLog")}</p>
          ) : (
            <ul className="space-y-1 text-sm" aria-live="polite">
              {log.map((entry) => (
                <li key={entry.id}>{entry.text}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h2 className="mb-2 text-sm font-semibold text-white/80">{t("observer.chat")}</h2>
          {snapshot.chat.length === 0 ? (
            <p className="text-sm text-white/60">{t("observer.noChat")}</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {snapshot.chat.map((message) => (
                <li key={message.id}>
                  <span className="font-semibold">{message.authorName}: </span>
                  {message.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
