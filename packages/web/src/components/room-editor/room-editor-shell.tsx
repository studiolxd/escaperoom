"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Y from "yjs";
import {
  EditToolController,
  EditorSyncProvider,
  deleteRule,
  initRoomDoc,
  isRoomDocEmpty,
  readObject,
  roomDocToPackage,
  roomPackageToDoc,
  useRoomValidation,
  ValidationPanel,
  type InspectorTarget,
  type ValidationPanelLabelsInput,
  type ValidationTarget,
} from "@escaperoom/editor";
import type { RulesGraphLabelsInput, RulesGraphProps } from "@escaperoom/editor/rules-graph";
import type { EditorPalette } from "@escaperoom/game-runtime";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/error-boundary";
import type { RoomPreviewPack } from "@/lib/room-preview-pack";
import { PlaytestButton } from "./playtest-button";
import type { RoomEditorCanvasProps } from "./room-editor-canvas";
import { RoomEditorInspector } from "./room-editor-inspector";
import {
  RoomEditorWorkspace,
  type CanvasTab,
  type RoomEditorStatus,
} from "./room-editor-workspace";

const RoomEditorCanvas = dynamic(() => import("./room-editor-canvas"), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

/**
 * React Flow (`@xyflow/react`) y su CSS solo se descargan al montar el grafo
 * de reglas, no en el bundle inicial del editor (auditoría F-16): antes se
 * importaban desde el barrel de `@escaperoom/editor` de forma estática, igual
 * que el resto del editor (que sí necesita cargar de inmediato).
 */
const RulesGraph = dynamic<RulesGraphProps>(
  () => import("@escaperoom/editor/rules-graph").then((mod) => mod.RulesGraph),
  { ssr: false },
);

function CanvasLoading() {
  const t = useTranslations("RoomEditor");
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      {t("loading")}
    </div>
  );
}

const renderCanvas = (props: RoomEditorCanvasProps) => (
  <ErrorBoundary>
    <RoomEditorCanvas {...props} />
  </ErrorBoundary>
);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <ValidatedWorkspace
      roomId={roomId}
      session={session}
      palette={props.palette}
      pack={props.pack}
      status={status}
    />
  );
}

/**
 * Workspace con el validador de 3.7 cableado a la serialización del editor:
 * revalida en cada cambio del doc (con debounce), «Validar» fuerza una pasada
 * y un clic en un elemento señalado lo selecciona (objeto en el lienzo, puzzle
 * o regla en el inspector).
 *
 * Selección del inspector (3.4): un objeto seleccionado en el lienzo manda
 * (`EditToolController`); si no hay, se muestra el puzzle o la regla elegidos
 * en el inspector, el grafo o el panel del validador. «Ver en el grafo» abre
 * la pestaña de reglas centrada en esa regla.
 */
function ValidatedWorkspace({
  roomId,
  session,
  palette,
  pack,
  status,
}: {
  roomId: string;
  session: Session;
  palette: EditorPalette;
  pack?: RoomPreviewPack;
  status: RoomEditorStatus;
}) {
  const t = useTranslations("RoomEditor");
  const panelLabels = useTranslations("ValidationPanel").raw(
    "labels",
  ) as ValidationPanelLabelsInput;
  const graphLabels = useTranslations("RulesGraph").raw("labels") as RulesGraphLabelsInput;
  const { doc, controller } = session;
  const validation = useRoomValidation(doc, roomDocToPackage);
  const tools = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const [picked, setPicked] = useState<InspectorTarget | null>(null);
  const [canvasTab, setCanvasTab] = useState<CanvasTab>("map");
  const [focusRuleId, setFocusRuleId] = useState<string | undefined>(undefined);

  // Seleccionar un objeto en el lienzo sustituye al puzzle/regla elegido.
  const selectedObjectId = tools.selectedObjectId;
  useEffect(() => {
    if (selectedObjectId) setPicked(null);
  }, [selectedObjectId]);
  const inspectorTarget: InspectorTarget | null = selectedObjectId
    ? { kind: "object", id: selectedObjectId }
    : picked;

  const select = (target: InspectorTarget | null) => {
    if (target?.kind === "object") {
      const object = readObject(doc, target.id);
      if (!object) return;
      controller.setRoom(object.roomId);
      controller.select(object.id);
      return;
    }
    controller.select(undefined);
    setPicked(target);
  };

  const openRule = (ruleId: string) => {
    setCanvasTab("rules");
    setFocusRuleId(ruleId);
  };

  const deleteTarget = (target: InspectorTarget) => {
    if (target.kind === "object") controller.deleteSelection();
    else if (target.kind === "rule") {
      deleteRule(doc, target.id);
      setPicked(null);
    }
  };

  const selectTarget = (target: ValidationTarget) => {
    if (target.kind === "object" || target.kind === "puzzle" || target.kind === "rule") {
      select({ kind: target.kind, id: target.id });
    }
  };

  return (
    <RoomEditorWorkspace
      doc={doc}
      controller={controller}
      palette={palette}
      pack={pack}
      status={status}
      renderCanvas={renderCanvas}
      canvasTab={canvasTab}
      onCanvasTabChange={setCanvasTab}
      rulesGraph={
        <ErrorBoundary>
          <RulesGraph
            doc={doc}
            labels={graphLabels}
            issues={validation.ruleGraphIssues}
            height="100%"
            focusRuleId={focusRuleId}
            onSelectRule={(ruleId) => select({ kind: "rule", id: ruleId })}
          />
        </ErrorBoundary>
      }
      inspector={
        <RoomEditorInspector
          doc={doc}
          target={inspectorTarget}
          onSelect={select}
          onOpenRule={openRule}
          onDelete={inspectorTarget?.kind === "puzzle" ? undefined : deleteTarget}
          loadUploads={status !== "local"}
          pack={pack}
        />
      }
      validation={
        <ValidationPanel state={validation} labels={panelLabels} onSelectTarget={selectTarget} />
      }
      headerActions={
        <>
          <Button
            size="sm"
            variant="ghost"
            className="border border-white/15 text-white hover:bg-white/10"
            onClick={() => validation.validateNow()}
          >
            {t("header.validate")}
          </Button>
          <PlaytestButton roomId={roomId} disabled={!session.provider} />
        </>
      }
    />
  );
}
