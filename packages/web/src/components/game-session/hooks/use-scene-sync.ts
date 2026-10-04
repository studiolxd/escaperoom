import { useCallback, useEffect, useRef, useState } from "react";
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

  /**
   * Habitación que muestra la escena (puede adelantarse al servidor al
   * cruzar). Empieza `undefined`, nunca con un valor de respaldo adivinado
   * ("primera del mapa", "lobby"…): `GameSessionCanvas` monta con `dynamic()`
   * (`ssr:false`, resuelve más tarde) y puede construir la escena con un
   * `self.roomId` YA REAL (más tarde en el tiempo) mientras este hook se creó
   * antes, con un `snapshot` todavía vacío (`self: null`, antes de conectar)
   * — dos adivinanzas independientes que no tienen por qué coincidir. Con
   * `undefined` de partida, el primer `selfRoom` real SIEMPRE dispara un
   * `showRoom()` explícito (ver el efecto de abajo), en vez de asumir que la
   * escena ya está en la sala correcta por casualidad.
   */
  const sceneRoomRef = useRef<string | undefined>(undefined);
  /** Última habitación autoritativa del jugador local. */
  const serverRoomRef = useRef<string | null>(null);
  const appliedObjectsRef = useRef<Record<string, string>>({});
  /**
   * `true` cuando la escena ya terminó de reconstruir la sala real del
   * jugador (revisión en vivo). El fundido de entrada (`EntryFade`) se queda
   * montado hasta que esto pasa a `true`, para no dejar ver un frame de la
   * sala ANTERIOR (la de la sala de espera: el jugador ya tiene ahí un
   * `roomId`/posición reales, no un placeholder, así que este paso a `true`
   * puede ocurrir mucho antes de entrar al mapa) mientras dura el fundido de
   * cámara de `RoomScene.setRoom` (~340ms) al cruzar a la sala real.
   *
   * Solo protege esa PRIMERA entrada: `enteredMapRef` hace que, para cruces
   * de sala posteriores (puertas dentro de la partida), `roomReady` se quede
   * en `true` sin más — esas transiciones ya las cubre el propio fundido de
   * cámara de Phaser, sin `EntryFade` de por medio, y taparlas con un fundido
   * de React aparte sería una regresión (una sala nueva de golpe cada vez).
   */
  const [roomReady, setRoomReady] = useState(false);
  const enteredMapRef = useRef(false);
  /** `true` cuando el canvas ya entregó su handle (`onReady`). */
  const [handleReady, setHandleReady] = useState(false);

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
        .map(({ id, name, roomId: playerRoom, x, y, h, yaw, tint, characterId, connected }) => ({
          id,
          name,
          roomId: playerRoom,
          x,
          y,
          h,
          yaw,
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
  const selfH = self?.h;
  const selfYaw = self?.yaw;
  const selfTint = self?.tint;
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !selfRoom || selfX === undefined || selfY === undefined) return;
    if (sceneRoomRef.current !== selfRoom) {
      // Solo se marca como hecho si `showRoom` no revienta (sala desconocida
      // en el modelo del cliente, p. ej.): si se diera por bueno antes de
      // llamarlo (como antes) y lanzara, esta sala quedaría marcada como "ya
      // mostrada" para siempre — ninguna futura actualización de posición
      // volvería a intentarlo, y la escena se quedaría encallada en la sala
      // vieja aunque el resto del HUD (temporizador, aside…) ya reflejase la
      // partida en marcha. Al no depender de `serverRoomRef` (abajo), sigue
      // reintentando en cada movimiento posterior hasta que funcione.
      try {
        if (!enteredMapRef.current) setRoomReady(false);
        handle.showRoom(selfRoom, () => {
          enteredMapRef.current = true;
          setRoomReady(true);
        });
        sceneRoomRef.current = selfRoom;
      } catch (err) {
        console.error(
          `useSceneSync: no se pudo mostrar la sala "${selfRoom}" (seguía en "${sceneRoomRef.current}")`,
          err,
        );
      }
    }
    if (serverRoomRef.current !== selfRoom) {
      // Primera posición o cruce aceptado: coloca al jugador en la sala del servidor.
      serverRoomRef.current = selfRoom;
      handle.placeAvatar(selfX, selfY, selfH, selfYaw);
      return;
    }
    const local = handle.avatarCell();
    if (local && sceneRoomRef.current === selfRoom) {
      // Desfase grande (movimiento rechazado, pestaña en segundo plano): manda el servidor.
      if (Math.hypot(local.x - selfX, local.y - selfY) > 3.5) {
        handle.placeAvatar(selfX, selfY, selfH, selfYaw);
      }
    }
  }, [selfRoom, selfX, selfY, selfH, selfYaw]);

  useEffect(() => {
    if (selfTint) handleRef.current?.setLocalTint(selfTint);
  }, [selfTint]);

  const selfCharacterId = self?.characterId;
  useEffect(() => {
    // "" (encargo retratos) es "sin personaje aún": también hay que
    // propagarlo (antes se ignoraba por ser falsy), o la escena se queda
    // con el de respaldo del constructor en vez de no pintar avatar.
    if (selfCharacterId !== undefined) handleRef.current?.setLocalCharacter(selfCharacterId);
  }, [selfCharacterId]);

  const onReady = useCallback(
    (handle: GameSessionCanvasHandle) => {
      handleRef.current = handle;
      setHandleReady(true);
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
        handle.setLocalCharacter(current.self.characterId);
        handle.placeAvatar(current.self.x, current.self.y, current.self.h, current.self.yaw);
      }
    },
    [model],
  );

  return { handleRef, onReady, sceneRoomRef, roomReady, handleReady };
}
