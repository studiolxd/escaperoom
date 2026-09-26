"use client";

import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH } from "@escaperoom/shared/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLobbyStore, type ChatEntry } from "@/store/lobby-store";

/**
 * Chat del lobby de pruebas: la ventana de chat conectada al store del lobby.
 */
export function ChatPanel() {
  const messages = useLobbyStore((state) => state.chat);
  const sendChat = useLobbyStore((state) => state.sendChat);
  const chatError = useLobbyStore((state) => state.chatError);
  const status = useLobbyStore((state) => state.status);
  const selfId = useLobbyStore((state) => state.selfId);
  return (
    <ChatWindow
      messages={messages}
      selfId={selfId}
      connected={status === "connected"}
      error={chatError}
      onSend={sendChat ?? undefined}
    />
  );
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
        "pointer-events-auto flex w-72 flex-col gap-2 rounded-xl border border-white/10 bg-black/50 p-3 text-white backdrop-blur",
        className,
      )}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-white/60">{t("title")}</h2>
        <span className="font-mono text-[10px] text-white/40">
          {messages.length}/{CHAT_HISTORY_LIMIT}
        </span>
      </header>

      <ul
        ref={listRef}
        aria-live="polite"
        className="flex h-48 flex-col gap-1.5 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <li className="text-xs text-white/40">{t("empty")}</li>
        ) : (
          messages.map((message) => (
            <li key={message.id} className="text-xs leading-snug">
              <span className={message.authorId === selfId ? "text-sky-300" : "text-white/70"}>
                {message.authorName}
              </span>
              {message.filtered ? (
                <span
                  title={t("filteredTitle")}
                  className="ml-1 rounded bg-rose-500/20 px-1 text-[10px] text-rose-200"
                >
                  {t("filtered")}
                </span>
              ) : null}
              <p className="break-words text-white/90">{message.text}</p>
            </li>
          ))
        )}
      </ul>

      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          disabled={!connected}
          placeholder={connected ? t("placeholder") : t("disconnected")}
          aria-label={t("placeholder")}
          className="h-auto min-w-0 flex-1 rounded-md border-white/15 bg-white/5 px-2 py-1 text-sm text-white placeholder:text-white/40 focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-50"
        />
        <Button
          type="submit"
          variant="overlay"
          size="sm"
          disabled={!connected || draft.trim().length === 0}
        >
          {t("send")}
        </Button>
      </form>

      {chatError ? (
        <p aria-live="polite" className="text-xs text-rose-300">
          {chatError}
        </p>
      ) : (
        <p className="text-[10px] text-white/40">{t("hint", { max: CHAT_MAX_LENGTH })}</p>
      )}
    </section>
  );
});
