import type { Metadata } from "next";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EventGame } from "@/components/game-session/event-game";
import { NetworkGame } from "@/components/game-session/network-game";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { buildGameModel } from "@/lib/game-model";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ room?: string | string[]; session?: string | string[] }>;
};

/** Una partida concreta no se indexa: el link solo sirve para invitar. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Id del paquete que resuelve la `GameRoom` (`REY_ALDRIC_PACKAGE_ID` del servidor). */
const PACKAGE_ID = "room-rey-aldric";

/**
 * Partida en red del Rey Aldric (fase 2, hito 2): sin `?room` crea una
 * `GameRoom` nueva y deja el link de invitación en la URL; con `?room=<id>` se
 * une a esa partida; con `?session=<id>` (y el `joinToken` del canje en el
 * fragmento) entra en la room `event` de esa sesión (ticket 5.8). El servidor
 * resuelve el paquete y es la única fuente de verdad; aquí solo se calcula el
 * modelo público del runtime.
 */
export default async function PlayPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { room, session } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Game");

  const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
  const { model, pack } = buildGameModel(roomPackage, locale);
  const roomId = typeof room === "string" && /^[\w-]{1,64}$/u.test(room) ? room : undefined;
  const sessionId =
    typeof session === "string" && /^[\w-]{1,64}$/u.test(session) ? session : undefined;

  return (
    <main className="relative min-h-dvh bg-slate-950 p-4">
      {sessionId ? (
        <EventGame model={model} pack={pack} sessionId={sessionId} subtitle={t("page.subtitle")} />
      ) : (
        <NetworkGame
          model={model}
          pack={pack}
          target={{ kind: "game", packageId: PACKAGE_ID, ...(roomId ? { roomId } : {}) }}
          subtitle={t("page.subtitle")}
          invite
        />
      )}
      <div className="absolute right-4 top-4 z-50">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
