"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { PublicRuntimeModel } from "@escaperoom/game-runtime";
import type { ObserverCamera } from "@escaperoom/game-runtime/three";
import { remainingMs, type GameClient, type GameSnapshot } from "@escaperoom/game-runtime/session";
import { EVENT_PANEL_ERROR_CODES } from "@escaperoom/shared/error-codes";
import { ConnectionBadge } from "@/components/game-session/connection-badge";
import { useGameConnection } from "@/components/game-session/use-game-connection";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Pack3D } from "@/lib/game-model";
import { Link } from "@/i18n/navigation";
import { dashboardPath, eventApiPath, readApiError } from "@/lib/event-panel";
import { formatDuration } from "@/lib/session-format";

const SpectatorCanvas3D = dynamic(() => import("./spectator-canvas-3d"), {
  ssr: false,
  loading: () => <div className="absolute inset-0" />,
});

export const KNOWN_ERRORS: ReadonlySet<string> = new Set(EVENT_PANEL_ERROR_CODES);

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
  pack3d,
}: {
  eventId: string;
  sessionId: string;
  model: PublicRuntimeModel;
  pack3d?: Pack3D;
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
  return <SpectatorConnection ticket={ticket} model={model} pack3d={pack3d} back={back} />;
}

function SpectatorConnection({
  ticket,
  model,
  pack3d,
  back,
}: {
  ticket: Ticket;
  model: PublicRuntimeModel;
  pack3d?: Pack3D;
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
        <SpectatorView client={connection.client} model={model} pack3d={pack3d} />
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
export function SpectatorView({
  client,
  model,
  pack3d,
}: {
  client: GameClient;
  model: PublicRuntimeModel;
  pack3d?: Pack3D;
}) {
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
    <>
    {model.dimension === "3d" ? (
      <SpectatorWorld3D snapshot={snapshot} model={model} pack3d={pack3d} />
    ) : null}
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
    </>
  );
}

const FREE_CAMERA = "free";
const FOLLOW_PREFIX = "follow:";

/**
 * Mundo 3D del observador (specs/27 §6, ticket 7.6): el canvas con todos los jugadores y dos
 * selectores — cámara (libre o siguiendo a un jugador) y, con cámara libre, habitación.
 */
function SpectatorWorld3D({
  snapshot,
  model,
  pack3d,
}: {
  snapshot: GameSnapshot;
  model: PublicRuntimeModel;
  pack3d?: Pack3D;
}) {
  const t = useTranslations("EventPanel");
  const [camera, setCamera] = useState<ObserverCamera>({ type: "free" });
  const [room, setRoom] = useState(model.initialRoomId);

  const players = useMemo(
    () =>
      snapshot.players.map(({ id, name, roomId, x, y, h, yaw, tint, characterId, connected }) => ({
        id,
        name,
        roomId,
        x,
        y,
        h,
        yaw,
        tint,
        characterId,
        connected,
      })),
    [snapshot.players],
  );
  const followable = snapshot.players.filter((player) => player.connected);
  const cameraValue =
    camera.type === "follow" && followable.some((player) => player.id === camera.playerId)
      ? `${FOLLOW_PREFIX}${camera.playerId}`
      : FREE_CAMERA;

  return (
    <section
      className="relative h-[60vh] overflow-hidden rounded-xl border border-white/10"
      data-testid="spectator-world-3d"
    >
      <SpectatorCanvas3D
        model={model}
        pack3d={pack3d}
        players={players}
        objects={snapshot.objects}
        camera={camera}
        onRoomChange={setRoom}
      />
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <Select
          value={cameraValue}
          onValueChange={(value) =>
            setCamera(
              value.startsWith(FOLLOW_PREFIX)
                ? { type: "follow", playerId: value.slice(FOLLOW_PREFIX.length) }
                : { type: "free", roomId: room },
            )
          }
        >
          <SelectTrigger size="sm" aria-label={t("observer.camera")} data-testid="spectator-camera">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FREE_CAMERA}>{t("observer.cameraFree")}</SelectItem>
            {followable.map((player) => (
              <SelectItem key={player.id} value={`${FOLLOW_PREFIX}${player.id}`}>
                {t("observer.cameraFollow", { player: player.name })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {cameraValue === FREE_CAMERA ? (
          <Select value={room} onValueChange={(roomId) => setCamera({ type: "free", roomId })}>
            <SelectTrigger size="sm" aria-label={t("observer.room")} data-testid="spectator-room">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {model.subrooms.map((subroom) => (
                <SelectItem key={subroom.id} value={subroom.id}>
                  {subroom.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </section>
  );
}
