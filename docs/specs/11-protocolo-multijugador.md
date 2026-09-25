# 11 — Protocolo multijugador (Colyseus)

Depende de `04-runtime-juego-y-mundo.md`, `05-motor-de-reglas-y-estado.md` y
`08-formato-roompackage.md`. Define el contrato cliente↔servidor al completo: mensajes, payloads,
emisores permitidos y broadcasts. Implementar servidor y cliente según este documento no deja
preguntas abiertas.

---

## 1. Arquitectura de rooms

```
Cliente Next.js (Phaser + React)
   │  WebSocket (Colyseus client) + joinToken (JWT corto)
   ▼
Colyseus Server (Node.js)
   ├── LobbyRoom          ── matchmaking: lista de salas públicas, crear/unirse
   ├── GameRoom           ── una partida (la unidad de juego)
   │      · estado autoritativo (GameState)
   │      · evalúa reglas del motor
   │      · valida puzzles
   │      · emite eventos de analítica
   └── SpectatorRoom      ── observadores (organizador): suscripción de solo lectura a N GameRooms
```

- Una `Session` (de la BD) ≈ una instancia de `GameRoom` con `sessionId` persistente en PostgreSQL.
- El room state de Colyseus es la **única fuente de verdad en vivo**; Postgres guarda el
  resultado final y el histórico.
- LiveKit no pasa por Colyseus: el servidor de juego firma un token LiveKit al hacer join (§8).
- **Matchmaking y "una partida" B2C:** al crear la partida por primera vez, el servidor comprueba
  `purchases.play_session_started_at IS NULL`; si lo está, lo rellena y guarda el `colyseusRoomId`.
  Una segunda llamada a matchmake para la misma compra se rechaza salvo reconexión a la misma
  `GameRoom` (ver `specs/02-modelo-de-negocio.md` §2.1).
- **Tope de jugadores:** el número máximo por sala es un único valor de plataforma
  (`platformSetting.maxPlayersPerRoom`, default 6) que alimenta a la vez el validador de
  creación de salas y el cap de publishers de LiveKit (ver `specs/12-voz-y-webcam-livekit.md` §3).

## 2. Fases de la partida

```
created ──> lobby ──> playing ──> ended
                │         │
                │         └── paused (pausa de organizador, máx 5 min acumulados)
                └── aborted (todos salen antes de empezar)
```

- `created → lobby`: al crear la sesión (comprador u organizador). Los jugadores entran con
  compra/clave/invitación.
- `lobby → playing`: cuando el host pulsa "Comenzar" (o auto-arranque tras X min configurado).
- El estado de fase vive en `GameState.phase` y se sincroniza como cualquier otro campo.

## 3. Estado sincronizado (room state)

Lo que Colyseus sincroniza automáticamente (schema). Los clientes **solo reciben**, nunca escriben.

```typescript
class GameState extends Schema {
  phase: 'lobby' | 'playing' | 'paused' | 'ended';
  roomPackageVersion: string;       // versión congelada de la sala
  startedAt: number;
  endsAt: number;                   // startedAt + timeLimit (o 0 = sin límite)

  players = new MapSchema<PlayerState>();
  puzzles = new MapSchema<PuzzleRuntime>();
  objects = new MapSchema<ObjectRuntime>();       // {objectId, state}
  inventories = new MapSchema<InventoryState>();  // playerId → items[]
  flags = new MapSchema<string | number | boolean>();
  timers = new MapSchema<TimerState>();
  progress = new MapSchema<PuzzleProgress>();     // hintsUsed, attempts (analítica)
  chat: ChatMessage[];                            // ventana móvil de últimos 50 mensajes
  result?: 'victory' | 'timeout' | 'abandoned';
}

class PlayerState extends Schema {
  sessionId: string;                // id de Colyseus
  userId: string;
  name: string;
  avatarColor: string;              // pinta el anillo bajo los pies, no el sprite del personaje
  characterId: string;              // personaje elegido (manifest.avatars[].id, o el de reserva)
  x: number; y: number;             // posición (celdas, interpolada en cliente)
  roomId: string;                   // subroom actual
  role: 'host' | 'player' | 'observer';
  connected: boolean;
  voiceMuted: boolean; camOff: boolean;
}
```

