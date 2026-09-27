"use client";

import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { CHAT_MAX_LENGTH } from "@escaperoom/shared/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ChatEntry {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  filtered: boolean;
}

export interface ChatWindowProps {
  messages: readonly ChatEntry[];
  selfId: string | null;
  connected: boolean;
  /** Último rechazo del servidor (p. ej. rate limit). */
  error?: string | null;
  onSend?: (text: string) => void;
  className?: string;
}

/**
 * Ventana de chat del overlay (ticket 2.1, specs/11 §4.4).
 *
 * Presentacional: pinta `state.chat` (ventana móvil de 50) de la room en la que
 * se esté —el lobby de pruebas (0.5) o la `GameRoom`— y delega el envío en
 * `onSend`, que escribe en esa room. El servidor es autoritativo: aquí solo se
 * pinta lo que llega; los rechazos (rate limit) se muestran con su mensaje.
 */
/**
 * F-4: memoizado — con `toGameSnapshot` incremental (`session/snapshot.ts`),
 * `messages` mantiene la misma referencia entre patches de Colyseus que no
 * tocan el chat (~20 Hz), así que `React.memo` evita repintar la ventana
 * completa (lista, formulario) en cada uno de esos patches.
 */
export const ChatWindow = memo(function ChatWindow({
  messages,
  selfId,
  connected,
  error: chatError = null,
  onSend: sendChat,
  className,
}: ChatWindowProps) {
  const t = useTranslations("Chat");
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages.length]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !sendChat) {
      return;
    }
    sendChat(text);
    setDraft("");
  }

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "pointer-events-auto z-30 flex w-72 flex-col gap-2 rounded-xl border border-border bg-card/75 p-3 text-foreground backdrop-blur",
        className,
      )}
    >
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground">{t("title")}</h2>

      <ul
        ref={listRef}
        aria-live="polite"
        className="flex h-48 flex-col gap-1.5 overflow-y-auto pr-1"
      >
        {messages.map((message) => (
          <li key={message.id} className="text-xs leading-snug">
            <span className={message.authorId === selfId ? "text-sky-600 dark:text-sky-300" : "text-muted-foreground"}>
              {message.authorName}
            </span>
            {message.filtered ? (
              <span
                title={t("filteredTitle")}
                className="ml-1 rounded bg-rose-500/20 px-1 text-[10px] text-rose-700 dark:text-rose-200"
              >
                {t("filtered")}
              </span>
            ) : null}
            <p className="break-words text-foreground">{message.text}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          disabled={!connected}
          placeholder={connected ? t("placeholder") : t("disconnected")}
          aria-label={t("placeholder")}
          className="h-auto min-w-0 flex-1 rounded-md px-2 py-1 text-sm disabled:opacity-50"
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!connected || draft.trim().length === 0}
        >
          {t("send")}
        </Button>
      </form>

      {chatError ? (
        <p aria-live="polite" className="text-xs text-rose-600 dark:text-rose-300">
          {chatError}
        </p>
      ) : null}
    </section>
  );
});
