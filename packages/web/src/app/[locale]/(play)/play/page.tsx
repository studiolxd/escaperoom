import type { Metadata } from "next";
import { isDevFallbackAllowed } from "@escaperoom/env";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { readGameAccessTokenConfig, signGameAccessToken } from "@escaperoom/shared/game-access-token";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
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
 *
 * La partida de prueba (sin `?session`, C-4) exige un `gameToken` `dev_test`:
 * esta página lo firma en el servidor (nunca en el cliente) y solo fuera de
 * producción (`isDevFallbackAllowed`, el mismo criterio que colyseus-server
 * usa para aceptarlo) — en producción real no hay partida de prueba sin
 * compra, así que la página no existe (`notFound`). La suite E2E arranca con
 * `NODE_ENV=production` pero `ALLOW_DEV_SECRETS=1` a propósito
 * (`packages/e2e/support/env.ts`), así que sigue viendo la página.
 */
export default async function PlayPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { room, session } = await searchParams;
  setRequestLocale(locale);

  if (session === undefined && !isDevFallbackAllowed()) {
    notFound();
  }

  const t = await getTranslations("Game");

  const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
  const { model, pack } = buildGameModel(roomPackage, locale);
  const roomId = typeof room === "string" && /^[\w-]{1,64}$/u.test(room) ? room : undefined;
  const sessionId =
    typeof session === "string" && /^[\w-]{1,64}$/u.test(session) ? session : undefined;
  const gameToken = sessionId ? undefined : signDevTestGameToken();

  return (
    <main className="relative min-h-dvh bg-slate-950 p-4">
      {sessionId ? (
        <EventGame model={model} pack={pack} sessionId={sessionId} subtitle={t("page.subtitle")} />
      ) : (
        <NetworkGame
          model={model}
          pack={pack}
          target={{
            kind: "game",
            packageId: PACKAGE_ID,
            ...(roomId ? { roomId } : {}),
            ...(gameToken ? { gameToken } : {}),
          }}
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

/**
 * `gameToken` `dev_test` firmado en el servidor (C-4): sin él, `GameRoom`
 * rechaza el `create`/`join`. `undefined` si falta el secreto — no debería
 * pasar aquí (ya se comprobó `isDevFallbackAllowed`), pero nunca lanza: la
 * conexión del cliente falla con un error legible en vez de romper el SSR.
 */
function signDevTestGameToken(): string | undefined {
  const config = readGameAccessTokenConfig();
  if (!config) return undefined;
  const now = Date.now();
  return signGameAccessToken(
    config.secret,
    { kind: "dev_test", label: "es-play" },
    { now, expiresAt: now + config.ttlSeconds * 1000 },
  );
}
