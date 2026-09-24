"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type * as Y from "yjs";
import {
  EDIT_TOOLS,
  EDITOR_TILE_LAYERS,
  useRoomPackage,
  type EditToolController,
  type ToolError,
} from "@escaperoom/editor";
import {
  toRuntimeModel,
  type EditPointerEvent,
  type EditorPalette,
  type RuntimeModel,
} from "@escaperoom/game-runtime";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RoomPreviewPack } from "@/lib/room-preview-pack";
import type { RoomEditorCanvasProps } from "./room-editor-canvas";
import { EditorToolHint } from "./editor-tool-hint";
import { RoomEditorPalette } from "./room-editor-palette";
import { RoomEditorRoomPanel } from "./room-editor-room-panel";

/** Botón secundario legible sobre el fondo oscuro del editor. */
const QUIET_BUTTON = "border border-white/15 text-white hover:bg-white/10";

/** Estado de la conexión que muestra la cabecera. */
export type RoomEditorStatus = "local" | "connecting" | "connected" | "offline";

/** Pestañas del área central (specs/09 §4.1): lienzo WYSIWYG o grafo de reglas. */
export const CANVAS_TABS = ["map", "rules"] as const;
export type CanvasTab = (typeof CANVAS_TABS)[number];

export interface RoomEditorWorkspaceProps {
  doc: Y.Doc;
  controller: EditToolController;
  palette: EditorPalette;
  pack?: RoomPreviewPack;
  status: RoomEditorStatus;
  /** Lienzo Phaser (solo cliente); sin él se muestra un marcador (SSR, tests). */
  renderCanvas?: (props: RoomEditorCanvasProps) => ReactNode;
  /** Inspector de propiedades (3.4): estados, reglas y demás del objeto seleccionado. */
  inspector: ReactNode;
  /** Grafo de reglas (3.6) como segunda pestaña del área central. */
  rulesGraph?: ReactNode;
  /** Pestaña activa (controlada por quien monta el editor; por defecto el mapa). */
  canvasTab?: CanvasTab;
  onCanvasTabChange?: (tab: CanvasTab) => void;
  /** Panel del validador (3.7), bajo la selección. */
  validation?: ReactNode;
  /** Acciones de cabecera: validar (3.7), jugar (3.8), publicar (3.9). */
  headerActions: ReactNode;
}

