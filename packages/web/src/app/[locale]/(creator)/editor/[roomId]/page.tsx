import { loadRoomPackage } from "@escaperoom/game-runtime";
import { setRequestLocale } from "next-intl/server";
import { RoomEditorShell } from "@/components/room-editor/room-editor-shell";
import { resolveEditorPalette } from "@/lib/editor-palette";
import { EDITOR_SYNC_URL } from "@/lib/editor-sync";
import { readReyAldricRoomPackageJson } from "@/lib/room-preview-fixture";

type Props = {
  params: Promise<{ locale: string; roomId: string }>;
  searchParams: Promise<{ demo?: string }>;
};

/** Valor de `?demo=` que abre el fixture del Rey Aldric en un doc local (solo desarrollo). */
const EDITOR_DEMO_FIXTURE = "rey-aldric";

/**
 * Editor de salas (ticket 3.1, specs/09 §1): el runtime Phaser en
 * `mode: 'edit'` sobre el doc Yjs del borrador, sincronizado por el WebSocket
 * de edición (3.3). El servidor solo resuelve la palette del pack
 * (`medieval-v1`); el acceso al borrador lo decide el handshake del WebSocket
 * (mismo permiso que la API de draft de 3.2).
 *
 * En desarrollo, `?demo=rey-aldric` abre el fixture en un doc local sin
 * sincronizar, para probar el editor sin base de datos ni sesión.
 */
export default async function RoomEditorPage({ params, searchParams }: Props) {
  const { locale, roomId } = await params;
  setRequestLocale(locale);
  const { demo } = await searchParams;

  const demoPackage =
    process.env.NODE_ENV !== "production" && demo === EDITOR_DEMO_FIXTURE
      ? loadRoomPackage(readReyAldricRoomPackageJson())
      : undefined;
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
