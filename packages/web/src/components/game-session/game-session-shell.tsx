"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { GameClient } from "@escaperoom/game-runtime/session";
import { Button } from "@/components/ui/button";
import { ChatWindow } from "@/components/chat/chat-panel";
import { ResultsScreen } from "@/components/game/results-screen";
import { ErrorBoundary } from "@/components/error-boundary";
import { INTRO_DIALOG_ID } from "@/lib/playtest-state";
import { ContextMenuPopover } from "./components/context-menu-popover";
import { DialogButton, ImageDialog } from "./components/dialog-and-image";
import { HudHeader } from "./components/hud-header";
import { HudLogCorner } from "./components/hud-log-corner";
import { InventoryDialog } from "./components/inventory-dialog";
import { ItemPickerPopover } from "./components/item-picker-popover";
import type { IntroModel } from "@/lib/intro-model";
import { CountdownOverlay } from "./components/countdown-overlay";
import { IntroOverlay } from "./components/intro-overlay";
import { LobbyPanel } from "./components/lobby-panel";
import { ObjectsBar } from "./components/objects-bar";
import { PanelHost } from "./components/panel-host";
import { PlayersAside } from "./components/players-aside";
import { useGameHud } from "./hooks/use-game-hud";
import { useHudHotkeys } from "./hooks/use-hud-hotkeys";
import { useLobbyFlow } from "./hooks/use-lobby-flow";
import { useSceneSync } from "./hooks/use-scene-sync";
import type { GameConnectionStatus } from "./use-game-connection";

const GameSessionCanvas = dynamic(() => import("./game-session-canvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-slate-950" />,
});

export { KNOWN_ERRORS } from "./hooks/use-game-hud";

export interface GameSessionShellProps {
  /** Modelo público de la sala (sin soluciones), calculado en servidor. */
  model: RuntimeModel;
  pack?: RoomScenePack;
  /** Fuente de estado: la `GameRoom` por red (o la emulación local). */
  client: GameClient;
  /** Estado de la conexión de red y reintento; sin él, la barra no se muestra. */
  connection?: { status: GameConnectionStatus; onRetry: () => void };
  /** Link para invitar a más jugadores a esta partida. */
  inviteUrl?: string | null;
  /** Título de la cabecera (por defecto, el de la sala). */
  title?: string;
  subtitle?: string;
  exitHref?: string;
  /** Sala gratis sin cuenta (punto i, "CTA Jugar"): CTA de login en `ResultsScreen`. */
  signInHref?: string;
  /** Capas extra sobre el canvas (p. ej. el overlay de voz/webcam). */
  children?: ReactNode;
  /**
   * Introducción de la sala ya resuelta en servidor (texto o vídeo, encargo
   * lobby-diseño): se muestra tras «Empezar» (o al llegar tarde) antes del
   * 3-2-1. `null`/ausente = directo al 3-2-1.
   */
  intro?: IntroModel | null;
  /** Portada de la sala para la cabecera del lobby (URL firmada). */
  coverUrl?: string | null;
  /** Prueba de micrófono/cámara del lobby, si la partida usa voz/vídeo. */
  deviceCheck?: ReactNode;

  // — Puntos de extensión propios del playtest (F-5) —————————————
  /**
   * `"game"` (por defecto, partida en red) o `"playtest"`: cambia el orden
   * de la cabecera, quita el aside de jugadores (sustituido por un registro
   * en la esquina) y activa el registro de depuración (interacciones y
   * combinaciones, no solo desenlaces del servidor).
   */
  variant?: "game" | "playtest";
  /** Chat de la partida; el playtest (un jugador local) no lo necesita. */
  showChat?: boolean;
  /** Checklist de la ruta crítica + estado de la partida (propio del playtest). */
  objectsBarHeader?: ReactNode;
  /** Botón de reinicio (propio del playtest). */
  objectsBarFooter?: ReactNode;
}

/**
 * Partida en red (fase 2): Phaser + paneles React de las 8 plantillas pintados
 * **solo** a partir del estado sincronizado (`GameSnapshot`) y de las vistas
 * públicas que manda el servidor (`puzzle_view`), con cada intención enviada
 * como mensaje del protocolo (specs/11 §4). El cliente nunca recibe ni calcula
 * soluciones: el modelo que llega es el del runtime (sin códigos) y cada panel
 * refleja el desenlace (`attempt_result`) que decide el servidor.
 *
 * F-5: el mismo componente monta tanto la partida en red
 * (`createNetworkGameClient`, vía `NetworkGame`) como el playtest del editor
 * (`createLocalGameClient`, vía `RoomPlaytestShell`) — misma máquina de
 * estados, mismo HUD. Lo propio de cada uno entra por `variant` y los slots
 * (`objectsBarHeader`/`objectsBarFooter`/`children`), nunca duplicado.
 */
