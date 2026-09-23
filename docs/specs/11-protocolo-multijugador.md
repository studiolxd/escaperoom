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
  avatarColor: string;
  x: number; y: number;             // posición (celdas, interpolada en cliente)
  roomId: string;                   // subroom actual
  role: 'host' | 'player' | 'observer';
  connected: boolean;
  voiceMuted: boolean; camOff: boolean;
}
```

**Qué NO viaja en el state (anti-trampa):**
- Códigos de candados, soluciones, pesos, melodías objetivo, asignación de símbolos (memoria).
- El servidor envía esa información solo en respuestas puntuales a mensajes autorizados (p. ej. el
  fragmento de pista dividida según posición).

## 4. Mensajes cliente → servidor (comandos)

Envoltura: `{type, payload, clientTime?}` — `clientTime` para corrección de reloj en puzzles de timing.

### 4.1 Conexión y lobby

| Mensaje | Payload | Quién | Respuesta / efecto |
|---|---|---|---|
| `join` | `{sessionId, joinToken, accessKey?}` | cualquiera | Valida compra/clave/joinToken → asigna role. Error si clave inválida/caducada/usada |
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
- Tipo de `attempt` por plantilla: `code_lock → {code}` · `sliding_puzzle → {positions}` ·
  `memory → {flip: cellIndex}` · `pipes → {rotations}` · `simultaneous_plates` no usa attempt
  (usa `plate_state`) · `combine` usa su propio mensaje.

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
- **Reconexión:** Colyseus `allowReconnection()` con 60 s de gracia; LiveKit reconecta con su token
  (aún válido). El estado del jugador (`connected: false → true`) se preserva.

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
