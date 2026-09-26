import type { Metadata } from "next";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EventGame } from "@/components/game-session/event-game";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { buildGameModel } from "@/lib/game-model";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = {
  params: Promise<{ locale: string; sessionId: string }>;
};

/** Una partida concreta no se indexa: el link solo sirve para jugar tras el canje. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Partida de una sesión de evento (ticket 5.8) tras el canje: el `joinToken`
 * viaja en el fragmento de la URL (`/play/session/<sessionId>#joinToken=…`,
 * nunca al servidor web ni a sus logs). El servidor resuelve el paquete y es
 * la única fuente de verdad; aquí solo se calcula el modelo público del
 * runtime (por ahora, único paquete de demo: Rey Aldric).
 *
 * Antes vivía en `/play?session=<id>`, junto a la partida de prueba sin
 * cuenta (retirada, DEUDA); esta ruta separada mantiene el canje de eventos
 * funcionando aunque `/play` (a secas) ya no exista.
 */
export default async function EventSessionPage({ params }: Props) {
  const { locale, sessionId } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Game");
  const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
  const { model, pack } = buildGameModel(roomPackage, locale);

  return (
    <main className="relative min-h-dvh bg-slate-950 p-4">
      <EventGame model={model} pack={pack} sessionId={sessionId} subtitle={t("page.subtitle")} />
      <div className="absolute right-4 top-4 z-50">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
