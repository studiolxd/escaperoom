"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Y from "yjs";
import {
  Edit3DController,
  EditToolController,
  EditorSyncProvider,
  deleteRule,
  initRoomDoc,
  isRoomDocEmpty,
  readObject,
  roomDimension,
  roomDocToPackage,
  roomPackageToDoc,
  useRoomPackage,
  useRoomValidation,
  ValidationPanel,
  type EditTarget,
  type InspectorTarget,
  type Tool3DState,
  type ToolState,
  type ValidationPanelLabelsInput,
  type ValidationTarget,
} from "@escaperoom/editor";
import type { RulesGraphLabelsInput, RulesGraphProps } from "@escaperoom/editor/rules-graph";
import type { EditorPalette } from "@escaperoom/game-runtime";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/error-boundary";
import type { Pack3D } from "@/lib/game-model";
import type { RoomPreviewPack } from "@/lib/room-preview-pack";
import { EDITOR_UI_KIT } from "./editor-ui-kit";
import { PlaytestButton } from "./playtest-button";
import type { RoomEditorCanvasProps } from "./room-editor-canvas";
import type { RoomEditorCanvas3DProps } from "./room-editor-canvas-3d";
import { RoomEditorInspector } from "./room-editor-inspector";
import { RoomLobbyIntroDialog } from "./room-lobby-intro-dialog";
import { RoomPlayersDialog } from "./room-players-dialog";
import { RoomTimeLimitDialog } from "./room-time-limit-dialog";
import { RoomEditorWorkspace } from "./room-editor-workspace";
import { RoomEditorWorkspace3D } from "./room-editor-workspace-3d";
import type { CanvasTab, RoomEditorStatus } from "./editor-shared";

const RoomEditorCanvas = dynamic(() => import("./room-editor-canvas"), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

/** Lienzo 3D (Three.js): una sala 2D no lo descarga, ni una 3D descarga Phaser. */
const RoomEditorCanvas3D = dynamic(() => import("./room-editor-canvas-3d"), {
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

export interface RoomEditorShellProps {
  roomId: string;
  palette: EditorPalette;
  pack?: RoomPreviewPack;
  /** Pack 3D (URL base de los GLB y tileset) para el lienzo de las salas 3D. */
  pack3d?: Pack3D;
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
  /** Primera habitación del paquete de demostración (vacío si el doc se sincroniza después). */
  firstRoom: string;
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
  if (props.demoPackage) return { doc, firstRoom };
  const provider = new EditorSyncProvider({ url: props.syncUrl, roomId: props.roomId, doc });
  return { doc, firstRoom, provider };
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
      pack3d={props.pack3d}
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
  pack3d,
  status,
}: {
  roomId: string;
  session: Session;
  palette: EditorPalette;
  pack?: RoomPreviewPack;
  pack3d?: Pack3D;
  status: RoomEditorStatus;
}) {
  const t = useTranslations("RoomEditor");
  const panelLabels = useTranslations("ValidationPanel").raw(
    "labels",
  ) as ValidationPanelLabelsInput;
  const graphLabels = useTranslations("RulesGraph").raw("labels") as RulesGraphLabelsInput;
  const { doc } = session;
  // La dimensión de la sala no cambia: el borrador ya está sincronizado cuando se monta esto.
  const is3d = roomDimension(doc) === "3d";
  const controller = useMemo<EditToolController | Edit3DController>(
    () =>
      is3d
        ? new Edit3DController(doc, { roomId: session.firstRoom })
        : new EditToolController(doc, { roomId: session.firstRoom }),
    [doc, is3d, session.firstRoom],
  );
  const validation = useRoomValidation(doc, roomDocToPackage);
  const pkg = useRoomPackage(doc);
  const state = useSyncExternalStore<ToolState | Tool3DState>(
    controller.subscribe,
    controller.getState as () => ToolState | Tool3DState,
    controller.getState as () => ToolState | Tool3DState,
  );
  const [picked, setPicked] = useState<InspectorTarget | null>(null);
  const [canvasTab, setCanvasTab] = useState<CanvasTab>("map");
  const [focusRuleId, setFocusRuleId] = useState<string | undefined>(undefined);

  // Seleccionar un objeto en el lienzo sustituye al puzzle/regla elegido. En 3D, solo cuenta
  // un único objeto seleccionado (con varios elementos, manda el puzle o la regla elegidos).
  const selectedObjectId = is3d
    ? singleObjectId((state as Tool3DState).selection)
    : (state as ToolState).selectedObjectId;
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
      if (controller instanceof Edit3DController) controller.select([{ kind: "object", id: object.id }]);
      else controller.select(object.id);
      return;
    }
    if (controller instanceof Edit3DController) controller.select([]);
    else controller.select(undefined);
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

  const shared = {
    doc,
    status,
    canvasTab,
    onCanvasTabChange: setCanvasTab,
    rulesGraph: (
      <ErrorBoundary>
        <RulesGraph
          doc={doc}
          labels={graphLabels}
          issues={validation.ruleGraphIssues}
          height="100%"
          focusRuleId={focusRuleId}
          onSelectRule={(ruleId) => select({ kind: "rule", id: ruleId })}
          components={EDITOR_UI_KIT}
        />
      </ErrorBoundary>
    ),
    inspector: (
      <RoomEditorInspector
        doc={doc}
        target={inspectorTarget}
        onSelect={select}
        onOpenRule={openRule}
        onDelete={inspectorTarget?.kind === "puzzle" ? undefined : deleteTarget}
        loadUploads={status !== "local"}
        pack={pack}
      />
    ),
    validation: (
      <ValidationPanel
        state={validation}
        labels={panelLabels}
        onSelectTarget={selectTarget}
        components={EDITOR_UI_KIT}
      />
    ),
    headerActions: (
      <>
        <RoomPlayersDialog doc={doc} players={pkg.meta.players} />
        <RoomTimeLimitDialog doc={doc} timeLimitMinutes={pkg.meta.timeLimitMinutes} />
        <RoomLobbyIntroDialog
          roomId={roomId}
          doc={doc}
          pkg={pkg}
          pack={pack}
          uploadsEnabled={status !== "local"}
          onEditLobby={(lobbyId) => {
            setCanvasTab("map");
            controller.setRoom(lobbyId);
          }}
        />
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
    ),
  };

  if (controller instanceof Edit3DController) {
    return (
      <RoomEditorWorkspace3D
        {...shared}
        controller={controller}
        pack3d={pack3d}
        renderCanvas={(canvasProps: RoomEditorCanvas3DProps) => (
          <ErrorBoundary
            layout="overlay"
            title={t("canvasErrorTitle")}
            description={t("canvasErrorDescription")}
          >
            <RoomEditorCanvas3D {...canvasProps} />
          </ErrorBoundary>
        )}
      />
    );
  }

  return (
    <RoomEditorWorkspace
      {...shared}
      controller={controller}
      palette={palette}
      pack={pack}
      renderCanvas={(canvasProps: RoomEditorCanvasProps) => (
        <ErrorBoundary
          layout="overlay"
          title={t("canvasErrorTitle")}
          description={t("canvasErrorDescription")}
        >
          <RoomEditorCanvas {...canvasProps} />
        </ErrorBoundary>
      )}
    />
  );
}

/** Id del objeto si es lo único seleccionado en el editor 3D. */
function singleObjectId(selection: readonly EditTarget[]): string | undefined {
  const only = selection.length === 1 ? selection[0] : undefined;
  return only?.kind === "object" ? only.id : undefined;
}