**Personaje único por sesión (A1, `26-pack-grafico-v1.md` §4.4):** dos jugadores de la misma
sesión no pueden compartir `characterId` — excepto el maniquí de reserva, que no es único (varios
jugadores caen a él mientras falten personajes en el pack). El servidor es la autoridad: valida
`characterId` contra `manifest.avatars` y contra los ya ocupados, y resuelve la carrera de dos
jugadores que eligen el mismo a la vez procesando las peticiones en el orden en que llegan (el
segundo pierde y cae al siguiente libre, o al maniquí). El lobby (`specs/19` §1) muestra los
personajes ocupados como no disponibles.

**Qué NO viaja en el state (anti-trampa):**
- Códigos de candados, soluciones, pesos, melodías objetivo, asignación de símbolos (memoria).
- El servidor envía esa información solo en respuestas puntuales a mensajes autorizados (p. ej. el
  fragmento de pista dividida según posición).

## 4. Mensajes cliente → servidor (comandos)

Envoltura: `{type, payload, clientTime?}` — `clientTime` para corrección de reloj en puzzles de timing.

### 4.1 Conexión y lobby

| Mensaje | Payload | Quién | Respuesta / efecto |
|---|---|---|---|
| `join` | `{sessionId, joinToken, accessKey?, characterId?}` | cualquiera | Valida compra/clave/joinToken → asigna role. Error si clave inválida/caducada/usada. `characterId` es opcional: sin él (o si está ocupado/no existe), el servidor asigna el primer libre, o el maniquí de reserva |
| `select_character` | `{characterId}` | jugador | Lobby o en partida. El servidor valida unicidad contra `manifest.avatars`; rechaza (`NOT_AVAILABLE`) si ya está en uso por otro jugador |
| `set_ready` | `{ready: bool}` | jugador | Lobby. Cuando todos ready → host puede empezar |
| `start_game` | `{}` | host | `lobby → playing`. Inicia cronómetro, dispara regla `on_game_start` |
| `leave` | `{}` | cualquiera | Sale de la partida |

### 4.2 Movimiento y mundo

| Mensaje | Payload | Quién | Efecto |
|---|---|---|---|
| `move` | `{x, y, roomId}` | jugador | Actualiza posición (throttle 10 msg/s; el servidor interpola y valida salto máximo por tick) |
| `interact` | `{objectId}` | jugador | Dispara reglas `on_interact` del objeto + puzzles world asociados |
| `enter_room` | `{roomId}` | (sistema) | Derivado del movimiento server-side; dispara `on_enter_room`. **El cliente no lo envía** |

### 4.3 Puzzles

| Mensaje | Payload | Quién | Respuesta |
|---|---|---|---|
| `puzzle_open` | `{puzzleId}` | jugador | Valida `available`; devuelve `puzzle_opened {puzzleId, runtimeVisible}` y marca `in_progress` |
| `puzzle_attempt` | `{puzzleId, attempt}` | jugador | Validación server. Respuestas en §5 |
| `puzzle_close` | `{puzzleId}` | jugador | Cierra panel (vuelve a `available` si nadie más lo tiene abierto) |
| `combine` | `{inputs: [itemA, itemB?]}` | jugador | Receta → `item_granted` / `invalid_combination` |
| `hint_request` | `{puzzleId}` | jugador | Consume pista → `hint_delivered {tier, text}` |
| `plate_state` | `{plateId, active: bool}` | jugador | Solo `simultaneous_plates`: el servidor gestiona la ventana temporal |
| `split_view` | `{}` | jugador | `split_clue`: el servidor calcula qué fragmentos ve este jugador según posición → `split_fragments {[index]: symbol}` |

### 4.4 Chat

| Mensaje | Payload | Quién | Efecto |
|---|---|---|---|
| `chat` | `{text}` (máx. 500 chars, sin HTML) | jugador u observador | Se añade a `state.chat` (todos lo reciben). Rate limit 2 msg/s |

