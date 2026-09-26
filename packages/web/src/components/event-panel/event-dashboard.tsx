"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ACCESS_KEY_CARDS_ERROR_CODES, EVENT_PANEL_ERROR_CODES } from "@escaperoom/shared/error-codes";
import type { EventDashboard, EventSessionRow } from "@escaperoom/shared/services";
import { Button } from "@/components/ui/button";
import { EventTimeLimitDialog } from "./event-time-limit-dialog";
import { Link } from "@/i18n/navigation";
import { formatDuration } from "@/lib/session-format";
import { eventApiPath, observePath, readApiError } from "@/lib/event-panel";

/** Cada cuánto se refresca el panel (el progreso en vivo sale de Colyseus). */
const POLL_MS = 5000;
/** Cada cuánto se consulta un PDF de claves encolado (≥ 50 tarjetas). */
const PDF_POLL_MS = 3000;

/** Este panel agrega dos servicios: sesiones del evento y export de tarjetas. */
export const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  ...EVENT_PANEL_ERROR_CODES,
  "NO_PRINTABLE_KEYS" satisfies (typeof ACCESS_KEY_CARDS_ERROR_CODES)[number],
]);

type PdfState =
  | { kind: "idle" }
  | { kind: "working"; cards?: number }
  | { kind: "ready"; url: string }
  | { kind: "error"; code: string };

/**
 * Panel del organizador en vivo (ticket 5.9, specs/19 §2): cabecera con el
 * estado del evento, métricas (claves, invitaciones, sesiones, tiempo medio y
 * pistas), una fila por sesión con su progreso y su puesto en el ranking del
 * evento (specs/21 §4) y la acción `observar` en las partidas en curso; en el
 * pie, reenviar invitaciones pendientes y exportar CSV y PDF. Se refresca cada
 * pocos segundos: todo lo calcula `GET /api/events/:id/dashboard`.
 */
