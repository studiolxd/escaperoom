import { loadRoomPackage } from "@escaperoom/game-runtime";
import { isAnonymous, RoomDraftError } from "@escaperoom/shared/services";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { OnboardingLogin } from "@/components/onboarding/onboarding-login";
import { RoomEditorShell } from "@/components/room-editor/room-editor-shell";
import { resolveActorFromHeaders } from "@/server/context";
import { getRoomDraftService } from "@/server/services";
import { resolveEditorPalette } from "@/lib/editor-palette";
import { EDITOR_SYNC_URL } from "@/lib/editor-sync";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = {
  params: Promise<{ locale: string; roomId: string }>;
  searchParams: Promise<{ demo?: string }>;
};

/** Valor de `?demo=` que abre el fixture del Rey Aldric en un doc local (solo desarrollo). */
const EDITOR_DEMO_FIXTURE = "rey-aldric";

/** Área privada del creador: nunca se indexa (F-14, igual que `creator/chat`). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Editor de salas (ticket 3.1, specs/09 §1): el runtime Phaser en
 * `mode: 'edit'` sobre el doc Yjs del borrador, sincronizado por el WebSocket
 * de edición (3.3). El WebSocket vuelve a comprobar el permiso en su propio
 * handshake (mismo `checkAccess`) porque la sesión puede cambiar entre esta
 * carga y la conexión — pero antes de F-14 la página montaba el editor (y su
 * chrome, controles, `EDITOR_SYNC_URL`) para cualquier visitante anónimo, que
 * solo veía el handshake fallar en bucle. Ahora resuelve el actor aquí:
 * anónimo → pantalla de login; con sesión pero sin permiso, o sala
 * inexistente → `notFound()` (mismo 404 uniforme que el resto del catálogo,
 * para no confirmar qué salas existen).
 *
 * En desarrollo, `?demo=rey-aldric` abre el fixture en un doc local sin
 * sincronizar, para probar el editor sin base de datos ni sesión — se salta
 * la comprobación porque no hay una sala real detrás.
 */
export default async function RoomEditorPage({ params, searchParams }: Props) {
  const { locale, roomId } = await params;
  setRequestLocale(locale);
  const { demo } = await searchParams;

  const isDemo = process.env.NODE_ENV !== "production" && demo === EDITOR_DEMO_FIXTURE;

  if (!isDemo) {
    const actor = await resolveActorFromHeaders(await headers());
    if (isAnonymous(actor)) {
      return (
        <main className="mx-auto max-w-md px-4 py-16">
          <OnboardingLogin callbackURL={`/${locale}/editor/${roomId}`} />
        </main>
      );
    }
    try {
      await getRoomDraftService().checkAccess(actor, roomId);
    } catch (error) {
      if (
        error instanceof RoomDraftError &&
        (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
      ) {
        notFound();
      }
      throw error;
    }
  }

  const demoPackage = isDemo ? loadRoomPackage(readReyAldricRoomPackageJson()) : undefined;
  const { palette, pack } = resolveEditorPalette(demoPackage?.map.tileset);

  return (
    <RoomEditorShell
      roomId={roomId}
      palette={palette}
      pack={pack}
      syncUrl={EDITOR_SYNC_URL}
      demoPackage={demoPackage}
    />
  );
}
