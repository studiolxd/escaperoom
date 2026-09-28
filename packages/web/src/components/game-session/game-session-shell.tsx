"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "cn";
import { Lightbulb } from "lucide-react";
import { resolveIconFrame, type RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { GameClient } from "@escaperoom/game-runtime/session";
import type { MemoryPublicView } from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";
import { ChatWindow } from "@/components/chat/chat-panel";
import { ResultsScreen } from "@/components/game/results-screen";
import { ErrorBoundary } from "@/components/error-boundary";
import { INTRO_DIALOG_ID } from "@/lib/playtest-state";
import { formatDuration } from "@/lib/session-format";
import { ConnectionBadge } from "./connection-badge";
import { ContextMenuPopover } from "./components/context-menu-popover";
import { DialogButton, ImageDialog } from "./components/dialog-and-image";
import { HudLogCorner } from "./components/hud-log-corner";
import { InventoryDialog } from "./components/inventory-dialog";
import { ItemPickerPopover } from "./components/item-picker-popover";
import { ItemPickupPop } from "./components/item-pickup-pop";
import type { IntroModel } from "@/lib/intro-model";
import { EntryFade } from "./components/entry-fade";
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
  loading: () => <div className="absolute inset-0" />,
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
  exitHref,
  signInHref,
  children,
  intro,
  coverUrl,
  variant = "game",
  showChat = true,
  objectsBarHeader,
  objectsBarFooter,
}: GameSessionShellProps) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const { handleRef, onReady, sceneRoomRef, roomReady } = useSceneSync(model, snapshot);
  const hud = useGameHud({
    model,
    pack,
    client,
    snapshot,
    handleRef,
    sceneRoomRef,
    debugLog: variant === "playtest",
  });

  // Sin lista de botones por objeto en la partida real (se inspeccionan
  // directo sobre el canvas isométrico): el E2E necesita saber dónde clicar.
  // Expuesto siempre (solo lectura, sin datos sensibles) — no hay ninguna
  // señal de "estoy en un test" fiable en un build de producción como el
  // que usa `e2e-smoke`.
  useEffect(() => {
    window.__escaperoomGame = {
      getObjectScreenFraction: (objectId) => handleRef.current?.getObjectScreenFraction(objectId),
      isObjectInteractive: (objectId) => handleRef.current?.isObjectInteractive(objectId) ?? false,
    };
    return () => {
      delete window.__escaperoomGame;
    };
  }, [handleRef]);

  const lobby = useLobbyFlow({ snapshot, client, hasIntro: Boolean(intro) });
  const inMapStage = lobby.stage === "map";

  // Monoespacio + ancho fijo (basta para "H:MM:SS", el formato más largo de
  // `formatDuration`): sin esto, la píldora cambiaba de tamaño con el propio
  // número (p. ej. de "1:00:00" a "59:00"), con letra proporcional o sin
  // ancho fijo.
  const timerClassName =
    "inline-block w-20 rounded-md border border-border bg-card/75 py-1.5 text-center font-mono text-xs text-foreground";
  const timer =
    hud.remaining !== null ? (
      <span className={timerClassName} data-testid="game-timer">
        {formatDuration(Math.ceil(hud.remaining / 1000))}
      </span>
    ) : hud.elapsed !== null ? (
      <span className={timerClassName} data-testid="game-elapsed">
        {formatDuration(Math.floor(hud.elapsed / 1000))}
      </span>
    ) : lobby.stage === "lobby" && model.meta.timeLimitMinutes !== null ? (
      <span className={timerClassName} data-testid="game-timer-preview">
        {formatDuration(model.meta.timeLimitMinutes * 60)}
      </span>
    ) : null;
  const sectionRef = useRef<HTMLElement | null>(null);
  /**
   * Tira de inventario siempre visible (abajo-derecha, últimos 3 objetos):
   * soltar un ítem sobre otro AHÍ combinaba silenciosamente (o ni eso,
   * revisión en vivo) porque solo eran arrastrables hacia el mundo, sin
   * `onDrop` propio para combinar entre ellos como sí hace el panel completo
   * (`InventoryPanel.dropOn`). Solo resalte visual del objetivo del arrastre.
   */
  const [inventoryStripDropTarget, setInventoryStripDropTarget] = useState<string | null>(null);

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
  const onChooseItem = useCallback(
    (itemId: string) => {
      const target = hud.pickerFor;
      hud.setPickerFor(null);
      if (target) hud.applyItemUse(itemId, target);
    },
    [hud],
  );

  // El `memory` solo conoce el `sessionId` del turno (`currentPlayerId`); el
  // nombre sale de `snapshot.players` (reasignaciones al instante: cambia en
  // cuanto llega la vista nueva del panel, encargo memory-turnos).
  const memoryCurrentPlayerName =
    hud.activePuzzle?.type === "memory" && hud.activeView
      ? (snapshot.players.find(
          (player) => player.id === (hud.activeView as MemoryPublicView).currentPlayerId,
        )?.name ?? null)
      : null;

  return (
    <section
      ref={sectionRef}
      className="absolute inset-0 overflow-hidden"
      data-testid="game-session"
      data-phase={snapshot.phase}
      data-stage={lobby.stage}
      // Puzzles que el servidor ha dado por resueltos: el HUD ya no pinta el
      // contador (revisión en vivo, #185), pero la suite E2E lo necesita como
      // prueba de progreso confirmado por el servidor (`expectSolvedAtLeast`).
      data-solved-puzzles={hud.solvedCount}
    >
      <ErrorBoundary
        layout="overlay"
        title={hud.t("errorTitle")}
        description={hud.t("errorDescription")}
      >
        <GameSessionCanvas
          model={model}
          roomId={hud.roomId}
          pack={pack}
          inputEnabled={hud.worldInputEnabled}
          onEvent={hud.onWorldEvent}
          onReady={onReady}
        />
      </ErrorBoundary>

      {hud.pickups.map((pickup) => (
        <ItemPickupPop
          key={pickup.id}
          x={pickup.x}
          y={pickup.y}
          frame={resolveIconFrame(pack?.manifest, model.itemsById[pickup.itemId]?.icon ?? "")}
          baseUrl={pack?.baseUrl}
          name={hud.itemName(pickup.itemId)}
        />
      ))}

      {hud.draggingItem ? (
        <div className="pointer-events-none absolute inset-x-4 top-24 z-30 mx-auto w-fit rounded-full border border-amber-500/40 px-4 py-1.5 text-xs text-amber-700 shadow-lg dark:border-amber-200/40 dark:text-amber-100">
          {hud.tp("menu.dropHint", { item: hud.itemName(hud.draggingItem) })}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
        {connection || timer ? (
          <header className="pointer-events-auto flex w-full items-center justify-between text-foreground">
            {connection ? (
              <ConnectionBadge
                status={connection.status}
                onRetry={connection.onRetry}
                className="rounded-md px-4 py-1.5"
              />
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {inMapStage ? (
                <Button
                  size="icon"
                  variant="secondary"
                  disabled={hud.introOpen || !hud.playing || !hud.hintPuzzleId}
                  onClick={() => hud.setPanel("hints")}
                  aria-label={hud.tp("action.hints")}
                  data-testid="game-open-hints"
                >
                  <Lightbulb />
                </Button>
              ) : null}
              {timer}
            </div>
          </header>
        ) : (
          // Espaciador: sin conexión ni cronómetro (p. ej. playtest en sala
          // sin duración), mantiene el chat/inventario pegados abajo
          // (justify-between).
          <div />
        )}

        <div className="pointer-events-auto flex w-full flex-wrap items-end justify-between gap-4">
          {/* En la sala de espera (y durante la introducción/entrada al mapa)
              no hay objetos ni inventario que mostrar: solo el chat. En la
              partida real los objetos se inspeccionan directo sobre el canvas
              isométrico (clic + menú contextual, `RoomScene.wireInteraction`):
              sin panel de objetos, que era redundante. El playtest sí lo
              conserva (lleva enganchados el checklist de la ruta crítica y el
              botón de reinicio, `objectsBarHeader`/`objectsBarFooter`). */}
          {inMapStage && variant === "playtest" ? (
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

          {showChat && lobby.stage !== "lobby" && variant === "playtest" ? (
            // El playtest conserva la `ObjectsBar` (crece con la sala, hasta
            // `min(92vw,40rem)`): fijar el chat en una esquina absoluta podía
            // solaparla y bloquear sus clics, así que aquí va en la misma
            // fila flex, que los reparte sin invadirse. La partida real ya no
            // tiene `ObjectsBar` (ver arriba): su chat va fijo más abajo.
            <ChatWindow
              messages={snapshot.chat}
              selfId={snapshot.selfId || null}
              connected={connection ? connection.status === "connected" : true}
              error={hud.chatError}
              onSend={hud.sendChat}
            />
          ) : null}

          {inMapStage ? (
            <div className="ml-auto flex w-64 flex-col gap-2 rounded-xl border border-border bg-card/75 px-4 py-3 text-foreground backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {hud.tp("inventory")}
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={hud.introOpen || !hud.playing}
                  onClick={hud.openInventory}
                  data-testid="game-open-inventory"
                >
                  {hud.tp("inventoryButton")}
                </Button>
              </div>
              {/* Últimos 3 objetos añadidos, en cuadrado (como el inventario
                  completo): el nombre es solo etiqueta accesible, no texto
                  visible — el icono ya lo identifica. */}
              <ul className="flex gap-1.5" data-testid="game-inventory">
                {snapshot.inventory.length === 0 ? (
                  <li className="text-[0.7rem] text-muted-foreground">{hud.tp("emptyInventory")}</li>
                ) : (
                  snapshot.inventory.slice(-3).map((itemId) => (
                    <li
                      key={itemId}
                      draggable
                      title={hud.itemName(itemId)}
                      onDragStart={(event) => {
                        hud.setDraggingItem(itemId);
                        event.dataTransfer.setData("text/plain", itemId);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        hud.setDraggingItem(null);
                        setInventoryStripDropTarget(null);
                      }}
                      onDragOver={(event) => {
                        if (!hud.draggingItem || hud.draggingItem === itemId) return;
                        event.preventDefault();
                        setInventoryStripDropTarget(itemId);
                      }}
                      onDragLeave={() =>
                        setInventoryStripDropTarget((current) => (current === itemId ? null : current))
                      }
                      onDrop={(event) => {
                        event.preventDefault();
                        setInventoryStripDropTarget(null);
                        const dragged = event.dataTransfer.getData("text/plain") || hud.draggingItem;
                        hud.setDraggingItem(null);
                        if (!dragged || dragged === itemId) return;
                        // No se abre el inventario grande al combinar desde
                        // aquí (revisión en vivo): la tira pequeña se queda
                        // en su sitio, igual que arrastrar un ítem al mundo.
                        hud.combine([dragged, itemId]);
                      }}
                      className={cn(
                        "flex aspect-square size-11 cursor-grab items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 active:cursor-grabbing dark:border-amber-300/40 dark:bg-amber-300/10",
                        inventoryStripDropTarget === itemId && "border-amber-300 ring-2 ring-amber-300/50",
                      )}
                    >
                      {hud.renderItemIcon(itemId, 28)}
                      <span className="sr-only">{hud.itemName(itemId)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {showChat && (lobby.stage === "lobby" || variant === "game") ? (
        // En el lobby, a la derecha de `LobbyPanel` (`left-4`, ancho variable
        // `min(22rem, calc(100% - 2rem))`), con el mismo hueco de 1rem que ese
        // panel tiene del borde izquierdo. En partida real, sin `ObjectsBar`
        // que esquivar, pegado a la izquierda sin más. El playtest (con
        // `ObjectsBar`) sigue yendo dentro de la fila flex de arriba.
        <ChatWindow
          messages={snapshot.chat}
          selfId={snapshot.selfId || null}
          connected={connection ? connection.status === "connected" : true}
          error={hud.chatError}
          onSend={hud.sendChat}
          className={cn(
            "absolute bottom-4",
            lobby.stage === "lobby"
              ? "left-[calc(2rem+min(22rem,calc(100%-2rem)))]"
              : "left-4",
          )}
        />
      ) : null}

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
        />
      ) : null}

      {lobby.stage === "intro" && intro ? (
        <EntryFade>
          <IntroOverlay intro={intro} onClose={lobby.closeIntro} />
        </EntryFade>
      ) : lobby.stage === "entering" || (lobby.stage === "map" && !roomReady) ? (
        // Se queda montado (sin hijos, opaco) hasta que la escena confirme
        // que ya muestra la sala real (`roomReady`), no solo que el servidor
        // ya dio la fase de juego por empezada: entre medias, el canvas
        // todavía enseña la sala de relleno (`firstRoomId`) con la que
        // arrancó Phaser mientras no había sala asignada — sin esto, se veía
        // ese frame de por medio antes del propio fundido de cámara de
        // `RoomScene.setRoom`.
        <EntryFade />
      ) : null}

      <ContextMenuPopover
        object={hud.selectedObject}
        alternatives={hud.selectedAlternatives}
        onSelectObject={hud.setSelected}
        onOpenChange={(open) => !open && closeMenu()}
        onEscapeKeyDown={preventEscapeIfDialogOpen}
        objectName={hud.objectName}
        onInspect={onInspect}
        onPickItem={onPickItem}
        onCancel={closeMenu}
        inspectLabel={hud.tp("menu.inspect")}
        useItemLabel={hud.tp("menu.useItem")}
        cancelLabel={hud.tp("menu.cancel")}
        pickupLabel={hud.tp("menu.pickup")}
        alternativesLabel={hud.tp("menu.here")}
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
        renderIcon={(itemId) => hud.renderItemIcon(itemId, 48)}
        inventoryLabel={hud.tp("inventory")}
        dragHintLabel={hud.tp("menu.dragHint")}
        loadingLabel={hud.t("hud.loadingPanel")}
      />

      <PanelHost
        open={hud.panel !== null}
        container={sectionRef.current}
        onOpenChange={(open) => !open && hud.closePanel()}
        onEscapeKeyDown={preventEscapeIfDialogOpen}
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
        memoryCurrentPlayerName={memoryCurrentPlayerName}
        platesGetNow={hud.serverNow}
        panelTitle={(panel) => {
          if (panel === "hints") return hud.tp("action.hints");
          // El título del panel es el nombre del objeto que lo abre (revisión
          // en vivo, quitado `menu.openPanel`: ya no hay botón "Abrir panel"
          // con esa etiqueta). Varios objetos pueden compartir el mismo
          // puzzle (las dos placas de `puerta-bodega`); el primero vale.
          const object = model.objects.find((candidate) => candidate.panelPuzzleId === panel);
          return object ? hud.objectName(object.id) : hud.tp("genericObject");
        }}
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

declare global {
  interface Window {
    /**
     * Solo E2E (`packages/e2e/support/game.ts`): la partida real no tiene
     * lista de botones por objeto, así que el test necesita saber dónde
     * clicar sobre el canvas isométrico.
     */
    __escaperoomGame?: {
      getObjectScreenFraction: (objectId: string) => { x: number; y: number } | undefined;
      isObjectInteractive: (objectId: string) => boolean;
    };
  }
}
