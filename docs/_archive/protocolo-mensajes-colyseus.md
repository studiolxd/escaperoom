# Protocolo de mensajes y comunicación en partida (Colyseus)

Acompaña a `especificaciones-escape-room-creator-v1.0.md` (§7), `planificacion-ampliada-puntos-1-12.md` (§1) y `roompackage-rey-aldric-v1.0.md`.

Este documento define el contrato cliente↔servidor al completo: qué mensajes existen, sus payloads, quién puede enviarlos y qué broadcasts generan. Si implementas el servidor o el cliente siguiendo esto, no necesitas hacerme preguntas.

---

## 1. Arquitectura de rooms

```
Cliente Next.js (Phaser + React)
   │  WebSocket (Colyseus client)
   ▼
Colyseus Server (Node.js)
   ├── LobbyRoom          ── matchmaking: lista de salas públicas, crear/unirse
   ├── GameRoom           ── una partida (la unidad de juego)
   │      · estado autoritativo (GameState)
   │      · evalúa reglas del motor
   │      · valida puzzles
   │      · emite eventos de analítica
   └── SpectatorRoom      ── observadores (organizador): suscripción de solo
                           lectura a N GameRooms simultáneas
```

- Una `Session` (del modelo de datos) ≈ una instancia de `GameRoom` con `sessionId` persistente en PostgreSQL.
- El room state de Colyseus es la **única fuente de verdad en vivo**; PostgreSQL guarda el resultado final y el histórico.
- LiveKit no pasa por Colyseus: el servidor de juego firma un token LiveKit al hacer join (ver §8).

## 2. Fases de la partida

```
created ──> lobby ──> playing ──> ended
                │         │
                │         └── paused (opcional: pausa de organizador, máx 5 min)
                └── aborted (todos salen antes de empezar)
```

- `created → lobby`: al crear la sesión (comprador u organizador). Los jugadores entran con compra/clave/invitación.
- `lobby → playing`: cuando el host pulsa "Comenzar" (o auto-arranque a los X min configurado).
- El estado de fase vive en `GameState.phase` y se sincroniza como cualquier otro campo.

## 3. Estado sincronizado (room state)

Lo que Colyseus sincroniza automáticamente (schema). Los clientes **solo reciben**, nunca escriben, este estado.

