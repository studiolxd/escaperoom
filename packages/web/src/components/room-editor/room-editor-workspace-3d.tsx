"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type * as Y from "yjs";
import { EDIT_TOOLS_3D, useRoomPackage, type Edit3DController } from "@escaperoom/editor";
import { getModels3DCatalog } from "@escaperoom/shared/packs";
import { isLobbyRoom } from "@escaperoom/shared/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "cn";
import type { Pack3D } from "@/lib/game-model";
import { EditorToolHint } from "./editor-tool-hint";
import {
  CANVAS_TABS,
  QUIET_BUTTON,
  errorText,
  useRuntimeModel,
  type CanvasTab,
  type RoomEditorStatus,
} from "./editor-shared";
import type { RoomEditorCanvas3DProps } from "./room-editor-canvas-3d";
import { RoomEditorPalette3D } from "./room-editor-palette-3d";
import { RoomEditorRoomPanel3D } from "./room-editor-room-panel-3d";
import { RoomEditorSelectionPanel3D } from "./room-editor-selection-panel-3d";

const GIZMO_MODES = ["translate", "rotate", "scale"] as const;
const GIZMO_KEYS = { w: "translate", e: "rotate", r: "scale" } as const;
const WORK_HEIGHT_STEP = 0.2;

export interface RoomEditorWorkspace3DProps {
  doc: Y.Doc;
  controller: Edit3DController;
  pack3d?: Pack3D;
  status: RoomEditorStatus;
  /** Lienzo Three.js (solo cliente); sin él se muestra un marcador (SSR, tests). */
  renderCanvas?: (props: RoomEditorCanvas3DProps) => ReactNode;
  inspector: ReactNode;
  rulesGraph?: ReactNode;
  canvasTab?: CanvasTab;
  onCanvasTabChange?: (tab: CanvasTab) => void;
  validation?: ReactNode;
  headerActions: ReactNode;
}

/**
 * Editor de salas 3D (specs/27 §8): misma distribución que el 2D — paleta ·
 * lienzo con su barra de herramientas · inspector, panel de habitación y
 * validación —, con el lienzo de Three.js y el `Edit3DController`.
 */
