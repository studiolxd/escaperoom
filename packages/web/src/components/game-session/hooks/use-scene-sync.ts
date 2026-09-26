import { useCallback, useEffect, useRef } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { GameSnapshot } from "@escaperoom/game-runtime/session";
import type { GameSessionCanvasHandle } from "../game-session-canvas";

/**
 * ¿Se puede reflejar este estado en la escena? El room state también lleva los
 * objetos sin estados declarados (decoración interactuable, `""`), que la
 * escena no sabe pintar.
 */
function declaresState(model: RuntimeModel, objectId: string, state: string): boolean {
  return Boolean(state) && (model.objectsById[objectId]?.states.includes(state) ?? false);
}

/**
 * F-5: sincroniza el estado autoritativo (`GameSnapshot`) con la escena Phaser
 * — objetos, otros jugadores, posición/tinte/personaje del jugador local — y
 * expone el `handleRef`/`onReady`/`sceneRoomRef` que el resto del HUD necesita
 * para pedirle cosas a la escena (cruces de puerta, `walkTo`…). Igual para la
 * partida en red y el playtest: ambos comparten `GameSessionCanvas` y el mismo
 * `GameClient`.
 */
export function useSceneSync(model: RuntimeModel, snapshot: GameSnapshot) {
  const handleRef = useRef<GameSessionCanvasHandle | null>(null);
  const snapshotRef = useRef<GameSnapshot>(snapshot);
  snapshotRef.current = snapshot;

  /** Habitación que muestra la escena (puede adelantarse al servidor al cruzar). */
  const sceneRoomRef = useRef(snapshot.self?.roomId || model.subrooms[0]?.id || "");
  /** Última habitación autoritativa del jugador local. */
  const serverRoomRef = useRef<string | null>(null);
  const appliedObjectsRef = useRef<Record<string, string>>({});

  // Objetos: aplica cualquier estado nuevo (también al unirse a mitad de partida).
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    for (const [objectId, state] of Object.entries(snapshot.objects)) {
      if (appliedObjectsRef.current[objectId] === state) continue;
      appliedObjectsRef.current[objectId] = state;
      if (declaresState(model, objectId, state)) handle.setObjectState(objectId, state);
    }
  }, [model, snapshot.objects]);

  // Otros jugadores (la escena pinta los de la sala visible).
  useEffect(() => {
    handleRef.current?.setPlayers(
      snapshot.players
        .filter((player) => !player.isSelf)
        .map(({ id, name, roomId: playerRoom, x, y, tint, characterId, connected }) => ({
          id,
          name,
          roomId: playerRoom,
          x,
          y,
          tint,
          characterId,
          connected,
        })),
    );
  }, [snapshot.players]);

  // Jugador local: sala y posición autoritativas.
  const self = snapshot.self;
  const selfRoom = self?.roomId;
  const selfX = self?.x;
  const selfY = self?.y;
  const selfTint = self?.tint;
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !selfRoom || selfX === undefined || selfY === undefined) return;
    if (serverRoomRef.current !== selfRoom) {
      // Primera posición o cruce aceptado: la escena pasa a la sala del servidor.
      serverRoomRef.current = selfRoom;
      if (sceneRoomRef.current !== selfRoom) {
        sceneRoomRef.current = selfRoom;
        handle.showRoom(selfRoom);
      }
      handle.placeAvatar(selfX, selfY);
      return;
    }
    const local = handle.avatarCell();
    if (local && sceneRoomRef.current === selfRoom) {
      // Desfase grande (movimiento rechazado, pestaña en segundo plano): manda el servidor.
      if (Math.hypot(local.x - selfX, local.y - selfY) > 3.5) handle.placeAvatar(selfX, selfY);
    }
  }, [selfRoom, selfX, selfY]);

  useEffect(() => {
    if (selfTint) handleRef.current?.setLocalTint(selfTint);
  }, [selfTint]);

  const selfCharacterId = self?.characterId;
  useEffect(() => {
    if (selfCharacterId) handleRef.current?.setLocalCharacter(selfCharacterId);
  }, [selfCharacterId]);

  const onReady = useCallback(
    (handle: GameSessionCanvasHandle) => {
      handleRef.current = handle;
      // Estado que llegó antes de montar Phaser.
      const current = snapshotRef.current;
      appliedObjectsRef.current = {};
      for (const [objectId, state] of Object.entries(current.objects)) {
        appliedObjectsRef.current[objectId] = state;
        if (declaresState(model, objectId, state)) handle.setObjectState(objectId, state);
      }
      if (current.self) {
        serverRoomRef.current = current.self.roomId;
        if (current.self.tint) handle.setLocalTint(current.self.tint);
        if (current.self.characterId) handle.setLocalCharacter(current.self.characterId);
        handle.placeAvatar(current.self.x, current.self.y);
      }
    },
    [model],
  );

  return { handleRef, onReady, sceneRoomRef };
}