### 4.5 Control (host y organizador)

| Mensaje | Payload | Quién | Efecto |
|---|---|---|---|
| `pause` / `resume` | `{}` | host u observador-organizador | Pausa global (congela timers server-side). Máx. 5 min |
| `kick` | `{playerId}` | host | Expulsa jugador (libera su asiento en eventos) |
| `observer_join_rooms` | `{sessionIds: []}` | observador | (SpectatorRoom) suscripción a múltiples GameRooms |

## 5. Respuestas del servidor a `puzzle_attempt`

El servidor responde dirigido al emisor y, si procede, con broadcast:

| Respuesta | Cuándo | Broadcast adicional |
|---|---|---|
| `attempt_result {ok: true}` | Acierto | `puzzle_solved {puzzleId, solvedBy, grantsItems, unlocks}` a todos → cada cliente reproduce la consecuencia |
| `attempt_result {ok: false, error: 'wrong_code'}` | Fallo | — |
| `attempt_result {ok: false, error: 'locked_out', retryAfterSec}` | Candado bloqueado | — |
| `attempt_result {ok: false, error: 'not_available'}` | Puzzle bloqueado (`requiresSolved` pendiente) | — |
| `attempt_result {ok: false, error: 'cooldown', retryAfterSec}` | Cooldown tras fail | — |
| `already_resolved` | Puzzle ya `solved`/`failed(permanent)` | — |

**Reglas generales:**
- Todo intento se registra en `progress[puzzleId].attempts` (analítica + anti-fuerza bruta).
- Tipo de `attempt` por plantilla: `code_lock → {code}` · `sliding_puzzle → {move}` ·
  `memory → {flip: cellIndex}` · `pipes → {rotate, turns?} | {gate}` · `simultaneous_plates` no usa
  attempt (usa `plate_state`) · `combine` usa su propio mensaje.

### 5.1 `sliding_puzzle` y `pipes`: una acción por clic, no el estado final

> **Desviación aceptada del spec original** (registrada en `docs/reference/registro-de-decisiones.md`
> ADR-026). Una versión anterior de este documento describía `sliding_puzzle` y `pipes` mandando el
> estado final completo resuelto en el cliente (`{positions}` con todas las fichas, `{rotations}` con
> todas las tuberías). La implementación real (ticket 2.8) es pieza a pieza: cada clic manda **una
> sola acción**, el servidor lleva el tablero (`RoomSession` en `packages/shared/src/session/
> room-session.ts`) y revalida tras cada acción contra la definición del puzzle
> (`packages/shared/src/templates/sliding-puzzle.ts`, `pipes.ts`).

- **`sliding_puzzle` — `puzzle_attempt {puzzleId, attempt: {move: <índice de celda>}}`.**
  `move` es el índice (row-major) de la ficha que el jugador intenta deslizar; solo se acepta si es
  adyacente al hueco (`slidingNeighborIndices`). El servidor aplica `moveSlidingTile` sobre el
  tablero guardado en `RoomSession` y devuelve `attempt_result {outcome}` con uno de:
  `moved | solved | not_adjacent | unavailable | already_solved`.
- **`pipes` — dos formas de `attempt` (unión discriminada por la clave presente):**
  - Girar una tubería 90° en sentido horario: `{rotate: <índice de celda>, turns?: 1-3}` (`turns`
    opcional, por defecto `1`). El servidor aplica `rotatePipe`; desenlaces:
    `rotated | solved | not_rotatable | invalid_rotation | unavailable | already_solved`.
  - Abrir una compuerta con un objeto del inventario: `{gate: <índice de celda>}`. El servidor
    aplica `openPipesGate` (usa el inventario **de quien presenta**, specs/11 §4.3); desenlaces:
    `opened | solved | missing_item | not_a_gate | already_open | unavailable | already_solved`.
- El servidor recalcula el tablero completo tras cada acción y lo sincroniza en la proyección
  pública del puzzle (`toSlidingPuzzlePublicView` / `toPipesPuzzlePublicView`, sin `seed` ni
  `solution`); todos los jugadores con el panel abierto ven la ficha o la tubería moverse en cuanto
  el servidor confirma.