```typescript
class GameState extends Schema {
  phase: 'lobby' | 'playing' | 'paused' | 'ended';
  roomPackageVersion: string;       // versión congelada de la sala
  startedAt: number;
  endsAt: number;                   // startedAt + timeLimit (o 0 = sin límite)

  players = new MapSchema<PlayerState>();
  puzzles = new MapSchema<PuzzleRuntime>();
  objects = new MapSchema<ObjectRuntime>();   // {objectId, state}
  inventories = new MapSchema<InventoryState>(); // playerId → items[]
  flags = new MapSchema<string | number | boolean>();
  timers = new MapSchema<TimerState>();
  progress = new MapSchema<PuzzleProgress>(); // hintsUsed, attempts (analítica)
  chat: ChatMessage[];              // ventana móvil de últimos 50 mensajes
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
- El servidor envía esa información solo en respuestas puntuales a mensajes autorizados (ej: fragmento de pista dividida según posición).

## 4. Mensajes cliente → servidor (comandos)

Todos los mensajes siguen esta envoltura:

```typescript
// {type, payload, clientTime?} — clientTime para corrección de reloj en timing puzzles
{ type: 'chat', payload: {...}, clientTime: 1726912800123 }
```

### 4.1 Conexión y lobby

| Mensaje | Payload | Quién | Respuesta / efecto |
|---|---|---|---|
| `join` | `{sessionId, accessKey?}` | cualquiera | Valida compra/clave → asigna role. Error si clave inválida/caducada/usada |
| `set_ready` | `{ready: bool}` | jugador | Lobby. Cuando todos ready → host puede empezar |
| `start_game` | `{}` | host | `lobby → playing`. Inicia cronómetro, dispara regla `on_game_start` |
| `leave` | `{}` | cualquiera | Sale de la partida |

### 4.2 Movimiento y mundo

| Mensaje | Payload | Quién | Efecto |
|---|---|---|---|
| `move` | `{x, y, roomId}` | jugador | Actualiza posición en state (throttle: max 10 msg/s por cliente; el servidor interpola y valida distancia máxima por tick anti-teletransporte) |
| `interact` | `{objectId}` | jugador | Dispara evaluación de reglas `on_interact` del objeto + puzzles world asociados |
| `enter_room` | `{roomId}` | (sistema) | Se deriva del movimiento server-side (cruce de umbral); dispara `on_enter_room`. **El cliente no envía esto directamente** |

### 4.3 Puzzles

| Mensaje | Payload | Quién | Respuesta |
|---|---|---|---|
| `puzzle_open` | `{puzzleId}` | jugador | Abre panel UI. Server valida `available`; devuelve `puzzle_opened {puzzleId, runtimeVisible}` y marca `in_progress` |
| `puzzle_attempt` | `{puzzleId, attempt: unknown}` | jugador | Validación server. Respuestas en §5 |
| `puzzle_close` | `{puzzleId}` | jugador | Cierra panel (estado vuelve a `available` si nadie más lo tiene abierto) |
| `combine` | `{inputs: [itemA, itemB?]}` | jugador | Receta → `item_granted`/`invalid_combination` |
| `hint_request` | `{puzzleId}` | jugador | Consume pista (coste en pistas restantes) → `hint_delivered {tier, text}` |
| `plate_state` | `{plateId, active: bool}` | jugador | Solo puzzles `simultaneous_plates`: el cliente envía al pisar/salir; el servidor gestiona ventana temporal |
| `split_view` | `{}` | jugador | (split_clue) El servidor calcula qué fragmentos ve este jugador según su posición → `split_fragments {[index]: symbol}` |

### 4.4 Chat

| Mensaje | Payload | Quién | Efecto |
|---|---|---|---|
| `chat` | `{text}` (max 500 chars, sin HTML) | jugador u observador | Se añade a `state.chat` (todos lo reciben). Rate limit 2 msg/s |

### 4.5 Control (host y organizador)

| Mensaje | Payload | Quién | Efecto |
|---|---|---|---|
| `pause` / `resume` | `{}` | host u observador-organizador | Pausa global (congela timers server-side). Máx 5 min acumulados |
| `kick` | `{playerId}` | host | Expulsa jugador (libera su asiento en eventos) |
| `observer_join_rooms` | `{sessionIds: []}` | observador | (SpectatorRoom) suscripción a múltiples GameRooms |

## 5. Respuestas del servidor a `puzzle_attempt`

El servidor responde siempre con mensaje dirigido al emisor +, si procede, broadcast:

| Respuesta | Cuándo | Broadcast adicional |
|---|---|---|
| `attempt_result {ok: true}` | Acierto | `puzzle_solved {puzzleId, solvedBy, grantsItems, unlocks}` a todos → cada cliente reproduce la consecuencia (animación Phaser, cierre de panel, reglas) |
| `attempt_result {ok: false, error: 'wrong_code'}` | Fallo | — |
| `attempt_result {ok: false, error: 'locked_out', retryAfterSec}` | Candado bloqueado por intentos | — |
| `attempt_result {ok: false, error: 'not_available'}` | Puzzle bloqueado (requiresSolved pendiente) | — |
| `attempt_result {ok: false, error: 'cooldown', retryAfterSec}` | Puzzle en cooldown tras fail | — |

**Reglas generales de validación:**
- El servidor descarta cualquier `puzzle_attempt` sobre un puzzle en estado `solved`/`failed(permanent)` (responde `already_resolved`).
- Todo intento se registra en `progress[puzzleId].attempts` (analítica + anti-fuerza bruta).
- Tipo `attempt` por plantilla: `code_lock → {code: string}` · `sliding_puzzle → {positions: number[]}` · `memory → {flip: cellIndex}` · `pipes → {rotations: {[cell]: quarterTurns}}` · `simultaneous_plates` no usa attempt (usa `plate_state`) · `combine` usa su propio mensaje.

## 6. Mensajes servidor → cliente (broadcasts y eventos)

| Mensaje | Destinatarios | Cuándo |
|---|---|---|
| `player_joined` / `player_left` | todos | Cambios en lobby/jugadores |
| `phase_changed {phase}` | todos | Transiciones de fase |
| `object_state_changed {objectId, state}` | todos | Reglas/puzzles mutan objetos (Phaser reproduce animación) |
| `item_granted {playerId, itemId}` | todos (inventario es visible en cooperativo; configurable `privateInventory` por sala) | Recetas, reglas, puzzles |
| `dialog_show {dialogId, actorName?}` | todos | Reglas con `show_dialog` |
| `puzzle_solved` | todos | Ver §5 |
| `timer_update {timers}` | todos | Cada segundo (solo timers visibles; los internos no se sincronizan) |
| `game_ended {result, stats}` | todos | `victory | timeout | abandoned` + stats (tiempo, puzzles, pistas) |
| `chat_message {message}` | todos | — |
| `hint_delivered {puzzleId, tier, text}` | emisor | Consumo de pista |
| `error {code, message}` | emisor | Cualquier rechazo. Códigos en §7 |

## 7. Códigos de error

```
AUTH_KEY_INVALID      AUTH_KEY_USED        AUTH_KEY_EXPIRED     AUTH_SESSION_FULL
ROOM_VERSION_MISMATCH  (el cliente pide versión distinta a la congelada en la sesión)
NOT_AVAILABLE         ALREADY_SOLVED       LOCKED_OUT           COOLDOWN
RATE_LIMITED          MOVE_TOO_FAST        INVALID_STATE        PERMISSION_DENIED
RULE_EXECUTION_ERROR  (una regla abortó; se registra y se notifica al cliente como warn)
```

Convención: los errores de negocio van en `attempt_result`/`error`; los errores de protocolo cierran el mensaje con `error` genérico. Nada de stack traces al cliente.

## 8. Join completo: secuencia de conexión

```
Cliente                          Servidor (GameRoom)                Externo
  │ join {sessionId, accessKey}    │                                  │
  │───────────────────────────────>│  valida clave/compra (Postgres)  │
  │                                │  marca clave usada (si single-use)│
  │                                │  fija roomPackageVersion         │
  │                                │  firma token LiveKit             │──> LiveKit SFU
  │  {playerState, fullState,      │                                  │
  │   livekitToken, roomPkgUrl}    │                                  │
  │<───────────────────────────────│                                  │
  │                                │                                  │
  │── conecta LiveKit (voz/webcam)─┼─────────────────────────────────>│
