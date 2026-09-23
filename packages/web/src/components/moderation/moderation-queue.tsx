"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readApiError } from "@/lib/event-panel";

/** Fila de `GET /api/admin/reports` (ver `reportJson` en `server/rest/moderation`). */
export type QueueReport = {
  id: string;
  targetType: "room" | "review" | "user";
  roomId: string | null;
  reviewId: string | null;
  targetUserId: string | null;
  reason: string;
  details: string | null;
  severity: "critical" | "high" | "normal" | "low";
  category: string;
  source: "user_report" | "precheck" | "sampling";
  flags: string[];
  slaDueAt: string;
  overdue: boolean;
  actionTaken: string | null;
  autoActioned: boolean;
  reportsOnTarget: number;
  activeEvent: boolean;
  createdAt: string;
};

export type QueueAppeal = {
  id: string;
  creatorId: string;
  roomId: string | null;
  contentReportId: string | null;
  reason: string;
  slaDueAt: string;
  overdue: boolean;
  createdAt: string;
};

export type QueueAudio = {
  id: string;
  ownerId: string;
  originalFilename: string;
  durationMs: number;
  moderationFlags: string[];
  createdAt: string;
};

type Tab = "reports" | "appeals" | "audio";

const TABS: readonly Tab[] = ["reports", "appeals", "audio"];
const ENDPOINT: Record<Tab, string> = {
  reports: "/api/admin/reports",
  appeals: "/api/admin/appeals",
  audio: "/api/admin/audio",
};

const KNOWN_ERRORS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "ALREADY_REVIEWED",
  "VALIDATION_ERROR",
]);

const SEVERITY_CLASS: Record<QueueReport["severity"], string> = {
  critical: "bg-red-500/20 text-red-200 border-red-400/40",
  high: "bg-orange-500/20 text-orange-200 border-orange-400/40",
  normal: "bg-sky-500/15 text-sky-200 border-sky-400/30",
  low: "bg-white/10 text-white/70 border-white/20",
};

type Lists = { reports: QueueReport[]; appeals: QueueAppeal[]; audio: QueueAudio[] };

/**
 * Cola de moderación (ticket 6.1, specs/17 §4): reportes priorizados con su
 * SLA, apelaciones pendientes y la cola de audio de 3.11. Cada decisión es un
 * PATCH a la API de admin, que vuelve a comprobar `isModerator | isAdmin`.
 */
