import type { Metadata } from "next";
import { ANONYMOUS_ACTOR, CatalogError } from "@escaperoom/shared/services";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RoomGame } from "@/components/game-session/room-game";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { buildGameModel } from "@/lib/game-model";
import { getCatalogService, getGameAccessStore } from "@/server/services";

type Props = {
  params: Promise<{ locale: string; roomId: string }>;
  searchParams: Promise<{ join?: string | string[] }>;
};

/** Una partida concreta no se indexa: el link solo sirve para jugar. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Jugar una sala REAL comprada o gratis (puntos f/i de "CTA Jugar",
 * `docs/DEUDA.md`): el CTA de la ficha de sala ya resolvió el acceso
 * (`GET /api/rooms/:roomId/access` o `/free-access`) y trae el `gameToken` en
 * el fragmento de la URL — esta página solo construye el modelo de cliente de
 * la ÚLTIMA versión publicada (la misma que el token autoriza; si se publicó
 * una nueva versión justo entre medias, la `GameRoom` es la única fuente de
 * verdad y rechazaría un `roomVersionId` que no coincida). Sin `?join`, el
 * cliente CREA la `GameRoom`; con `?join=<id>`, se UNE a una ya en curso.
 */
export default async function RoomGamePage({ params, searchParams }: Props) {
  const { locale, roomId } = await params;
  const { join } = await searchParams;
  setRequestLocale(locale);

  const room = await getCatalogService()
    .getRoom(ANONYMOUS_ACTOR, roomId)
    .catch((err: unknown) => {
      if (err instanceof CatalogError && err.code === "ROOM_NOT_FOUND") return null;
      throw err;
    });
  if (!room) notFound();

  const roomPackage = await getGameAccessStore().loadRoomVersionPackage(room.latestVersion.id);
  if (!roomPackage) notFound();

  const { model, pack } = buildGameModel(roomPackage, locale);
  const joinRoomId = typeof join === "string" && /^[\w-]{1,64}$/u.test(join) ? join : undefined;
  const t = await getTranslations("Game");

  return (
    <main className="relative min-h-dvh bg-slate-950 p-4">
      <RoomGame
        model={model}
        pack={pack}
        roomId={room.id}
        joinRoomId={joinRoomId}
        subtitle={t("page.subtitle")}
      />
      <div className="absolute right-4 top-4 z-50">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