**Por qué una acción por clic y no el estado final:** estos dos puzzles se juegan en cooperativo —
dos jugadores pueden tener el mismo panel abierto a la vez. Si el cliente resolviera localmente y
mandara solo el estado final, un jugador no vería los movimientos del otro hasta que ese otro
terminara (o nunca, si el cliente resuelve todo de un tirón sin re-render intermedio). Mandando una
acción por clic y dejando que el servidor lleve el tablero, cada movimiento se sincroniza y anima en
tiempo real para todos los presentes: dos personas cooperando en el mismo puzle se ven mover las
piezas la una a la otra, que es justamente el punto de un escape room multijugador.

## 6. Mensajes servidor → cliente (broadcasts y eventos)

| Mensaje | Destinatarios | Cuándo |
|---|---|---|
| `player_joined` / `player_left` | todos | Cambios en lobby/jugadores |
| `phase_changed {phase}` | todos | Transiciones de fase |
| `object_state_changed {objectId, state}` | todos | Reglas/puzzles mutan objetos (Phaser anima) |
| `item_granted {playerId, itemId}` | todos (configurable `privateInventory` por sala) | Recetas, reglas, puzzles |
| `dialog_show {dialogId, actorName?}` | todos | Reglas con `show_dialog` |
| `puzzle_solved` | todos | Ver §5 |
| `timer_update {timers}` | todos | Cada segundo (solo timers visibles) |
| `game_ended {result, stats}` | todos | `victory \| timeout \| abandoned` + stats |
| `chat_message {message}` | todos | — |
| `hint_delivered {puzzleId, tier, text}` | emisor | Consumo de pista |
| `error {code, message}` | emisor | Cualquier rechazo. Códigos en §7 |

## 7. Códigos de error

```
AUTH_KEY_INVALID      AUTH_KEY_USED        AUTH_KEY_EXPIRED     AUTH_SESSION_FULL
ROOM_VERSION_MISMATCH  (el cliente pide versión distinta a la congelada en la sesión)
NOT_AVAILABLE         ALREADY_SOLVED       LOCKED_OUT           COOLDOWN
RATE_LIMITED          MOVE_TOO_FAST        INVALID_STATE        PERMISSION_DENIED
RULE_EXECUTION_ERROR  (una regla abortó; se registra y se notifica como warn)
```

Convención: los errores de negocio van en `attempt_result`/`error`; los de protocolo cierran el
mensaje con `error` genérico. Nunca se envía un stack trace al cliente.

## 8. Join completo: secuencia de conexión

```
Cliente                          Servidor (GameRoom)                Externo
  │ redeem previo (REST) ──────────────────────────────────────────> devuelve joinToken
  │ join {sessionId, joinToken, accessKey?} │
  │───────────────────────────────>│  valida clave/compra/joinToken (Postgres)
  │                                │  marca clave usada (si single-use)
  │                                │  fija roomPackageVersion
  │                                │  firma token LiveKit             │──> LiveKit SFU
  │  {playerState, fullState,      │
  │   livekitToken, roomPkgUrl}    │
  │<───────────────────────────────│
  │                                │
  │── conecta LiveKit (voz/webcam)─┼─────────────────────────────────>│
```

- **Room `event` (ticket 5.12):** al crearse, la room lee en servidor el `roomVersion.package`
  congelado del evento del `joinToken` (`event.roomVersionId`) y juega esa versión exacta; el
  cliente no elige ni envía paquete. Cada hito (inicio, puzzle resuelto, pista, puerta abierta,
  fin con resultado y tiempo) se persiste en `progressEvent` (`specs/14` §8.1) sin bloquear el
  bucle, y el fin de la partida escribe `group.completedAt`. Sin base de datos configurada en
  producción, la room `event` no se crea (`EVENT_UNAVAILABLE`).
- El token LiveKit tiene `room = gameRoom.name`, permisos de publicación de audio/vídeo y
  TTL = duración máxima de la sesión.
- En eventos educativos: token con vídeo desactivado por defecto (`canPublishVideo: false` hasta
  activación explícita).
