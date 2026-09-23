"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Y from "yjs";
import {
  EditToolController,
  EditorSyncProvider,
  initRoomDoc,
  isRoomDocEmpty,
  roomPackageToDoc,
} from "@escaperoom/editor";
import type { EditorPalette } from "@escaperoom/game-runtime";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import type { RoomPreviewPack } from "@/lib/room-preview-pack";
import type { RoomEditorCanvasProps } from "./room-editor-canvas";
import { RoomEditorWorkspace, type RoomEditorStatus } from "./room-editor-workspace";

const RoomEditorCanvas = dynamic(() => import("./room-editor-canvas"), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

function CanvasLoading() {
  const t = useTranslations("RoomEditor");
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      {t("loading")}
    </div>
  );
}

const renderCanvas = (props: RoomEditorCanvasProps) => <RoomEditorCanvas {...props} />;

export interface RoomEditorShellProps {
  roomId: string;
  palette: EditorPalette;
  pack?: RoomPreviewPack;
  /** URL del WebSocket de edición (3.3). */
  syncUrl: string;
  /**
   * Solo desarrollo: abre este paquete en un doc local, sin sincronizar (para
   * probar el editor sin base de datos ni sesión).
   */
  demoPackage?: RoomPackage;
}

type Session = {
  doc: Y.Doc;
  controller: EditToolController;
  provider?: EditorSyncProvider;
};

/**
 * Cierres seguidos sin llegar a sincronizar antes de avisar. El navegador no
 * expone el estado HTTP del handshake (401/403/404 llegan como cierre 1006),
 * así que el aviso es genérico; el proveedor sigue reintentando con backoff.
 */
const FAILED_ATTEMPTS_BEFORE_WARNING = 3;

function createSession(
  props: Pick<RoomEditorShellProps, "roomId" | "syncUrl" | "demoPackage">,
): Session {
  const doc = new Y.Doc();
  if (props.demoPackage) roomPackageToDoc(props.demoPackage, doc);
  const firstRoom = props.demoPackage?.map.rooms[0]?.id ?? "";
  const controller = new EditToolController(doc, { roomId: firstRoom });
  if (props.demoPackage) return { doc, controller };
  const provider = new EditorSyncProvider({ url: props.syncUrl, roomId: props.roomId, doc });
  return { doc, controller, provider };
}

/**
 * Página del editor (`/editor/[roomId]`, specs/09 §1): crea el doc Yjs del
 * borrador, lo conecta al WebSocket de edición con `EditorSyncProvider`
 * (autosave, offline y reconexión de 3.3) y monta el workspace cuando el doc
 * tiene sala. Un borrador vacío se inicializa con una habitación.
 */
export function RoomEditorShell(props: RoomEditorShellProps) {
  const { roomId, syncUrl, demoPackage } = props;
  const t = useTranslations("RoomEditor");
  const locale = useLocale();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<RoomEditorStatus>("connecting");
  const [ready, setReady] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  // El doc y el proveedor viven lo que el efecto (y no lo que el render): en
  // StrictMode el doble montaje crea y destruye una sesión completa.
  useEffect(() => {
    const created = createSession({ roomId, syncUrl, demoPackage });
    const { provider, doc } = created;
    setSession(created);
    setFailedAttempts(0);
    if (!provider) {
      setStatus("local");
      setReady(true);
      return () => doc.destroy();
    }
    setStatus("connecting");
    setReady(false);
    const onStatus = (next: string) =>
      setStatus(
        next === "connected" ? "connected" : next === "connecting" ? "connecting" : "offline",
      );
    const onSynced = (synced: boolean) => {
      if (!synced) return;
      // Borrador recién creado: esqueleto mínimo (si otro colaborador ya lo
      // creó, `initRoomDoc` no hace nada).
      if (isRoomDocEmpty(doc)) {
        initRoomDoc(doc, { id: roomId, title: t("untitledRoom"), language: locale });
      }
      setReady(true);
    };
    const onClose = () => {
      if (!provider.synced) setFailedAttempts((n) => n + 1);
    };
    provider.on("status", onStatus);
    provider.on("synced", onSynced);
    provider.on("connection-close", onClose);
    return () => {
      provider.off("status", onStatus);
      provider.off("synced", onSynced);
      provider.off("connection-close", onClose);
      provider.destroy();
      doc.destroy();
    };
    // `palette`, `t` y `locale` no deben recrear la sesión (solo se usan al crearla).
  }, [roomId, syncUrl, demoPackage]);

  if (!ready || !session) {
    const failing = failedAttempts >= FAILED_ATTEMPTS_BEFORE_WARNING;
    return (
      <p
        role={failing ? "alert" : undefined}
        className={
          failing
            ? "grid h-dvh place-items-center text-sm text-red-200"
            : "grid h-dvh place-items-center text-sm text-white/60"
        }
      >
        {failing ? t("errors.connection") : t("connecting")}
      </p>
    );
  }
  return (
    <RoomEditorWorkspace
      doc={session.doc}
      controller={session.controller}
      palette={props.palette}
      pack={props.pack}
      status={status}
      renderCanvas={renderCanvas}
    />
  );
}
