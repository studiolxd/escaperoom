import { isAnonymous } from "@escaperoom/shared/services";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CreatorChat } from "@/components/creator-chat/creator-chat";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { resolveActorFromHeaders } from "@/server/context";
import { readCreatorChatConfig } from "@/server/creator-chat/config";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ roomId?: string | string[] }>;
};

/** Área privada del creador: nunca se indexa. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** `?roomId=` válido (el id de un draft) o `null`. */
function roomIdParam(raw: string | string[] | undefined): string | null {
  return typeof raw === "string" && /^[\w-]{1,100}$/.test(raw) ? raw : null;
}

/**
 * Chat del creador (ticket 4.6, specs/10 §4): el creador describe su sala y
 * el asistente crea o edita el draft con las tools del MCP del creador. Con
 * `?roomId=` el chat arranca sobre ese draft. Sin `ANTHROPIC_API_KEY` la
 * página indica que el chat no está configurado; sin sesión, que hay que
 * iniciarla.
 */
export default async function CreatorChatPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "CreatorChat" });
  const roomId = roomIdParam((await searchParams).roomId);
  const config = readCreatorChatConfig();
  const actor = config.configured ? await resolveActorFromHeaders(await headers()) : null;

  return (
    <main className="relative flex h-dvh flex-col bg-slate-950 p-4 text-white">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{t("title")}</h1>
            <p className="text-sm text-white/70">{t("intro")}</p>
          </div>
          <LocaleSwitcher />
        </div>
        {!config.configured ? (
          <p role="status" className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            {t("notConfigured")}
          </p>
        ) : !actor || isAnonymous(actor) ? (
          <p role="alert" className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            {t("loginRequired")}
          </p>
        ) : (
          <CreatorChat locale={locale} initialRoomId={roomId} />
        )}
      </div>
    </main>
  );
}
