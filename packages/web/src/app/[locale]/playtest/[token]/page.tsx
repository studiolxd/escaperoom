import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NetworkGame } from "@/components/game-session/network-game";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { buildGameModel, type GameModelPayload } from "@/lib/game-model";
import { isPlaytestExpired, readPlaytestToken } from "@/lib/playtest-link";
import { getPlaytestPackageReader } from "@/server/playtest-launcher";

type Props = { params: Promise<{ locale: string; token: string }> };

/** Un borrador en pruebas no se indexa: el link es privado y no sale en el catálogo. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

type Loaded =
  { ok: true; payload: GameModelPayload } | { ok: false; reason: "gone" | "unavailable" };

/** Modelo del runtime del borrador congelado, calculado en servidor (sin soluciones). */
async function loadPlaytestModel(playtestId: string, locale: string): Promise<Loaded> {
  const reader = getPlaytestPackageReader();
  if (!reader) return { ok: false, reason: "unavailable" };
  try {
    const roomPackage = await reader.read(playtestId);
    if (!roomPackage) return { ok: false, reason: "gone" };
    return { ok: true, payload: buildGameModel(roomPackage, locale) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Página del link de prueba (ticket 3.8, specs/09 §3): juega un borrador sin
 * publicar en la room temporal de Colyseus con el cliente de red completo
 * (Phaser + paneles, chat y voz). La abre el autor al pulsar «Jugar» y
 * cualquiera con el link (también invitados sin sesión) hasta que caduca. El
 * token lo verifica el servidor de partidas al entrar; aquí solo se lee su id
 * para pedir (servidor a servidor) el paquete congelado y proyectar el modelo.
 */
export default async function PlaytestPage({ params }: Props) {
  const { locale, token: rawToken } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("EditorPlaytest");
  const token = decodeURIComponent(rawToken);
  const payload = readPlaytestToken(token);
  const expired = payload ? isPlaytestExpired(payload) : false;
  const loaded = payload && !expired ? await loadPlaytestModel(payload.playtestId, locale) : null;

  const notice = !payload
    ? t("page.invalidLink")
    : expired || (loaded && !loaded.ok && loaded.reason === "gone")
      ? t("page.expired")
      : loaded && !loaded.ok
        ? t("page.unavailable")
        : null;

  return (
    <main className="relative min-h-dvh bg-slate-950 p-4 text-white">
      {notice || !payload || !loaded?.ok ? (
        <div className="space-y-4">
          <header className="pr-40">
            <h1 className="text-lg font-semibold">{t("page.title")}</h1>
            <p className="text-sm text-white/60">{t("page.subtitle")}</p>
          </header>
          <p role="alert" className="text-sm text-white/70">
            {notice}
          </p>
        </div>
      ) : (
        <NetworkGame
          model={loaded.payload.model}
          pack={loaded.payload.pack}
          target={{ kind: "playtest", playtestId: payload.playtestId, token }}
          title={`${t("page.title")} · ${loaded.payload.model.meta.title}`}
          subtitle={t("page.subtitle")}
        />
      )}
      <div className="absolute right-4 top-4 z-50">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
