import type { Metadata } from "next";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SpectatorGame } from "@/components/event-panel/spectator-game";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { buildGameModel } from "@/lib/game-model";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = { params: Promise<{ locale: string; id: string; sessionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "EventPanel" });
  return { title: t("observer.title"), robots: { index: false, follow: false } };
}

/**
 * Modo observador de una sesión de evento (ticket 5.9). Como
 * `/play/session/:sessionId` (5.8), la room `event` ejecuta hoy el paquete
 * del Rey Aldric, así que el
 * modelo público del runtime (sin soluciones) se calcula de ese fixture en
 * servidor. El token de observador lo pide el cliente (solo el organizador lo
 * obtiene) y la room rechaza cualquier acción suya.
 */
export default async function ObserveSessionPage({ params }: Props) {
  const { locale, id, sessionId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("EventPanel");
  const { model } = buildGameModel(loadRoomPackage(readReyAldricRoomPackageJson()), locale);

  return (
    <main className="relative min-h-dvh bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header>
          <p className="text-xs uppercase tracking-wide text-white/50">{t("title")}</p>
          <h1 className="text-2xl font-semibold">{t("observer.title")}</h1>
          <p className="text-sm text-white/60">{model.meta.title}</p>
        </header>
        <SpectatorGame eventId={id} sessionId={sessionId} model={model} />
      </div>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
