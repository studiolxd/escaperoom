import type { Metadata } from "next";
import { isDevFallbackAllowed } from "@escaperoom/env";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { readGameAccessTokenConfig, signGameAccessToken } from "@escaperoom/shared/game-access-token";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { NetworkGameDev } from "@/components/game-session/network-game-dev";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { buildGameModel } from "@/lib/game-model";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ room?: string | string[] }>;
};

/** Página de pruebas, nunca indexable. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Id del paquete que resuelve la `GameRoom` (`REY_ALDRIC_PACKAGE_ID` del servidor). */
const PACKAGE_ID = "room-rey-aldric";

/**
 * `GameRoom` "desnuda" de pruebas — retirada de `/[locale]/play` (DEUDA): sin
 * cuenta ni sala real, solo fuera de producción (`isDevFallbackAllowed`,
 * comprobado también en el servidor al verificar el `gameToken`). Su único
 * uso hoy es el E2E de reconexión (`game.reconnect.spec.ts`), que necesita
 * recargar la página o cerrar y reabrir la pestaña sin perder la partida: el
 * flujo real de sala gratis (`/play/room/:roomId`) no sirve para esto porque
 * cada emisión de `free-access` corresponde a una `GameRoom` NUEVA (specs/13),
 * así que no hay forma de recuperar la sala tras perder el `gameToken` de la
 * pestaña. Un `gameToken` `kind: "dev_test"` no necesita eso: se puede volver
 * a firmar en cada carga sin depender de nada persistido en el cliente.
 */
export default async function DevGameRoomPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { room } = await searchParams;
  setRequestLocale(locale);

  if (!isDevFallbackAllowed()) notFound();

  const t = await getTranslations("Game");
  const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
  const { model, pack } = buildGameModel(roomPackage, locale);
  const roomId = typeof room === "string" && /^[\w-]{1,64}$/u.test(room) ? room : undefined;
  const gameToken = signDevTestGameToken();

  return (
    <main className="relative min-h-dvh bg-slate-950 p-4">
      <NetworkGameDev
        model={model}
        pack={pack}
        target={{ kind: "game", packageId: PACKAGE_ID, ...(roomId ? { roomId } : {}), gameToken }}
        subtitle={t("page.subtitle")}
      />
      <div className="absolute right-4 top-4 z-50">
        <LocaleSwitcher />
      </div>
    </main>
  );
}

/**
 * `gameToken` `dev_test` firmado en el servidor: sin él, `GameRoom` rechaza
 * el `create`/`join`. `undefined` si falta el secreto — no debería pasar
 * (ya se comprobó `isDevFallbackAllowed`), pero nunca lanza.
 */
function signDevTestGameToken(): string | undefined {
  const config = readGameAccessTokenConfig();
  if (!config) return undefined;
  const now = Date.now();
  return signGameAccessToken(
    config.secret,
    { kind: "dev_test", label: "e2e-reconnect" },
    { now, expiresAt: now + config.ttlSeconds * 1000 },
  );
}
