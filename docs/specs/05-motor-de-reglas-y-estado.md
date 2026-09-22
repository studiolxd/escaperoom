# 05 — Motor de reglas y estado global

Depende de `04-runtime-juego-y-mundo.md` y `08-formato-roompackage.md`. Es el corazón del
runtime: conecta objetos, puzzles, inventario, flags y timers. **Se evalúa siempre en el
servidor** (Colyseus) sobre el estado de partida.

---

## 1. `GameState` — el estado global de la partida

```typescript
interface GameState {
  flags: Map<string, boolean | number | string>;   // flags libres del creador
  puzzleStates: Map<string, PuzzleRuntime>;         // estado de cada puzzle
  inventory: Map<playerId, string[]>;               // inventario por jugador
  objectStates: Map<string, string>;                // estado de cada WorldObject
  timers: Map<string, TimerState>;                  // timers activos
  hintsUsed: Map<puzzleId, number>;                 // pistas consumidas por puzzle
  startedAt: number;
  timeLimitSec?: number;
}
```

- Los **flags son libres**: el creador los nombra (`brasero_encendido`, `fase_final`,
  `digito3`). Las reglas los leen y escriben con `flag_is` / `set_flag`.
- **Flags reservadas del sistema:** `game_started`, `game_ended`, `time_remaining`.
- Solo la parte mínima vive en el room state sincronizado; la definición estática se descarga
  una vez (ver `specs/11-protocolo-multijugador.md` §3).

### 1.1 `PuzzleRuntime`

```typescript
interface PuzzleRuntime {
  state: PuzzleState;               // locked | available | in_progress | solved | failed
  solvedBy?: string;
  solvedAt?: number;
  attempts: number;
  // campos específicos de plantilla (p. ej. remaining-listen en secuencia musical)
}
```

## 2. Evaluación de reglas

### 2.1 Orden y prioridad

- Las reglas se evalúan tras cada evento (trigger) en orden de **`priority`** (mayor primero;
  empate = orden de creación).
- **Transaccionalidad:** si un trigger dispara N reglas, todas se evalúan sobre el estado
  resultante de aplicar las anteriores, en el mismo tick. Si una acción falla (p. ej.
  `consume_item` de un ítem inexistente), **la regla aborta entera y se registra**; no se aplica
  a medias.
- **Encadenamiento:** una regla puede provocar nuevas reglas (acción → nuevo evento interno →
  nuevas reglas). Límite de recursión: **32 saltos** (protección contra bucles de diseño).

### 2.2 Idempotencia y guardas

- Cada regla lleva `id` y, al disparar, registra `firedAt` + contador. Por defecto **dispara una
  sola vez** por partida (`once: true` por defecto; `repeatable: true` para reglas tipo contador).
- El validador advierte de reglas `repeatable` **sin condición de corte** (bucle de regalos
  infinitos: "al recoger la llave, dar la llave").

### 2.3 Delays y timers

```typescript
{ type: "delay", seconds: 3, actions: [...] }          // dentro de actions
{ type: "start_timer", id: "luces", durationSec: 30 }  // disparable y cancelable
{ type: "pause_timer", id: "agua" }                    // usado por plug-ins tipo agua que sube
{ type: "stop_timer", id: "agua" }
```

- Los timers viven en el servidor y se persisten en `GameState.timers`.
- Casos de uso canónicos: "al abrir la puerta → esperar 3 s → apagar luces + sonido" (scare);
  "si nadie resuelve el mural en 10 min → nueva pista gratis"; "el agua sube un nivel cada 5
  min hasta que se resuelva el drenaje".

## 3. Vocabulario de reglas (v1)

El vocabulario es **declarativo**: el runtime y el servidor evalúan datos, nunca código del
creador. Cubre las 23 plantillas y el escape room de ejemplo; se extiende por plugin en v2.

### Triggers

| Trigger | Payload | Se dispara cuando |
|---|---|---|
| `on_interact` | `{ objectId }` | El jugador interactúa con un objeto |
| `on_enter_room` | `{ roomId }` | Un jugador entra a una habitación (derivado del movimiento) |
| `on_puzzle_solved` | `{ puzzleId }` | Un puzzle pasa a `solved` |
| `on_item_collected` | `{ itemId }` | Se otorga un ítem |
| `on_timer` | `{ timerId }` | Un timer existente cumple su hito |
| `on_timer_end` | `{ timerId }` | Un timer termina |
| `on_time_remaining_below` | `{ seconds }` | Quedan menos de X segundos |
| `on_all_players_in_zone` | `{ zone }` | Todos los jugadores están en una zona |
| `on_game_start` | `{}` | Empieza la partida |

### Condiciones