export function ModerationQueueView() {
  const t = useTranslations("Moderation");
  const format = useFormatter();
  const [tab, setTab] = useState<Tab>("reports");
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const responses = await Promise.all(
        TABS.map((k) => fetch(ENDPOINT[k], { cache: "no-store" })),
      );
      const failed = responses.find((r) => !r.ok);
      if (failed) {
        setError(await readApiError(failed));
        return;
      }
      const [reports, appeals, audio] = (await Promise.all(responses.map((r) => r.json()))) as [
        { items: QueueReport[] },
        { items: QueueAppeal[] },
        { items: QueueAudio[] },
      ];
      setLists({ reports: reports.items, appeals: appeals.items, audio: audio.items });
      setError(null);
    } catch {
      setError("UNKNOWN");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (key: string, url: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) setError(await readApiError(res));
      else setError(null);
      await load();
    } catch {
      setError("UNKNOWN");
    } finally {
      setBusy(null);
    }
  };

  const noteOf = (id: string) => notes[id]?.trim() || undefined;
  const errorText = (code: string) => t(`errors.${KNOWN_ERRORS.has(code) ? code : "UNKNOWN"}`);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  const noteField = (id: string) => (
    <Label className="flex-col items-start gap-1 text-xs font-normal text-white/60">
      {t("note")}
      <Input
        className="h-auto w-full border-white/15 bg-black/30 px-2 py-1 text-sm text-white"
        value={notes[id] ?? ""}
        onChange={(e) => setNotes((n) => ({ ...n, [id]: e.target.value }))}
      />
    </Label>
  );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-white/70">{t("intro")}</p>
      </header>

      <nav className="flex gap-2" role="tablist">
        {TABS.map((k) => (
          <Button
            key={k}
            role="tab"
            aria-selected={tab === k}
            variant={tab === k ? "overlay" : "overlayGhost"}
            size="sm"
            onClick={() => setTab(k)}
          >
            {t(`tabs.${k}`, { count: lists?.[k].length ?? 0 })}
          </Button>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {errorText(error)}
        </p>
      ) : null}
      {!lists && !error ? <p className="text-sm text-white/60">{t("loading")}</p> : null}

      {lists && tab === "reports" ? (
        lists.reports.length === 0 ? (
          <p className="text-sm text-white/60">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {lists.reports.map((r) => (
              <li key={r.id} className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded border px-2 py-0.5 ${SEVERITY_CLASS[r.severity]}`}>
                    {t(`severity.${r.severity}`)}
                  </span>
                  <span className="text-white/70">{t(`source.${r.source}`)}</span>
                  <span className="text-white/70">{t(`target.${r.targetType}`)}</span>
                  <span className="text-white/50">{r.category}</span>
                  {r.overdue ? (
                    <span className="rounded bg-red-500/30 px-2 py-0.5 text-red-100">
                      {t("overdue")}
                    </span>
                  ) : null}
                  {r.autoActioned ? (
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-100">
                      {t(r.actionTaken === "hide" ? "auto.hide" : "auto.unpublish")}
                    </span>
                  ) : null}
                  {r.activeEvent ? (
                    <span className="rounded bg-violet-500/20 px-2 py-0.5 text-violet-100">
                      {t("activeEvent")}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm">{r.reason}</p>
                {r.details ? (
                  <pre className="whitespace-pre-wrap text-xs text-white/60">{r.details}</pre>
                ) : null}
                <p className="text-xs text-white/50">
                  {t("meta", {
                    due: when(r.slaDueAt),
                    created: when(r.createdAt),
                    count: r.reportsOnTarget,
                  })}
                </p>
                <p className="font-mono text-[11px] text-white/40">
                  {r.roomId ?? ""} {r.reviewId ?? ""} {r.targetUserId ?? ""}
                </p>
                {noteField(r.id)}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() =>
                      decide(r.id, `/api/admin/reports/${r.id}`, {
                        status: "actioned",
                        resolutionNote: noteOf(r.id),
                      })
                    }
                  >
                    {t("actions.confirm")}
                  </Button>
                  {r.targetType === "room" ? (
                    <Button
                      size="sm"
                      variant="overlay"
                      disabled={busy !== null}
                      onClick={() =>
                        decide(r.id, `/api/admin/reports/${r.id}`, {
                          status: "actioned",
                          action: "warn",
                          resolutionNote: noteOf(r.id),
                        })
                      }
                    >
                      {t("actions.warn")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="overlay"
                    disabled={busy !== null}
                    onClick={() =>
                      decide(r.id, `/api/admin/reports/${r.id}`, {
                        status: "dismissed",
                        resolutionNote: noteOf(r.id),
                      })
                    }
                  >
                    {r.autoActioned ? t("actions.restore") : t("actions.dismiss")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {lists && tab === "appeals" ? (
        lists.appeals.length === 0 ? (
          <p className="text-sm text-white/60">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {lists.appeals.map((a) => (
              <li key={a.id} className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/60">
                  {a.roomId ? t("appeal.room") : t("appeal.account")}
                  {a.overdue ? ` · ${t("overdue")}` : ""}
                </p>
                <p className="text-sm">{a.reason}</p>
                <p className="text-xs text-white/50">
                  {t("meta", { due: when(a.slaDueAt), created: when(a.createdAt), count: 1 })}
                </p>
                <p className="font-mono text-[11px] text-white/40">
                  {a.creatorId} {a.roomId ?? ""}
                </p>
                {noteField(a.id)}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="overlay"
                    disabled={busy !== null}
                    onClick={() =>
                      decide(a.id, `/api/admin/appeals/${a.id}`, {
                        decision: "upheld",
                        resolutionNote: noteOf(a.id),
                      })
                    }
                  >
                    {t("actions.uphold")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() =>
                      decide(a.id, `/api/admin/appeals/${a.id}`, {
                        decision: "overturned",
                        resolutionNote: noteOf(a.id),
                      })
                    }
                  >
                    {t("actions.overturn")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {lists && tab === "audio" ? (
        lists.audio.length === 0 ? (
          <p className="text-sm text-white/60">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {lists.audio.map((a) => (
              <li key={a.id} className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-sm">{a.originalFilename}</p>
                <p className="text-xs text-white/50">
                  {a.ownerId} · {when(a.createdAt)}
                  {a.moderationFlags.length > 0 ? ` · ${a.moderationFlags.join(", ")}` : ""}
                </p>
                {noteField(a.id)}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="overlay"
                    disabled={busy !== null}
                    onClick={() =>
                      decide(a.id, `/api/admin/audio/${a.id}`, { decision: "approved" })
                    }
                  >
                    {t("actions.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy !== null || !noteOf(a.id)}
                    title={t("rejectNeedsNote")}
                    onClick={() =>
                      decide(a.id, `/api/admin/audio/${a.id}`, {
                        decision: "rejected",
                        reason: noteOf(a.id),
                      })
                    }
                  >
                    {t("actions.reject")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
