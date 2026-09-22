# 07 — Plantillas de puzzle (v2)

Extiende `06-plantillas-puzzle-mvp.md` con el mismo nivel de detalle. Todas comparten la
interfaz base `PuzzleDefinition` y las reglas comunes: validación **siempre en servidor**, el
cliente nunca conoce la solución, `soloBridgeItemId` permite modo solitario, y cada puzzle
dispara `solved` → reglas del motor (`grantsItems`, `unlocks`).

Resumen comparativo completo en `reference/catalogo-plantillas.md`.

---

## Parte A — Puzzles individuales (panel React)

### A1. `sequence_music` — Secuencia musical · `<SequencePuzzle>`

```typescript
interface SequenceMusicDefinition extends PuzzleDefinition {
  type: 'sequence_music';
  notes: NoteConfig[];            // campana, telas, botones... con nota asociada
  melody: string[];               // ["do","mi","mi","sol"] — solo en servidor
  listenAllowed: number;          // cuántas veces puede escuchar la melodía
  playbackSpeed: number;          // bpm
  wrongResets: boolean;           // fallar reinicia la secuencia introducida
}
```

- **Estados:** `locked → available → in_progress → solved`. Contador `listenUsed` en runtime.
- **Validación:** el cliente envía la secuencia completa; el servidor compara con `melody`. Si
  `wrongResets`, cualquier error parcial reinicia el input (lo decide el servidor; el cliente
  solo ve "error").
- **Anti-trampa:** la melodía objetivo jamás viaja al cliente. El servidor emite eventos de
  **reproducción con timing**, no la secuencia; los samples suenan en cliente sobre esos eventos.
- **Ejemplo:** 5 copas de cristal; la melodía suena al tocar el cuerno; reproducirla con las copas.

### A2. `balance_scale` — Pesas y balanza · `<BalancePuzzle>`

```typescript
interface BalanceScaleDefinition extends PuzzleDefinition {
  type: 'balance_scale';
  weights: { id: string; sprite: string; label?: string }[];  // peso oculto
  targetLeft: string[];           // solución: ids al platillo izquierdo
  targetRight: string[];
  weighingsLimit?: number;
  tolerance: number;              // normalmente 0; >0 admite soluciones alternativas
}
```

- **Estados:** `locked → available → in_progress → solved` (o `failed` si agota `weighingsLimit`).
- **Validación:** cada pesada envía `left`/`right`; el servidor responde `-1 | 0 | 1` **sin
  revelar los pesos**. La solución se valida al confirmar. Con límite, agotarlo sin resolver →
  `failed` (o cooldown según config).
- **Anti-trampa:** los pesos reales viven solo en el servidor.
- **Ejemplo:** 6 runas de pesos desconocidos; equilibrar la balanza con 3 a cada lado en máx. 4 pesadas.

### A3. `symbol_sudoku` — Sudoku de símbolos · `<SudokuPuzzle>`