| Condición | Payload |
|---|---|
| `item_in_inventory` | `{ itemId, consumed?: boolean }` |
| `puzzle_state_is` | `{ puzzleId, state }` |
| `object_state_is` | `{ objectId, state }` |
| `flag_is` | `{ flag, value }` |
| `player_count_min` / `player_count_max` | `{ n }` |
| `time_remaining_below` | `{ seconds }` |

### Acciones

| Acción | Payload |
|---|---|
| `set_object_state` | `{ objectId, state }` |
| `unlock_door` | `{ objectId }` |
| `grant_item` | `{ itemId, to: 'interactor' \| 'all' \| playerId }` |
| `consume_item` | `{ itemId }` |
| `show_dialog` | `{ dialogId }` |
| `start_timer` / `pause_timer` / `stop_timer` | `{ id, durationSec? }` |
| `play_sound` | `{ soundId }` |
| `spawn_effect` | `{ effectId, position? }` |
| `open_panel_puzzle` | `{ puzzleId }` |
| `set_flag` | `{ flag, value }` |
| `reveal_number` | `{ objectId, value }` |
| `delay` | `{ seconds, actions }` |
| `end_game` | `{ result: 'victory' \| 'timeout' \| 'abandoned' }` |

## 4. Ejemplos de la sala de referencia

**Encender el brasero** (receta obligatoria para ver el dígito 3):

```json
{
  "id": "r-encender-brasero", "priority": 0, "once": true,
  "trigger": { "type": "on_interact", "objectId": "brasero" },
  "conditions": [ { "type": "item_in_inventory", "itemId": "antorcha", "consumed": true } ],
  "actions": [
    { "type": "set_object_state", "objectId": "brasero", "state": "lit" },
    { "type": "set_flag", "flag": "digito3", "value": 3 },
    { "type": "show_dialog", "dialogId": "d-brasero" },
    { "type": "play_sound", "soundId": "fx-fuego" }
  ]
}
```

**Sello final** (doble candado: canal resuelto + altar con agua, con delay de 4 s antes de
victoria):

```json
{
  "id": "r-sello-resuelto", "priority": 10, "once": true,
  "trigger": { "type": "on_puzzle_solved", "puzzleId": "p-sello-final" },
  "conditions": [ { "type": "object_state_is", "objectId": "altar", "state": "flowing" } ],
  "actions": [
    { "type": "set_object_state", "objectId": "relicario", "state": "open" },
    { "type": "play_sound", "soundId": "fx-victoria" },
    { "type": "delay", "seconds": 4, "actions": [ { "type": "end_game", "result": "victory" } ] }
  ]
}
```

**Doble uso del cáliz sin soft-lock** (regla recuperable, `once: false` con guarda doble):

```json
{
  "id": "r-recoger-caliz", "priority": 0, "once": false,
  "trigger": { "type": "on_interact", "objectId": "mural-ranura" },
  "conditions": [
    { "type": "object_state_is", "objectId": "mural-ranura", "state": "filled" },
    { "type": "puzzle_state_is", "puzzleId": "p-placas-estatuas", "state": "solved" }
  ],
  "actions": [
    { "type": "set_object_state", "objectId": "mural-ranura", "state": "empty" },
    { "type": "grant_item", "itemId": "caliz-real", "to": "interactor" }
  ]
}
```

## 5. Interacción con puzzles

- Un puzzle resuelto emite `on_puzzle_solved`; el motor aplica `grantsItems`, `unlocks` y dispara
  las reglas que lo escuchen.
- Las reglas son el pegamento entre puzzles: pueden desbloquear un puzzle (`set_object_state` que
  cambia un `lockedBy`), otorgar ítems, mostrar diálogos o abrir paneles.
- Las condiciones sobre `puzzle_state_is` y `object_state_is` permiten encadenar (p. ej. el sello
  final exige canal resuelto y altar con agua).

## 6. Validación del motor

- El **validador** (`specs/09-editor-de-salas.md` §validador, `specs/22-qa-y-pruebas.md` §2)
  corre el mismo motor en modo forward-chaining para comprobar solvabilidad, dead ends y objetos
  huérfanos.
- El motor es determinista y el espacio de estados de una sala típica (decenas de puzzles/flags)
  cierra en milisegundos.

## 7. Dependencias

- `specs/04-runtime-juego-y-mundo.md` — objetos y mundo sobre los que opera.
- `specs/06-plantillas-puzzle-mvp.md` y `07-plantillas-puzzle-v2.md` — qué disparan los puzzles.
- `specs/08-formato-roompackage.md` — serialización de reglas en el `RoomPackage`.
- `specs/22-qa-y-pruebas.md` — validador y test de solvabilidad.