- **Reconexión** (C-1/C-2, auditoría 2026-09-24 — sustituye la redacción anterior de 60 s fijos):
  - **Desconexión sin consentir** (caída de red, pestaña cerrada): la plaza —posición, inventario,
    `characterId`— se reserva con `allowReconnection()`. En el **lobby** (aún sin empezar), la
    gracia es de **60 s**: pasado ese tiempo se purga la plaza (no queda cupo fantasma). **En
    juego** (`playing`), la plaza se reserva **hasta que la partida termina**, no solo 60 s: quien
    vuelve —con el SDK de Colyseus (token de reconexión nativo) o con el mismo `joinToken`/
    `gameToken` desde otra pestaña (`EventRoom`, C-1: mismo `playerId`, hereda la plaza y expulsa
    el socket anterior sin gracia)— recupera exactamente su jugador.
  - **Anfitrión:** si el anfitrión se desconecta, a los **60 s** otro jugador conectado pasa a
    anfitrión PROVISIONAL (para no bloquear al resto — el puesto, no la plaza). Si el anfitrión
    original vuelve en cualquier momento antes de que la partida termine, RECUPERA el puesto y el
    provisional lo pierde.
  - **Tokens** (`EventRoom`): el `joinToken` tiene que servir tanto para el `join` inicial como
    para volver a la MISMA plaza durante toda la partida, así que su TTL por defecto sube al tope
    configurable (`MAX_JOIN_TOKEN_TTL_SECONDS`, 2 h); un operador con salas más cortas puede
    acortarlo con `JOIN_TOKEN_TTL_SECONDS`. Un token robado solo sirve para ocupar/heredar la MISMA
    plaza (`playerId`), nunca otra: no da más control que el que ya tenía esa plaza.
  - LiveKit reconecta con su propio token (independiente del de Colyseus).
  - **`GameRoom` desnuda — mecanismo del CLIENTE web** (ajuste 2026-09-25, revisión de la
    coordinadora sobre la PR #146): a diferencia de `EventRoom`, la `GameRoom` no tiene un
    `playerId` estable (varias personas pueden compartir legítimamente el mismo `gameToken` de
    compra), así que el servidor por sí solo no basta — sin cooperación del cliente, recargar la
    página o cerrar y reabrir la pestaña pierde el `reconnectionToken` de Colyseus en memoria y
    entra como jugador NUEVO mientras la plaza antigua queda reservada vacía hasta el fin. La web
    (`packages/web/src/lib/game-reconnect.ts`, `use-game-connection.ts`) guarda en **`localStorage`**
    (sobrevive a cerrar la pestaña; `sessionStorage` no) por `roomId`:
    1. el `reconnectionToken` de Colyseus, que se reintenta primero (`client.reconnect()`, antes de
       cualquier `join`/`create`) — recupera la MISMA `sessionId`, sin pasar por `onJoin`;
    2. un `seatKey` aleatorio del navegador (nunca ligado a una cuenta), que la `GameRoom` reconoce
       en `onJoin` igual que `EventRoom` reconoce el `playerId`: si el `reconnectionToken` caducó,
       se perdió o el servidor lo rechaza, la nueva conexión con el mismo `seatKey` hereda la plaza
       (posición, inventario, `characterId`) y expulsa el socket anterior sin gracia.
    La página solo pide el nombre de nuevo cuando NO hay ninguna reconexión guardada para la
    `roomId` conocida (link de invitación con `?room=`); si la hay, entra directamente. El cierre
    del efecto de conexión (`useEffect` de `useGameConnection`) usa `leave(false)` —NO consentido—
    para no liberar la plaza por navegar dentro de la app o por un re-render: solo una salida
    EXPLÍCITA (`leaveGame()`, para cuando exista un botón dedicado) usa `leave(true)`.

### 8.1 Fin de partida y cierre

Al terminar la partida (`game_ended`: victoria, derrota o tiempo agotado):

1. Se difunde `game_ended` con el resultado y las estadísticas (§6), como hasta ahora.
2. **Ya no se admite ninguna reconexión**: toda plaza con una reconexión pendiente se rechaza de
   inmediato (aunque la desconexión hubiera sido un segundo antes del final).
3. La room se mantiene **5 minutos** (`RESULTS_ROOM_LIFETIME_SEC`) para que todos vean la pantalla
   de resultados con calma.
4. Pasado ese margen, la room desconecta a todos los clientes y se destruye (`onDispose`).
5. Los resultados quedan persistidos fuera de la room para poder consultarlos después de que se
   cierre: en `EventRoom`, el hito `game_ended` ya escribe en `progressEvent` (`specs/14` §8.1) el
   resultado, la duración y las pistas usadas, y cierra `group.completedAt` de los grupos que
   jugaron — suficiente para una pantalla de resultados fuera de la room. La `GameRoom` B2C
   (compra sin evento) no tiene panel de resultados fuera de la room; si se necesita, es un
   ticket aparte (no lo cubre esta corrección).

## 9. Rate limiting y validaciones de protocolo

| Mensaje | Límite |
|---|---|
| `move` | 10/s por cliente; salto máximo 3 celdas/tick validado server-side |
| `chat` | 2/s |
| `interact` | 4/s |
| `puzzle_attempt` | 2/s por puzzle + límites propios de plantilla (intentos, lockout) |
| `combine` | 3/s |
| Todo mensaje | schema-validado en servidor; payload inválido = `error INVALID_STATE` + log |

## 10. Emisión de analítica (puntos de instrumentación)

| Evento | Dispara en |
|---|---|
| `session_started` / `player_joined` | transición de fase / join |
| `puzzle_attempted` / `puzzle_solved` / `puzzle_failed` | `puzzle_attempt` (resultado) |
| `hint_viewed` | `hint_request` |
| `item_granted` / `item_combined` | reglas / `combine` |
| `dialog_read` | al cerrar `dialog_show` |
| `session_ended` | `game_ended` |
| `key_redeemed` | join con clave |

Emisión: cola en Redis → worker → tabla `analyticsEvent` (append-only). Nunca bloquea el game
loop; si la cola cae, se pierde analítica, nunca gameplay. Taxonomía completa en `specs/16-analitica.md`.

## 11. Matriz de permisos

| Acción | Jugador | Host | Observador |
|---|---|---|---|
| moverse, interactuar, puzzles, chat | ✅ | ✅ | ❌ |
| start_game, pause, kick | ❌ | ✅ | pause ✅ |
| ver estado de partida | ✅ | ✅ | ✅ (solo lectura) |
| ver fragmentos `split_clue` | ✅ (los suyos) | ✅ | ❌ (anti-filtrado) |
| recibir soluciones/pesos/códigos | ❌ | ❌ | ❌ |

**Implementación v1 (ticket 5.9).** El observador no es una room aparte: es un **modo de la
room `event`**. El organizador entra con `{ sessionId, spectatorToken }` (JWT HS256 de audiencia
propia firmado por web con `JOIN_TOKEN_SECRET`, 5 min para hacer el `join`) en una room ya creada
(`join`, nunca `create`): recibe el room state y los broadcasts, no aparece en `players` ni ocupa
plaza de juego (hasta 4 observadores por room). Cualquier mensaje suyo —incluidos `chat`, pedir
token de medios y pistas— se rechaza con `PERMISSION_DENIED` antes de llegar al motor; como las
respuestas con datos de un puzzle (`puzzle_view`, `attempt_result`, `split_fragments`,
`hint_delivered`) solo van a quien las pidió, nunca recibe soluciones. `pause` y la suscripción a N
rooms (`observer_join_rooms`) quedan para cuando exista la pausa global.

**El host no tiene privilegios de validación.** Host ≠ servidor: solo gestiona la sesión
(empezar, pausar, expulsar), nunca resuelve puzzles por decreto. Deliberado: el host también es un
cliente no fiable.

## 12. Dependencias

- `specs/12-voz-y-webcam-livekit.md` — token, permisos y ciclo de vida de medios.
- `specs/13-api-rest.md` §6 — `redeem` que produce el `joinToken`.
- `specs/16-analitica.md` — taxonomía de eventos.