export function GameSessionShell({
  model,
  pack,
  client,
  connection,
  inviteUrl,
  title,
  subtitle,
  exitHref,
  signInHref,
  children,
  intro,
  coverUrl,
  deviceCheck,
  variant = "game",
  showChat = true,
  objectsBarHeader,
  objectsBarFooter,
}: GameSessionShellProps) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const { handleRef, onReady, sceneRoomRef } = useSceneSync(model, snapshot);
  const hud = useGameHud({
    model,
    pack,
    client,
    snapshot,
    handleRef,
    sceneRoomRef,
    debugLog: variant === "playtest",
  });

  const lobby = useLobbyFlow({ snapshot, client, hasIntro: Boolean(intro) });
  const inMapStage = lobby.stage === "map";
  const sectionRef = useRef<HTMLElement | null>(null);

  const { preventEscapeIfDialogOpen } = useHudHotkeys({
    dialog: hud.dialog,
    inventoryOpen: hud.inventoryOpen,
    panelOpen: hud.panel !== null,
    onCloseDialog: hud.closeDialog,
    onOpenInventory: hud.openInventory,
    onCloseInventory: hud.closeInventory,
  });

  const closeMenu = useCallback(() => hud.setSelected(null), [hud]);
  const onInspect = useCallback(
    (objectId: string) => {
      hud.setSelected(null);
      hud.inspect(objectId);
    },
    [hud],
  );
  const onPickItem = useCallback(
    (objectId: string) => {
      hud.setSelected(null);
      hud.setPickerFor(objectId);
    },
    [hud],
  );
  const onOpenPanelFromMenu = useCallback(
    (puzzleId: string, objectId: string) => {
      hud.setSelected(null);
      hud.openPanel(puzzleId, objectId);
    },
    [hud],
  );
  const onChooseItem = useCallback(
    (itemId: string) => {
      const target = hud.pickerFor;
      hud.setPickerFor(null);
      if (target) hud.applyItemUse(itemId, target);
    },
    [hud],
  );

  return (
    <section
      ref={sectionRef}
      className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950"
      data-testid="game-session"
      data-phase={snapshot.phase}
      data-stage={lobby.stage}
    >
      <ErrorBoundary>
        <GameSessionCanvas
          model={model}
          roomId={hud.roomId}
          pack={pack}
          inputEnabled={hud.worldInputEnabled}
          onEvent={hud.onWorldEvent}
          onReady={onReady}
        />
      </ErrorBoundary>

      {hud.draggingItem ? (
        <div className="pointer-events-none absolute inset-x-4 top-24 z-30 mx-auto w-fit rounded-full border border-amber-200/40 bg-slate-950/90 px-4 py-1.5 text-xs text-amber-100 shadow-lg">
          {hud.tp("menu.dropHint", { item: hud.itemName(hud.draggingItem) })}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
        <HudHeader
          variant={variant}
          title={title ?? model.meta.title}
          subtitle={variant === "playtest" ? (subtitle ?? hud.tp("subtitle")) : subtitle}
          roomName={hud.currentRoom?.name ?? hud.roomId}
          controlsText={hud.tp("controls")}
          remaining={hud.remaining}
          elapsed={hud.elapsed}
          connection={variant === "game" ? connection : undefined}
          badgeText={variant === "playtest" ? hud.tp("badge") : undefined}
          roomLabel={(room) => hud.tp("room", { room })}
        />

        <div className="pointer-events-auto flex w-full flex-wrap items-end justify-between gap-4">
          {/* En la sala de espera (y durante la introducción/3-2-1) no hay
              objetos ni inventario que mostrar: solo el chat. */}
          {inMapStage ? (
            <ObjectsBar
              model={model}
              objectsLabel={hud.tp("objects")}
              roomObjects={hud.roomObjects}
              openDoors={hud.openDoors}
              worldInputEnabled={hud.worldInputEnabled}
              objectName={hud.objectName}
              goToLabel={(room) => hud.tp("action.goTo", { room })}
              onSelectObject={(objectId) => hud.setSelected(objectId)}
              onEnterRoom={(door) => {
                if (!door.leadsTo) return;
                sceneRoomRef.current = door.leadsTo;
                handleRef.current?.showRoom(door.leadsTo);
                hud.enterRoom(door.leadsTo, door.position);
              }}
              header={objectsBarHeader}
              footer={objectsBarFooter}
            />
          ) : null}

          {showChat ? (
            <ChatWindow
              messages={snapshot.chat}
              selfId={snapshot.selfId || null}
              connected={connection ? connection.status === "connected" : true}
              error={hud.chatError}
              onSend={hud.sendChat}
            />
          ) : null}

          {inMapStage ? (
            <div className="flex w-64 flex-col gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-white/50">
                  {hud.tp("inventory")}
                </span>
                <Button
                  size="xs"
                  variant="overlay"
                  disabled={hud.introOpen || !hud.playing}
                  onClick={hud.openInventory}
                  data-testid="game-open-inventory"
                >
                  {hud.tp("inventoryButton")}
                </Button>
              </div>
              <ul className="flex flex-wrap gap-1.5" data-testid="game-inventory">
                {snapshot.inventory.length === 0 ? (
                  <li className="text-[0.7rem] text-white/40">{hud.tp("emptyInventory")}</li>
                ) : (
                  snapshot.inventory.map((itemId) => (
                    <li
                      key={itemId}
                      draggable
                      onDragStart={(event) => {
                        hud.setDraggingItem(itemId);
                        event.dataTransfer.setData("text/plain", itemId);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => hud.setDraggingItem(null)}
                      className="flex cursor-grab items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 py-1 pl-1 pr-2.5 text-[0.7rem] text-amber-100 active:cursor-grabbing"
                    >
                      {hud.renderItemIcon(itemId, 28)}
                      {hud.itemName(itemId)}
                    </li>
                  ))
                )}
              </ul>
              <dl className="flex justify-between text-[0.7rem] text-white/60">
                <dt>{hud.tp("stats.puzzles")}</dt>
                <dd className="font-mono text-white/90">
                  {hud.solvedCount}/{model.puzzles.length}
                </dd>
              </dl>
              <Button
                size="sm"
                variant="overlay"
                disabled={!hud.playing || !hud.hintPuzzleId}
                onClick={() => hud.setPanel("hints")}
              >
                {hud.tp("action.hints")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {variant === "playtest" ? (
        <HudLogCorner log={hud.log} title={hud.tp("log.title")} />
      ) : !inMapStage ? null : (
        <PlayersAside
          players={snapshot.players}
          phase={snapshot.phase}
          isHost={hud.isHost}
          onKick={(playerId) => client.kick(playerId)}
          log={hud.log}
          inviteUrl={inviteUrl}
          copied={hud.copied}
          onCopyInvite={() => void hud.copyInvite(inviteUrl)}
          playersLabel={hud.t("lobby.players", { count: snapshot.players.length })}
          youSuffix={hud.t("lobby.you")}
          hostSuffix={hud.t("lobby.host")}
          offlineSuffix={hud.t("lobby.offline")}
          inviteLabel={hud.t("lobby.invite")}
          copiedLabel={hud.t("lobby.copied")}
          kickLabel={hud.t("lobby.kick")}
          kickConfirmLabel={(player) => hud.t("lobby.kickConfirm", { player })}
          logTitle={hud.tp("log.title")}
        />
      )}

      {lobby.stage === "lobby" && snapshot.self ? (
        <LobbyPanel
          meta={model.meta}
          pack={pack}
          coverUrl={coverUrl}
          players={snapshot.players}
          self={snapshot.self}
          isHost={hud.isHost}
          organizerControlsStart={snapshot.organizerControlsStart}
          onSelectCharacter={(characterId) => client.selectCharacter(characterId)}
          onToggleReady={(ready) => client.setReady(ready)}
          onStart={(force) => client.startGame(force)}
          onKick={(playerId) => client.kick(playerId)}
          inviteUrl={inviteUrl}
          copied={hud.copied}
          onCopyInvite={() => void hud.copyInvite(inviteUrl)}
          deviceCheck={deviceCheck}
        />
      ) : null}

      {lobby.stage === "intro" && intro ? (
        <IntroOverlay intro={intro} onClose={lobby.closeIntro} />
      ) : null}

      {lobby.stage === "countdown" ? (
        <CountdownOverlay value={lobby.countdown} label={hud.t("countdown.label")} />
      ) : null}

      <ContextMenuPopover
        object={hud.selectedObject}
        isSolved={
          Boolean(hud.selectedObject?.panelPuzzleId) &&
          snapshot.puzzles[hud.selectedObject?.panelPuzzleId ?? ""]?.state === "solved"
        }
        onOpenChange={(open) => !open && closeMenu()}
        onEscapeKeyDown={preventEscapeIfDialogOpen}
        objectName={hud.objectName}
        onInspect={onInspect}
        onPickItem={onPickItem}
        onOpenPanel={onOpenPanelFromMenu}
        onCancel={closeMenu}
        titleLabel={hud.tp("menu.title")}
        objectLabel={(object) => hud.tp("menu.object", { object })}
        inspectLabel={hud.tp("menu.inspect")}
        useItemLabel={hud.tp("menu.useItem")}
        openPanelLabel={hud.tp("menu.openPanel")}
        cancelLabel={hud.tp("menu.cancel")}
      />

      <ItemPickerPopover
        objectId={hud.pickerFor}
        inventory={snapshot.inventory}
        onOpenChange={(open) => !open && hud.setPickerFor(null)}
        onEscapeKeyDown={preventEscapeIfDialogOpen}
        onChoose={onChooseItem}
        onCancel={() => hud.setPickerFor(null)}
        renderItemIcon={hud.renderItemIcon}
        itemName={hud.itemName}
        objectName={hud.objectName}
        titleLabel={(object) => hud.tp("menu.chooseItem", { object })}
        dragHintLabel={hud.tp("menu.dragHint")}
        noItemsLabel={hud.tp("menu.noItems")}
        cancelLabel={hud.tp("menu.cancel")}
      />

      <DialogButton
        dialog={hud.dialog}
        isIntro={hud.dialog?.id === INTRO_DIALOG_ID}
        onClose={hud.closeDialog}
        introLabel={hud.tp("intro")}
        dialogLabel={hud.tp("dialog")}
        closeLabel={hud.tp("close")}
      />

      <ImageDialog
        imagePanel={hud.imagePanel}
        pack={pack}
        onOpenChange={(open) => !open && hud.setImagePanel(null)}
        inspectImageLabel={hud.tp("inspectImage")}
      />

      <InventoryDialog
        open={hud.inventoryOpen}
        container={sectionRef.current}
        onOpenChange={(open) => !open && hud.closeInventory()}
        onEscapeKeyDown={preventEscapeIfDialogOpen}
        model={model}
        view={hud.combineView}
        onCombine={hud.combine}
        feedback={hud.combineFeedback}
        onClose={hud.closeInventory}
        renderIcon={(itemId) => hud.renderItemIcon(itemId)}
        inventoryLabel={hud.tp("inventory")}
        dragHintLabel={hud.tp("menu.dragHint")}
        loadingLabel={hud.t("hud.loadingPanel")}
      />

      <PanelHost
        open={hud.panel !== null}
        container={sectionRef.current}
        onOpenChange={(open) => !open && hud.closePanel()}
        onEscapeKeyDown={preventEscapeIfDialogOpen}
        onClose={hud.closePanel}
        panel={hud.panel}
        activePuzzle={hud.activePuzzle}
        activeView={hud.activeView}
        feedback={hud.feedback}
        pack={pack}
        playing={hud.playing}
        hintPuzzleId={hud.hintPuzzleId}
        hintView={hud.hintView}
        hintError={hud.hintError}
        onRequestHint={(puzzleId) => client.requestHint(puzzleId)}
        onAttempt={(puzzleId, attempt) => client.attempt(puzzleId, attempt)}
        onTogglePlate={hud.togglePlate}
        onPlacePlatesBridge={hud.placePlatesBridge}
        onPlaceMirror={hud.placeMirror}
        platesGetNow={hud.serverNow}
        panelTitle={(panel) =>
          panel === "hints" ? hud.tp("action.hints") : hud.tp("menu.openPanel")
        }
        closeLabel={hud.tp("close")}
        loadingLabel={hud.t("hud.loadingPanel")}
      />

      {children}

      {hud.summary ? (
        <ResultsScreen
          summary={hud.summary}
          exitHref={exitHref}
          signInHref={signInHref}
          className="z-40"
        />
      ) : null}
    </section>
  );
}
