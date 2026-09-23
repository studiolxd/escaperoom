"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH } from "@escaperoom/shared/chat";
import { Button } from "@/components/ui/button";
import { useLobbyStore } from "@/store/lobby-store";

/**
 * Ventana de chat del overlay (ticket 2.1, specs/11 §4.4).
 *
 * Reutiliza la conexión Colyseus del lobby (0.5): lee `state.chat` (ventana
 * móvil de 50) del store y envía por `sendChat`, que escribe en la room. El
 * servidor es autoritativo: aquí solo se pinta lo que llega y se delega el
 * envío; los rechazos (rate limit) se muestran con el mensaje del servidor.
 */
export function ChatPanel() {
  const t = useTranslations("Chat");
  const messages = useLobbyStore((state) => state.chat);
  const sendChat = useLobbyStore((state) => state.sendChat);
  const chatError = useLobbyStore((state) => state.chatError);
  const status = useLobbyStore((state) => state.status);
  const selfId = useLobbyStore((state) => state.selfId);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  const connected = status === "connected";

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
      className="pointer-events-auto flex w-72 flex-col gap-2 rounded-xl border border-white/10 bg-black/50 p-3 text-white backdrop-blur"
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
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          disabled={!connected}
          placeholder={connected ? t("placeholder") : t("disconnected")}
          aria-label={t("placeholder")}
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-50"
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
}