```typescript
interface SymbolSudokuDefinition extends PuzzleDefinition {
  type: 'symbol_sudoku';
  gridSize: 4 | 6 | 9;
  symbols: string[];
  givens: CellValue[];            // {x,y,symbol}
  solution: CellValue[];          // solo servidor
  regions?: Region[];
  checksLimit?: number;           // si se define, cada "comprobar" consume una
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** dos modos: `checkOnSubmit` (rejilla completa) o `checkCell` (validación por
  celda, consume "comprobación" si hay `checksLimit`). El servidor también valida **reglas de
  sudoku** en cada envío (duplicados en fila/columna/región) para dar feedback sin revelar la
  solución.
- **Ejemplo:** sudoku 4×4 en los vitrales; los símbolos son los de los cuatro reinos.

### A4. `timing_press` — Reflejos / timing · `<TimingPuzzle>`

```typescript
interface TimingPressDefinition extends PuzzleDefinition {
  type: 'timing_press';
  rounds: number;                 // pulsaciones acertadas requeridas
  windowMs: number;               // tolerancia temporal
  speedRamp: number;              // aceleración por ronda (1 = constante)
  markerPath: 'linear' | 'circle';
  maxMisses?: number;
}
```

- **Estados:** `locked → available → in_progress → solved` (o `failed` tras N errores si `maxMisses`).
- **Validación:** el cliente envía `pressAt` (timestamp de cliente, corregido con offset de reloj
  sincronizado al entrar); el servidor compara con el instante teórico del ciclo actual.
- **Anti-trampa:** el servidor genera el patrón de fases (seed por sesión), no el cliente; el
  cliente solo recibe el estado "ahora pulsa".
- **Ejemplo:** el reloj astronómico: pulsar cuando la aguja cruza la constelación, 3 veces, cada
  vez más rápido.

### A5. `matchsticks` — Palillos / coincidencias · `<MatchstickPuzzle>`

```typescript
interface MatchstickPuzzleDefinition extends PuzzleDefinition {
  type: 'matchsticks';
  equation: MatchstickElement[];  // dígitos seven-segment + operadores
  moveCount: number;
  goal: 'correct_equation' | 'target_value';
  targetValue?: string;
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** el cliente envía la configuración final; el servidor evalúa la ecuación
  (parser de enteros y operadores `+ - × ÷`). Para `correct_equation` comprueba igualdad; para
  `target_value` evalúa el lado izquierdo. Además comprueba que la configuración es **alcanzable
  con `moveCount` movimientos** (hash contra permutaciones ≤ `moveCount` precomputadas en el editor).
- **Ejemplo:** "VI + IV = X" en antorchas — mover una para corregir.

### A6. `word_search` — Palabra oculta / sopa de letras · `<WordSearchPuzzle>`

```typescript
interface WordSearchDefinition extends PuzzleDefinition {
  type: 'word_search';
  grid: { cols: number; rows: number };
  words: string[];                // objetivo (solo servidor)
  filler: 'random' | 'themed';
  decoyWords: string[];
  case: 'upper' | 'lower';
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** el servidor genera la cuadrícula (objetivos + señuelos + relleno) **por sesión**
  y solo revela las letras. El cliente marca selección → `selection {cells}` → el servidor dice si
  forma una palabra objetivo. `solved` cuando todas las objetivas están encontradas. Las palabras
  objetivo no se listan en el cliente (se descubren narrativamente).
- **Ejemplo:** inscripciones de la tumba: encontrar los 4 nombres de los caballeros traidores
  entre decenas de nombres falsos.

### A7. `circuit_board` — Circuito · `<CircuitPuzzle>`

```typescript
interface CircuitPuzzleDefinition extends PuzzleDefinition {
  type: 'circuit_board';
  grid: { cols: number; rows: number };
  cellTypes: CircuitCellType[];   // cable, resistencia, interruptor, fuente, bombilla, cruce
  sourceCell: { x: number; y: number };
  targetCells: { x: number; y: number }[];
  blockedCells?: { x: number; y: number; opensWithItem?: string }[];
  needAllSwitches?: boolean;
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** flood fill de corriente desde `sourceCell` respetando direccionalidad de cada
  celda (los cables tienen entradas/salidas por rotación). `solved` cuando **todas** las
  `targetCells` reciben corriente. Acepta múltiples soluciones. Regla extra: `needAllSwitches`.
- **Ejemplo:** el panel eléctrico del mago: encender las 3 bombillas para revelar el código.

---

## Parte B — Puzzles cooperativos (fuerzan 2+)

### B1. `relay_activation` — Relé de activación · *world (Phaser) + panel mínimo (React)*

```typescript
interface RelayActivationDefinition extends PuzzleDefinition {
  type: 'relay_activation';
  activator: { objectId: string };                 // palanca que sostiene A
  gate: { objectId: string; holdSec: number };     // puerta abierta X seg
  chainObjects?: { objectId: string; position: RelayPoint }[];
  soloBridgeItemId?: string;                       // objeto que mantiene la palanca
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** A interactúa con la palanca → el servidor abre la puerta e inicia `holdSec`. Si
  la puerta se cierra antes de que B la atraviese (`on_enter_room`/zona), el intento falla. Con
  `chainObjects`, el relé es en cadena; `soloBridgeItemId` mantiene la palanca activada sin jugador.
- **Ejemplo (catacumbas v2):** el puente levadizo: un caballero sostiene la cadena mientras los
  otros cruzan.

### B2. `mirror_copy` — Simetría · *panel (React), uno por jugador*

```typescript
interface MirrorCopyDefinition extends PuzzleDefinition {
  type: 'mirror_copy';
  pattern: PatternCell[];         // patrón del líder (solo servidor lo conoce entero)
  gridSize: { cols: number; rows: number };
  showDurationSec: number;
  communicationOnly: boolean;     // true = el copiador no ve nada del original
  soloBridgeItemId?: string;      // espejo que proyecta el patrón (modo solitario)
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** el servidor asigna roles (líder/copista). El líder ve `pattern` durante
  `showDurationSec`; luego solo el copista edita su rejilla. El servidor compara la rejilla del
  copista contra `pattern` al confirmar. Con `communicationOnly`, el copista ve su rejilla vacía
  permanentemente — toda la comunicación es por voz/chat. El panel nunca muestra ambas rejillas a
  un mismo jugador.
- **Ejemplo:** los vitrales gemelos.

### B3. `split_clue_multi` — Información dividida expandida · *híbrido*

```typescript
interface SplitClueMultiDefinition extends PuzzleDefinition {
  type: 'split_clue_multi';
  viewpoints: ViewpointConfig[];  // 3+ mirillas/zonas
  fragments: string[];
  assignment: 'fixed' | 'rotating';
  soloBridgeItemId?: string;
  inputUI: 'symbols' | 'code';
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** el servidor decide qué fragmentos ve cada jugador según su zona (generaliza
  `split_clue` a N). Con `rotating`, los fragmentos rotan cada X segundos. La respuesta combinada
  se introduce en el panel React y se valida como código.
- **Ejemplo:** la torre de los cuatro vientos: 4 ventanas, cada una muestra una letra del nombre
  del viento prohibido; rotan cada 15 s.

### B4. `team_split` — Desafío por equipos · *panel (React) ×2 + Phaser (caja central)*

```typescript
interface TeamSplitDefinition extends PuzzleDefinition {
  type: 'team_split';
  teamPuzzles: { teamA: PuzzleDefinition; teamB: PuzzleDefinition };
  centralObjectId: string;        // abre solo cuando AMBOS resolvieron
  windowSec?: number;             // ambas soluciones dentro de la ventana
  teamsAutoAssign: boolean;
  spyAllowed?: boolean;
}
```

- **Estados:** `solved_A`, `solved_B` internos; agregado `locked → available → in_progress → solved`.
- **Validación:** los sub-puzzles se resuelven de forma independiente y el servidor lleva la
  cuenta. La caja central pasa a `available` cuando ambos están en `solved`; con `windowSec`,
  ambos `solved` dentro de la ventana (reloj del servidor). Un equipo puede ver el estado del
  otro solo si `spyAllowed`.
- **Ejemplo (eventos B2B ideales):** 5 contra 5; cada mitad resuelve su mitad del plano; la caja
  del tesoro abre con ambas.

---

## Parte C — Puzzles de mundo (Phaser, estado sincronizado)

### C1. `light_mirrors` — Luz y espejos · *world (Phaser)*

```typescript
interface LightMirrorsDefinition extends PuzzleDefinition {
  type: 'light_mirrors';
  grid: { cols: number; rows: number };
  emitterCell: { x: number; y: number; direction: 'N' | 'S' | 'E' | 'W' };
  mirrors: { cell: { x: number; y: number }; orientations: 2 | 4 }[];
  targetCell: { x: number; y: number };
  obstacles?: { x: number; y: number }[];
  prisms?: { x: number; y: number; splits: ('N' | 'S' | 'E' | 'W')[] }[];
  solution?: MirrorOrientation[];   // solo servidor
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** trazado de rayo por pasos (BFS de direcciones): en cada celda aplica la regla
  del elemento (espejo refleja, obstáculo absorbe, prisma divide). `solved` cuando alcanza
  `targetCell`. El cliente envía solo rotaciones; el servidor recalcula y devuelve el trazado.
  **Múltiples soluciones válidas** → validación por simulación.
- **Ejemplo (catacumbas):** dirigir la luz del sol por un pozo con espejos hasta el relicario;
  cada rotación se ve en tiempo real por todos.

### C2. `multi_lock` — Caja fuerte multi-cerradura · *world (Phaser) + sub-puzzles panel*

```typescript
interface MultiLockDefinition extends PuzzleDefinition {
  type: 'multi_lock';
  locks: { puzzleId: string }[];  // referencias a otros puzzles
  openWindowSec?: number;
  orderMatters: boolean;
  fullReset?: boolean;
  soloBridgeItemId?: string;      // llave maestra que sustituye a una cerradura
}
```

- **Estados:** `locked → available → in_progress (n/M) → solved`; por cerradura:
  `engaged/released`.
- **Validación:** escucha los eventos `solved` de cada `locks[i].puzzleId`. Si `orderMatters`,
  valida la secuencia. Cuando todas liberadas → abierta. Con `openWindowSec`, si pasa el tiempo
  sin completar la acción, las cerraduras se rearman (por defecto las ya resueltas quedan en
  `released`; `fullReset: true` las revierte).
- **Ejemplo:** el relicario v2: tres cerraduras (candado + espejos + engranajes) abiertas en
  ventana de 60 s.

### C3. `gear_mechanism` — Engranajes · *world (Phaser)*

```typescript
interface GearPuzzleDefinition extends PuzzleDefinition {
  type: 'gear_mechanism';
  gears: { id: string; cell: { x: number; y: number }; teeth: number; initialRotation: number; locked?: boolean }[];
  driveGearId: string;
  targetRotations: Record<string, number>;  // solo servidor
  mechanismObjectId: string;
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación:** grafo de engranajes (adyacentes transmiten rotación:
  `rotation_b = -rotation_a × teeth_a / teeth_b`). El servidor calcula el estado completo a
  partir de las rotaciones manuales y valida contra `targetRotations` (tolerancia de cuarto de
  vuelta: 4 posiciones discretas por engranaje). El cliente envía `rotate(gearId, quarterTurns)`.
- **Ejemplo:** el reloj de la torre: alinear las agujas hasta la hora de la traición (medianoche).

### C4. `rising_water` — Agua que sube · *world (Phaser) + motor de reglas*

```typescript
interface RisingWaterDefinition extends PuzzleDefinition {
  type: 'rising_water';
  waterLevels: { height: number; timeSec: number }[];
  levelObjectStates: Record<string, unknown>[];   // objetos/estados por nivel
  drains: { puzzleId: string }[];
  lethalLevel?: number;
}
```

- **Estados:** `locked → available → in_progress (nivel n, subiendo) → solved` (vía drenaje) o
  `failed` (agua letal / tiempo agotado).
- **Validación:** implementado sobre el motor de reglas: el agua es un `start_timer` encadenado
  por niveles; cada nivel dispara reglas que cambian estados de objetos y desbloquea `drains`. Los
  drenajes son puzzles normales referenciados: al resolverse, `pause_timer`/`stop_timer`. El
  estado (`currentLevel`, `paused`) viaja en `GameState.timers`; Phaser interpola la animación.
- **Ejemplo (v2 del Rey Aldric):** las catacumbas se inundan: +1 nivel cada 5 min; en el nivel 2
  se apagan las antorchas; el drenaje requiere resolver las tuberías antes del nivel 4.

---

## Notas de implementación transversales

1. **Patrón sub-puzzle:** B4 y C2 **referencian otras plantillas** (`locks[]`, `teamPuzzles`). El
   validador comprueba referencias cruzadas (cerradura que referencia un puzzle inexistente = error).
2. **Simuladores en servidor:** C1 y C3 requieren simulación por pasos; A5 precomputa
   permutaciones. Estos simuladores viven en `packages/shared/simulators` y se reutilizan en
   runtime, validador del editor y MCP (el agente puede preguntar `is_solvable`).
3. **Estado `failed`:** en A2, A4 y C4 puede ser final o recuperable (`failed → available` tras
   cooldown), configurable por plantilla (`failBehavior: 'permanent' | 'cooldown'`).
4. **Firma común de componentes React:** `{ definition, runtime, onSubmit, state }` — ver
   `specs/09-editor-de-salas.md`.
5. **Prioridad de construcción sugerida (post-MVP):** A7 (circuito, reutiliza flood fill de
   tuberías) → C1 (luz y espejos, el más espectacular) → B4 (ideal para el caso B2B) → resto.

## Dependencias

- `reference/catalogo-plantillas.md` — comparativa de las 23 plantillas.
- `specs/08-formato-roompackage.md` — cómo se serializan estas definiciones.
