"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import {
  CREATOR_CHAT_ENDPOINT,
  CREATOR_CHAT_MAX_MESSAGE_CHARS,
  readChatEvents,
  type CreatorChatRequest,
} from "@/lib/creator-chat-protocol";
import {
  addNotice,
  applyChatEvent,
  asChatErrorCode,
  finishResponse,
  initialCreatorChatState,
  startUserMessage,
  type CreatorChatItem,
  type CreatorChatNotice,
  type CreatorChatState,
} from "@/lib/creator-chat-state";

export interface CreatorChatProps {
  locale: string;
  /** Draft sobre el que abrir el chat (`?roomId=`). */
  initialRoomId?: string | null;
  /** Estado inicial (tests de render). */
  initialState?: CreatorChatState;
}

/**
 * Chat del creador (ticket 4.6): el creador escribe, el asistente responde en
 * streaming y cada llamada a una tool del MCP aparece con su resultado. El
 * enlace al editor se muestra en cuanto la conversación tiene draft.
 */
export function CreatorChat({ locale, initialRoomId = null, initialState }: CreatorChatProps) {
  const t = useTranslations("CreatorChat");
  const [state, setState] = useState<CreatorChatState>(
    () => initialState ?? initialCreatorChatState(initialRoomId),
  );
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [state.items]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || state.pending || state.closed) return;
    setDraft("");
    setState((current) => startUserMessage(current, message));
    const body: CreatorChatRequest = state.conversationId
      ? { message, conversationId: state.conversationId }
      : { message, locale, ...(state.roomId ? { roomId: state.roomId } : {}) };
    try {
      const res = await fetch(CREATOR_CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        setState((current) =>
          addNotice(current, { kind: "error", code: asChatErrorCode(json?.error?.code) }),
        );
        return;
      }
      for await (const event of readChatEvents(res.body)) {
        setState((current) => applyChatEvent(current, event));
      }
      setState(finishResponse);
    } catch {
      setState((current) => addNotice(current, { kind: "error", code: "UNKNOWN" }));
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  };
  const restart = () => {
    setState(initialCreatorChatState(state.roomId));
    setDraft("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {state.roomId ? (
          <Link
            href={`/editor/${state.roomId}`}
            className="rounded-md border border-white/20 px-3 py-1.5 text-white hover:bg-white/10"
          >
            {t("openEditor")}
          </Link>
        ) : (
          <span className="text-white/60">{t("noRoom")}</span>
        )}
        <div className="flex items-center gap-3">
          {state.usage ? (
            <span className="text-white/60" aria-live="polite">
              {t("usage", {
                turns: state.usage.turns,
                maxTurns: state.usage.maxTurns,
                tokens: state.usage.tokens,
                maxTokens: state.usage.maxTokens,
              })}
            </span>
          ) : null}
          {state.items.length > 0 && !state.pending ? (
            <Button variant="overlayGhost" size="sm" onClick={restart}>
              {t("newConversation")}
            </Button>
          ) : null}
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-4"
        aria-live="polite"
        aria-busy={state.pending}
      >
        {state.items.length === 0 ? (
          <p className="text-sm text-white/60">{t("empty")}</p>
        ) : (
          <CreatorChatThread items={state.items} />
        )}
        {state.pending ? (
          <p role="status" className="mt-3 text-sm text-white/60">
            {t("thinking")}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <Label className="sr-only" htmlFor="creator-chat-input">
          {t("placeholder")}
        </Label>
        <Textarea
          id="creator-chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={CREATOR_CHAT_MAX_MESSAGE_CHARS}
          rows={3}
          disabled={state.closed}
          placeholder={state.closed ? t("closed") : t("placeholder")}
          className="min-h-0 flex-1 resize-none rounded-md border-white/20 bg-slate-900 p-2 text-sm text-white placeholder:text-white/40"
        />
        <Button
          type="submit"
          variant="overlay"
          disabled={state.pending || state.closed || draft.trim().length === 0}
        >
          {state.pending ? t("sending") : t("send")}
        </Button>
      </form>
    </div>
  );
}

/** Hilo del chat: mensajes, llamadas a tools con su resultado y avisos. */
export function CreatorChatThread({ items }: { items: readonly CreatorChatItem[] }) {
  const t = useTranslations("CreatorChat");
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.id}>
          {item.kind === "user" ? (
            <div className="ml-auto max-w-[85%] rounded-lg bg-sky-800/60 px-3 py-2 text-sm whitespace-pre-wrap">
              <span className="sr-only">{t("you")}: </span>
              {item.text}
            </div>
          ) : item.kind === "assistant" ? (
            <div className="max-w-[85%] rounded-lg bg-white/10 px-3 py-2 text-sm whitespace-pre-wrap">
              <span className="sr-only">{t("assistant")}: </span>
              {item.text}
            </div>
          ) : item.kind === "tool" ? (
            <ToolCard item={item} />
          ) : (
            <NoticeLine notice={item.notice} />
          )}
        </li>
      ))}
    </ol>
  );
}

const STATUS_ICON = { running: "⏳", ok: "✅", error: "❌" } as const;

function ToolCard({ item }: { item: Extract<CreatorChatItem, { kind: "tool" }> }) {
  const t = useTranslations("CreatorChat");
  const border =
    item.status === "error"
      ? "border-red-400/50"
      : item.status === "ok"
        ? "border-emerald-400/30"
        : "border-white/20";
  return (
    <div
      className={`rounded-lg border ${border} bg-slate-900/60 px-3 py-2 text-xs`}
      data-tool={item.name}
      data-status={item.status}
    >
      <p className="font-mono text-sm">
        <span aria-hidden="true">{STATUS_ICON[item.status]} </span>
        {item.name}
        <span className="ml-2 font-sans text-white/60">{t(`tool.${item.status}`)}</span>
        {item.code ? <span className="ml-2 font-sans text-red-300">{item.code}</span> : null}
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-white/60">{t("tool.input")}</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-white/70">
          {JSON.stringify(item.input, null, 2)}
        </pre>
      </details>
      {item.text ? (
        <details className="mt-1" open={item.status === "error"}>
          <summary className="cursor-pointer text-white/60">{t("tool.result")}</summary>
          <pre
            className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words ${item.status === "error" ? "text-red-200" : "text-white/80"}`}
          >
            {item.text}
          </pre>
        </details>
      ) : null}
      {item.link ? (
        <div className="mt-2 space-y-1">
          <a
            href={item.link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-400"
          >
            {t(`links.${item.link.kind}`)}
          </a>
          {item.link.kind === "publish_confirm" ? (
            <p className="text-amber-200">{t("publishNote")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NoticeLine({ notice }: { notice: CreatorChatNotice }) {
  const t = useTranslations("CreatorChat");
  const text =
    notice.kind === "limit"
      ? t(`limit.${notice.reason}`)
      : notice.kind === "stop"
        ? t(`stop.${notice.reason}`)
        : t(`errors.${notice.code}`);
  return (
    <p role="alert" className="text-sm text-amber-200">
      {text}
    </p>
  );
}