export function EventDashboardView({ eventId }: { eventId: string }) {
  const t = useTranslations("EventPanel");
  const format = useFormatter();
  const locale = useLocale();
  const [dashboard, setDashboard] = useState<EventDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resend, setResend] = useState<{ busy: boolean; count: number | null; error?: string }>({
    busy: false,
    count: null,
  });
  const [pdf, setPdf] = useState<PdfState>({ kind: "idle" });
  const pdfTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `exportPdf` (síncrono, sin cola) crea un blob URL local; el de `pollPdf`
  // (encolado) es una URL firmada del servidor. Solo el primero hay que
  // revocarlo (F-32): sin esto, cada exportación sucesiva filtraba el blob
  // anterior.
  const blobUrl = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(eventApiPath(eventId, "dashboard"), { cache: "no-store" });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      setDashboard((await res.json()) as EventDashboard);
      setError(null);
    } catch {
      setError("UNKNOWN");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    // Pestaña oculta: no hay nadie mirando el panel en vivo, así que se
    // saltan los refrescos (F-32) — se retoman al volver a primer plano.
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (pdfTimer.current) clearTimeout(pdfTimer.current);
    };
  }, [load]);

  const errorText = (code: string) => t(`errors.${KNOWN_ERRORS.has(code) ? code : "UNKNOWN"}`);

  const resendPending = async () => {
    setResend({ busy: true, count: null });
    try {
      const res = await fetch(eventApiPath(eventId, "invitations/resend"), { method: "POST" });
      if (!res.ok) {
        setResend({ busy: false, count: null, error: await readApiError(res) });
        return;
      }
      const json = (await res.json()) as { requested?: number };
      setResend({ busy: false, count: json.requested ?? 0 });
      void load();
    } catch {
      setResend({ busy: false, count: null, error: "UNKNOWN" });
    }
  };

  const pollPdf = (jobId: string, cards: number) => {
    pdfTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/exports/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const json = (await res.json()) as { status?: string; downloadUrl?: string | null };
        if (res.ok && json.status === "completed" && json.downloadUrl) {
          setPdf({ kind: "ready", url: json.downloadUrl });
        } else if (!res.ok || json.status === "failed" || json.status === "expired") {
          setPdf({ kind: "error", code: "UNKNOWN" });
        } else {
          pollPdf(jobId, cards);
        }
      } catch {
        setPdf({ kind: "error", code: "UNKNOWN" });
      }
    }, PDF_POLL_MS);
  };

  const exportPdf = async () => {
    setPdf({ kind: "working" });
    try {
      const res = await fetch(eventApiPath(eventId, "access-keys/export-pdf"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (res.status === 202) {
        const job = (await res.json()) as { jobId: string; cards: number };
        setPdf({ kind: "working", cards: job.cards });
        pollPdf(job.jobId, job.cards);
        return;
      }
      if (!res.ok) {
        setPdf({ kind: "error", code: await readApiError(res) });
        return;
      }
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      const url = URL.createObjectURL(await res.blob());
      blobUrl.current = url;
      setPdf({ kind: "ready", url });
    } catch {
      setPdf({ kind: "error", code: "UNKNOWN" });
    }
  };

  if (!dashboard) {
    return (
      <p role={error ? "alert" : "status"} className="text-sm text-white/70">
        {error ? errorText(error) : t("loading")}
      </p>
    );
  }

  const { event, keys, invitations, sessions, metrics, rows } = dashboard;
  const none = t("metrics.none");

  return (
    <div className="space-y-6" data-testid="event-dashboard">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-white/50">{t("title")}</p>
        <h1 className="text-2xl font-semibold">{event.title}</h1>
        <p className="flex flex-wrap gap-x-3 text-sm text-white/70">
          <span>{t(`status.${event.status}`)}</span>
          <span>{t("activeSessions", { count: sessions.active })}</span>
          <span>
            {t("updatedAt", {
              time: format.dateTime(new Date(dashboard.generatedAt), { timeStyle: "medium" }),
            })}
          </span>
        </p>
        {event.status === "draft" ? (
          <p>
            <EventTimeLimitDialog
              eventId={event.id}
              timeLimitMinutes={event.timeLimitMinutes}
              onSaved={(timeLimitMinutes) =>
                setDashboard((prev) =>
                  prev ? { ...prev, event: { ...prev.event, timeLimitMinutes } } : prev,
                )
              }
            />
          </p>
        ) : null}
        {!dashboard.liveAvailable ? (
          <p role="status" className="text-sm text-amber-200">
            {t("liveUnavailable")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {errorText(error)}
          </p>
        ) : null}
      </header>

      <section aria-labelledby="event-metrics" className="space-y-2">
        <h2 id="event-metrics" className="sr-only">
          {t("metrics.title")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label={t("metrics.keys")} value={format.number(keys.generated)} />
          <Metric label={t("metrics.sent")} value={format.number(keys.sent)} />
          <Metric
            label={t("metrics.confirmed")}
            value={t("metrics.confirmedOf", {
              confirmed: keys.confirmed,
              invited: invitations.invited,
            })}
          />
          <Metric label={t("metrics.redeemed")} value={format.number(keys.redeemed)} />
          <Metric
            label={t("metrics.sessions")}
            value={t("metrics.sessionsValue", { active: sessions.active, total: sessions.total })}
          />
          <Metric
            label={t("metrics.averageTime")}
            value={
              metrics.averageEscapeMs === null
                ? none
                : formatDuration(metrics.averageEscapeMs / 1000)
            }
          />
          <Metric
            label={t("metrics.averageHints")}
            value={metrics.averageHints === null ? none : format.number(metrics.averageHints)}
          />
        </dl>
      </section>

      <section aria-labelledby="event-ranking" className="space-y-2">
        <h2 id="event-ranking" className="text-lg font-semibold">
          {t("table.title")}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-white/60">{t("table.empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {t("table.rank")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("table.group")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("table.progress")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("table.state")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("table.time")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("table.hints")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("table.players")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">{t("table.action")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <SessionRow key={row.sessionId} row={row} eventId={eventId} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
        <Button variant="overlay" disabled={resend.busy} onClick={() => void resendPending()}>
          {resend.busy ? t("footer.resending") : t("footer.resend")}
        </Button>
        <Button variant="overlay" asChild>
          <a href={`${eventApiPath(eventId, "progress/export")}?locale=${locale}`} download>
            {t("footer.exportCsv")}
          </a>
        </Button>
        {pdf.kind === "ready" ? (
          <Button variant="overlay" asChild>
            <a href={pdf.url} download>
              {t("footer.pdfReady")}
            </a>
          </Button>
        ) : (
          <Button
            variant="overlay"
            disabled={pdf.kind === "working"}
            onClick={() => void exportPdf()}
          >
            {pdf.kind === "working"
              ? pdf.cards
                ? t("footer.pdfQueued", { cards: pdf.cards })
                : t("footer.exportingPdf")
              : t("footer.exportPdf")}
          </Button>
        )}
        <p role="status" className="text-sm text-white/70">
          {resend.error
            ? errorText(resend.error)
            : resend.count !== null
              ? t("footer.resent", { count: resend.count })
              : pdf.kind === "error"
                ? errorText(pdf.code)
                : null}
        </p>
      </footer>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <dt className="text-xs text-white/60">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

function SessionRow({ row, eventId }: { row: EventSessionRow; eventId: string }) {
  const t = useTranslations("EventPanel");
  const percent =
    row.puzzlesTotal > 0 ? Math.round((row.puzzlesSolved / row.puzzlesTotal) * 100) : 0;
  return (
    <tr className="border-t border-white/10" data-testid="event-session-row">
      <td className="px-3 py-2 font-semibold">{row.rank ?? "—"}</td>
      <td className="px-3 py-2">{row.name}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={row.puzzlesTotal}
            aria-valuenow={row.puzzlesSolved}
            aria-label={t("table.progress")}
            className="h-2 w-24 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="progress-fill h-full bg-emerald-400"
              style={{ "--progress": `${percent}%` } as CSSProperties}
            />
          </div>
          <span className="text-xs text-white/70">
            {t("table.progressValue", { solved: row.puzzlesSolved, total: row.puzzlesTotal })}
          </span>
        </div>
      </td>
      <td className="px-3 py-2">
        {t(`states.${row.state}`)}
        {row.result ? ` · ${t(`results.${row.result}`)}` : null}
      </td>
      <td className="px-3 py-2 tabular-nums">
        {row.rank === null ? "—" : formatDuration(row.elapsedMs / 1000)}
      </td>
      <td className="px-3 py-2 tabular-nums">{row.hintsUsed}</td>
      <td className="px-3 py-2 text-xs text-white/70">
        {t("table.playersValue", {
          online: row.players,
          occupied: row.occupied,
          capacity: row.capacity,
        })}
      </td>
      <td className="px-3 py-2 text-right">
        {row.observable ? (
          <Button size="sm" variant="overlay" asChild>
            <Link href={observePath(eventId, row.sessionId)} title={t("actions.observeHint")}>
              {t("actions.observe")}
            </Link>
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