/** Último `RuntimeModel` válido del paquete: un estado intermedio inválido no vacía el lienzo. */
function useRuntimeModel(pkg: RoomPackage, locale: string) {
  const lastValid = useRef<RuntimeModel | null>(null);
  return useMemo(() => {
    try {
      const model = toRuntimeModel(pkg, { locale });
      lastValid.current = model;
      return { model, error: undefined };
    } catch (error) {
      return {
        model: lastValid.current,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [pkg, locale]);
}

/**
 * Editor de salas (specs/09 §4): palette · lienzo WYSIWYG · selección. Las
 * tres regiones leen el mismo doc Yjs (vía `useRoomPackage`) y escriben con la
 * capa de comandos (`EditToolController`); ninguna guarda la sala en estado
 * local.
 */
export function RoomEditorWorkspace({
  doc,
  controller,
  palette,
  pack,
  status,
  renderCanvas,
  inspector,
  rulesGraph,
  canvasTab = "map",
  onCanvasTabChange,
  validation,
  headerActions,
}: RoomEditorWorkspaceProps) {
  const t = useTranslations("RoomEditor");
  const locale = useLocale();
  const pkg = useRoomPackage(doc);
  const tools = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const { model, error: modelError } = useRuntimeModel(pkg, locale);

  const activeRoomId = pkg.map.rooms.some((room) => room.id === tools.roomId)
    ? tools.roomId
    : (pkg.map.rooms[0]?.id ?? tools.roomId);

  useEffect(() => {
    if (activeRoomId !== tools.roomId) controller.setRoom(activeRoomId);
  }, [activeRoomId, tools.roomId, controller]);

  const showRules = Boolean(rulesGraph) && canvasTab === "rules";

  // Supr/Retroceso borra el objeto seleccionado (fuera de campos de texto). En
  // la pestaña de reglas esas teclas son del grafo (borrar nodos).
  useEffect(() => {
    if (showRules) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      controller.deleteSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, showRules]);

  const activeRoom = pkg.map.rooms.find((room) => room.id === activeRoomId);
  const onPointer = (event: EditPointerEvent) => controller.pointer(event);

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100" data-testid="room-editor">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
        <h1 className="truncate text-base font-semibold">{pkg.meta.title || t("untitledRoom")}</h1>
        <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">
          {t(`status.${status}`)}
        </span>
        <div className="ml-auto flex items-center gap-2">{headerActions}</div>
      </header>

      <div className="flex min-h-0 flex-1">
        <RoomEditorPalette
          palette={palette}
          objects={pkg.objects}
          tool={tools.tool}
          tileId={tools.tileId}
          sprite={tools.sprite}
          onSelectTile={(tileId, layer) => controller.selectTile(tileId, layer)}
          onSelectSprite={(sprite) => controller.selectSprite(sprite)}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
            {rulesGraph && (
              <div role="tablist" aria-label={t("canvas.label")} className="mr-2 flex gap-1">
                {CANVAS_TABS.map((tab) => (
                  <Button
                    key={tab}
                    size="sm"
                    role="tab"
                    variant={canvasTab === tab ? "secondary" : "ghost"}
                    className={canvasTab === tab ? undefined : QUIET_BUTTON}
                    aria-selected={canvasTab === tab}
                    data-canvas-tab={tab}
                    onClick={() => onCanvasTabChange?.(tab)}
                  >
                    {t(`canvas.${tab}`)}
                  </Button>
                ))}
              </div>
            )}
            <div
              role="toolbar"
              aria-label={t("tools.label")}
              className={cn("flex gap-1", showRules && "hidden")}
            >
              {EDIT_TOOLS.map((tool) => (
                <EditorToolHint key={tool} id={`tool.${tool}`} text={t(`toolHints.${tool}`)}>
                  <Button
                    size="sm"
                    variant={tools.tool === tool ? "secondary" : "ghost"}
                    className={tools.tool === tool ? undefined : QUIET_BUTTON}
                    aria-pressed={tools.tool === tool}
                    data-tool={tool}
                    onClick={() => controller.setTool(tool)}
                  >
                    {t(`tools.${tool}`)}
                  </Button>
                </EditorToolHint>
              ))}
            </div>
            <Label
              className={cn("ml-2 gap-2 text-xs font-normal text-white/70", showRules && "hidden")}
            >
              {t("layers.label")}
              <Select
                value={tools.layer}
                onValueChange={(value) =>
                  controller.setLayer(value as (typeof EDITOR_TILE_LAYERS)[number])
                }
              >
                <SelectTrigger className="h-auto rounded border border-white/15 bg-slate-900 px-2 py-1 text-sm text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITOR_TILE_LAYERS.map((layer) => (
                    <SelectItem key={layer} value={layer}>
                      {t(`layers.${layer}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <nav
              aria-label={t("rooms.label")}
              className={cn("ml-auto flex gap-1", showRules && "hidden")}
            >
              {pkg.map.rooms.map((room) => (
                <Button
                  key={room.id}
                  size="sm"
                  variant={room.id === activeRoomId ? "secondary" : "ghost"}
                  aria-current={room.id === activeRoomId ? "page" : undefined}
                  onClick={() => controller.setRoom(room.id)}
                >
                  {room.name || room.id}
                </Button>
              ))}
            </nav>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {model && renderCanvas ? (
              renderCanvas({
                model,
                roomId: activeRoomId,
                pack,
                selectedObjectId: tools.selectedObjectId,
                drag: tools.drag,
                onPointer,
              })
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/50">
                {t("loading")}
              </div>
            )}
            {/* El lienzo sigue montado debajo: volver al mapa no recrea Phaser. */}
            {showRules && (
              <div className="absolute inset-0 z-10 bg-white text-slate-900" data-rules-tab="">
                {rulesGraph}
              </div>
            )}
            {(modelError || tools.error) && (
              <p
                role="alert"
                className="absolute bottom-3 left-3 right-3 rounded bg-red-950/90 px-3 py-2 text-sm text-red-100"
              >
                {tools.error ? errorText(t, tools.error) : t("errors.invalidModel")}
              </p>
            )}
          </div>
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 p-3">
          {inspector}
          {activeRoom && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <RoomEditorRoomPanel
                doc={doc}
                room={activeRoom}
                objects={pkg.objects.filter((object) => object.roomId === activeRoom.id)}
                sprites={palette.sprites.map((entry) => entry.sprite)}
                errorText={(error) => errorText(t, error)}
              />
            </div>
          )}
          {validation && <div className="mt-4 border-t border-white/10 pt-3">{validation}</div>}
        </aside>
      </div>
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations<"RoomEditor">>;

const ERROR_CODES = [
  "UNKNOWN_ROOM",
  "UNKNOWN_OBJECT",
  "OUT_OF_BOUNDS",
  "DUPLICATE_ID",
  "INVALID_ID",
  "REFERENCED_ID",
  "UNKNOWN_DECORATION",
  "UNKNOWN_LIGHT",
  "INVALID_VALUE",
] as const;

function errorText(t: Translator, error: ToolError): string {
  return (ERROR_CODES as readonly string[]).includes(error.code)
    ? t(`errors.${error.code as (typeof ERROR_CODES)[number]}`)
    : error.message;
}