export function RoomEditorWorkspace3D({
  doc,
  controller,
  pack3d,
  status,
  renderCanvas,
  inspector,
  rulesGraph,
  canvasTab = "map",
  onCanvasTabChange,
  validation,
  headerActions,
}: RoomEditorWorkspace3DProps) {
  const t = useTranslations("RoomEditor");
  const locale = useLocale();
  const pkg = useRoomPackage(doc);
  const tools = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const { model, error: modelError } = useRuntimeModel(pkg, locale);
  const [navmeshVisible, setNavmeshVisible] = useState(false);
  const [altPressed, setAltPressed] = useState(false);

  const activeRoomId = pkg.map.rooms.some((room) => room.id === tools.roomId)
    ? tools.roomId
    : (pkg.map.rooms[0]?.id ?? tools.roomId);

  useEffect(() => {
    if (activeRoomId !== tools.roomId) controller.setRoom(activeRoomId);
  }, [activeRoomId, tools.roomId, controller]);

  const showRules = Boolean(rulesGraph) && canvasTab === "rules";
  const catalog = useMemo(() => getModels3DCatalog(pkg.map.tileset), [pkg.map.tileset]);

  // Atajos de teclado (specs/27 §8). Fuera de campos de texto y de la pestaña de reglas.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltPressed(true);
      if (showRules) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable]")) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "d") {
        event.preventDefault();
        controller.duplicateSelection();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (key in GIZMO_KEYS) {
        controller.setGizmoMode(GIZMO_KEYS[key as keyof typeof GIZMO_KEYS]);
        controller.setTool("select");
      } else if (key === "q") {
        controller.rotatePlacement();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        controller.deleteSelection();
      } else if (event.key === "Escape") {
        controller.setTool("select");
        controller.select([]);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltPressed(false);
    };
    const onBlur = () => setAltPressed(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [controller, showRules]);

  const hide = showRules && "hidden";

  return (
    <div className="flex h-dvh flex-col text-slate-100" data-testid="room-editor" data-dimension="3d">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
        <h1 className="truncate text-base font-semibold">{pkg.meta.title || t("untitledRoom")}</h1>
        <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">
          {t(`status.${status}`)}
        </span>
        <div className="ml-auto flex items-center gap-2">{headerActions}</div>
      </header>

      <div className="flex min-h-0 flex-1">
        <RoomEditorPalette3D
          catalog={catalog}
          customModels={pkg.world3d?.models}
          placing={tools.placing}
          onSelectModel={(id, as, snap) => controller.selectModel(id, as, snap)}
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
            <div role="toolbar" aria-label={t("tools.label")} className={cn("flex gap-1", hide)}>
              {EDIT_TOOLS_3D.map((tool) => (
                <EditorToolHint key={tool} id={`tool3d.${tool}`} text={t(`toolHints3d.${tool}`)}>
                  <Button
                    size="sm"
                    variant={tools.tool === tool ? "secondary" : "ghost"}
                    className={tools.tool === tool ? undefined : QUIET_BUTTON}
                    aria-pressed={tools.tool === tool}
                    data-tool={tool}
                    onClick={() => controller.setTool(tool)}
                  >
                    {t(`tools3d.${tool}`)}
                  </Button>
                </EditorToolHint>
              ))}
            </div>
            {tools.tool === "select" && (
              <div role="group" aria-label={t("gizmo.label")} className={cn("flex gap-1", hide)}>
                {GIZMO_MODES.map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={tools.gizmoMode === mode ? "secondary" : "ghost"}
                    className={tools.gizmoMode === mode ? undefined : QUIET_BUTTON}
                    aria-pressed={tools.gizmoMode === mode}
                    data-gizmo={mode}
                    onClick={() => controller.setGizmoMode(mode)}
                  >
                    {t(`gizmo.${mode}`)}
                  </Button>
                ))}
              </div>
            )}
            <div
              role="group"
              aria-label={t("workHeight.label")}
              className={cn("flex items-center gap-1", hide)}
            >
              <Button
                size="sm"
                variant="ghost"
                className={QUIET_BUTTON}
                aria-label={t("workHeight.down")}
                data-work-height="down"
                onClick={() => controller.setWorkHeight(tools.workHeight - WORK_HEIGHT_STEP)}
              >
                −
              </Button>
              <Input
                key={tools.workHeight}
                type="number"
                step={WORK_HEIGHT_STEP}
                min={0}
                aria-label={t("workHeight.label")}
                defaultValue={tools.workHeight}
                className="h-8 w-16 rounded border border-white/15 bg-slate-900 px-1.5 text-xs text-white"
                data-work-height="value"
                onBlur={(event) => controller.setWorkHeight(Number.parseFloat(event.currentTarget.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    controller.setWorkHeight(Number.parseFloat(event.currentTarget.value));
                  }
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                className={QUIET_BUTTON}
                aria-label={t("workHeight.up")}
                data-work-height="up"
                onClick={() => controller.setWorkHeight(tools.workHeight + WORK_HEIGHT_STEP)}
              >
                +
              </Button>
            </div>
            <Label className={cn("gap-2 text-xs font-normal text-white/70", hide)}>
              {t("snap")}
              <Switch
                checked={tools.snapEnabled}
                onCheckedChange={(checked) => controller.setSnapEnabled(checked)}
                data-snap=""
              />
            </Label>
            <Label className={cn("gap-2 text-xs font-normal text-white/70", hide)}>
              {t("showNavmesh")}
              <Switch
                checked={navmeshVisible}
                onCheckedChange={setNavmeshVisible}
                data-show-navmesh=""
              />
            </Label>
            <nav aria-label={t("rooms.label")} className={cn("ml-auto flex gap-1", hide)}>
              {pkg.map.rooms.map((room) => (
                <Button
                  key={room.id}
                  size="sm"
                  variant={room.id === activeRoomId ? "secondary" : "ghost"}
                  aria-current={room.id === activeRoomId ? "page" : undefined}
                  onClick={() => controller.setRoom(room.id)}
                  data-lobby-room={isLobbyRoom(room) ? "" : undefined}
                >
                  {room.name || room.id}
                  {isLobbyRoom(room) && (
                    <Badge variant="outline" className="border-white/30 text-white/70">
                      {t("rooms.lobbyBadge")}
                    </Badge>
                  )}
                </Button>
              ))}
            </nav>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {model && renderCanvas ? (
              renderCanvas({
                model,
                roomId: activeRoomId,
                pack3d,
                controller,
                state: tools,
                altPressed,
                navmeshVisible,
              })
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/50">
                {t("loading")}
              </div>
            )}
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
          {tools.selection.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <RoomEditorSelectionPanel3D
                pkg={pkg}
                roomId={activeRoomId}
                selection={tools.selection}
                controller={controller}
              />
            </div>
          )}
          <div className="mt-4 border-t border-white/10 pt-3">
            <RoomEditorRoomPanel3D
              doc={doc}
              pkg={pkg}
              roomId={activeRoomId}
              onSelect={(targets) => controller.select(targets)}
              errorText={(error) => errorText(t, error)}
            />
          </div>
          {validation && <div className="mt-4 border-t border-white/10 pt-3">{validation}</div>}
        </aside>
      </div>
    </div>
  );
}