```

- El token LiveKit tiene `room = gameRoom.name`, permisos de publicación de audio/video, y TTL = duración máxima de la sesión.
- En eventos educativos: el token se emite con video desactivado por defecto (`canPublishVideo: false` hasta que el jugador lo active explícitamente).
- **Reconexión:** Colyseus `allowReconnection()` con 60 s de gracia; LiveKit reconecta con su propio token (aún válido). El estado del jugador (`connected: false → true`) se preserva.

## 9. Rate limiting y validaciones de protocolo

| Mensaje | Límite |
|---|---|
| `move` | 10/s por cliente; salto máximo 3 celdas/tick validado server-side |
| `chat` | 2/s |
| `interact` | 4/s |
| `puzzle_attempt` | 2/s por puzzle + límites propios de cada plantilla (intentos, lockout) |
| `combine` | 3/s |
| Todo mensaje | schema-validado en servidor; payload inválido = `error INVALID_STATE` + log |

## 10. Emisión de analítica (puntos de instrumentación)

El GameRoom emite los eventos del punto 7 de la planificación ampliada en estos momentos:

| Evento | Dispara en |
|---|---|
| `session_started` / `player_joined` | transición de fase / join |
| `puzzle_attempted` / `puzzle_solved` / `puzzle_failed` | `puzzle_attempt` (resultado) |
| `hint_viewed` | `hint_request` |
| `item_granted` / `item_combined` | reglas / `combine` |
| `dialog_read` | al cerrar `dialog_show` |
| `session_ended` | `game_ended` |
| `key_redeemed` | join con clave |

Emisión: cola en Redis → worker → tabla `analytics_events` (append-only). Nunca bloquea el game loop; si la cola cae, se pierde analítica, nunca gameplay.

## 11. Matriz de permisos (resumen)

| Acción | Jugador | Host | Observador |
|---|---|---|---|
| moverse, interactuar, puzzles, chat | ✅ | ✅ | ❌ |
| start_game, pause, kick | ❌ | ✅ | pause ✅ |
| ver estado de partida | ✅ | ✅ | ✅ (solo lectura) |
| ver fragmentos split_clue | ✅ (los suyos) | ✅ | ❌ (nunca: anti-filtrado) |
| recibir soluciones/pesos/códigos | ❌ | ❌ | ❌ |

**El host no tiene privilegios de validación.** Host ≠ servidor: el host solo puede gestionar la sesión (empezar, pausar, expulsar), nunca resolver puzzles por decreto. Esto es deliberado: el host también es un cliente no fiable.
