# EscapeRoom Creator — Plantillas de puzzle v2 (especificación completa)

Nivel de detalle idéntico a las 8 plantillas del MVP (ver Especificaciones v1.0, sección 8). Todas comparten la interfaz base:

```typescript
interface PuzzleDefinition {
  id: string;
  type: PuzzleType;
  layer: 'world' | 'panel';
  roomId: string;
  position?: { x: number; y: number };
  requiresSolved: string[];
  grantsItems: string[];
  unlocks: string[];
  timeLimitSec?: number;
}

type PuzzleState = 'locked' | 'available' | 'in_progress' | 'solved' | 'failed';
```

Reglas comunes a todas: la validación ocurre **siempre en el servidor**; el cliente nunca conoce la solución; `soloBridgeItemId` permite modo solitario en mecánicas cooperativas; cada puzzle dispara `solved` → reglas del motor (grantsItems, unlocks).

---

## PARTE A — Puzzles individuales (panel React)

### A1. 🎵 Secuencia musical (`sequence_music`)

**Capa:** panel (React). **Componente:** `<SequencePuzzle>`.

```typescript
interface SequenceMusicDefinition extends PuzzleDefinition {
  type: 'sequence_music';
  notes: NoteConfig[];            // campana, telas, botones... con nota asociada
  melody: string[];               // ej: ["do","mi","mi","sol"] — solo en servidor
  listenAllowed: number;          // cuántas veces puede escuchar la melodía
  playbackSpeed: number;          // bpm
  wrongResets: boolean;           // si fallar reinicia la secuencia introducida
}
```

**Estados:** `locked → available → in_progress → solved`. Contador de `listenUsed` en runtime.

**Validación en servidor:** el cliente envía la secuencia introducida array completo al confirmar; el servidor compara con `melody`. Si `wrongResets`, cualquier error parcial reinicia el input (el servidor lo hace: el cliente solo ve "error"). Las notas se reproducen con WebAudio desde samples de la biblioteca; la melodía objetivo **jamás viaja al cliente** — el servidor la reproduce "remotamente" (el servidor emite eventos de reproducción con timing, no la secuencia en sí; los samples se reproducen en cliente sobre eventos).

**Ejemplo (bodega encantada v2):** 5 copas de cristal; la melodía suena al tocar el cuerno; reproducirla con las copas.

---

### A2. ⚖️ Pesas y balanza (`balance_scale`)

**Capa:** panel (React). **Componente:** `<BalancePuzzle>`.

```typescript
interface BalanceScaleDefinition extends PuzzleDefinition {
  type: 'balance_scale';
  weights: WeightConfig[];        // objetos con peso oculto: {id, sprite, label?}
  targetLeft: string[];           // solución: ids que van al platillo izquierdo
  targetRight: string[];
  weighingsLimit?: number;        // máx. pesadas permitidas (dificultad)
  tolerance: number;              // normalmente 0; >0 para soluciones alternativas
}
```

**Estados:** `locked → available → in_progress → solved` (o `failed` si agota `weighingsLimit`).

**Validación en servidor:** cada "pesada" envía `left: [ids], right: [ids]` → servidor responde `-1 | 0 | 1` (más pesado izquierda / equilibrio / derecha) **sin revelar los pesos**. La solución se valida al confirmar. Con `weighingsLimit`, el servidor cuenta pesadas; agotarlas sin resolver → `failed` (o bloqueo temporal, según config).

**Anti-trampa:** los pesos reales (`WeightConfig.weight`) viven solo en el servidor.

**Ejemplo:** 6 runas de pesos desconocidos; equilibrar la balanza del alquimista con 3 a cada lado en máximo 4 pesadas.

---

### A3. 🔣 Sudoku de símbolos (`symbol_sudoku`)

**Capa:** panel (React). **Componente:** `<SudokuPuzzle>`.

```typescript
interface SymbolSudokuDefinition extends PuzzleDefinition {
  type: 'symbol_sudoku';
  gridSize: 4 | 6 | 9;            // 4x4 y 6x6 recomendados para escape rooms
  symbols: string[];              // ["dragón","corona","espada","escudo"]
  givens: CellValue[];            // celdas pre-rellenadas {x,y,symbol}
  solution: CellValue[];          // solo servidor
  regions?: Region[];             // si no, regiones cuadradas estándar
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** dos modos:
- `checkOnSubmit`: el cliente envía la rejilla completa → comparación exacta.
- `checkCell`: validación por celda bajo petición (consume una "comprobación" si `checksLimit` se define).
El servidor también valida **reglas de sudoku en cada envío** (duplicados en fila/columna/región) para dar feedback de error sin revelar la solución.

**Ejemplo:** sudoku 4×4 en los vitrales de la catedral; los símbolos son los de los cuatro reinos.

---

### A4. ⚡ Reflejos / timing (`timing_press`)

**Capa:** panel (React). **Componente:** `<TimingPuzzle>`.

```typescript
interface TimingPressDefinition extends PuzzleDefinition {
  type: 'timing_press';
  rounds: number;                 // nº de pulsaciones acertadas requeridas
  windowMs: number;               // tolerancia temporal del acierto
  speedRamp: number;              // factor de aceleración por ronda (1 = constante)
  markerPath: 'linear' | 'circle';// luz que cruza o aguja que gira
}
```

**Estados:** `locked → available → in_progress → solved` (o `failed` tras N errores si `maxMisses` se define).

**Validación en servidor:** el cliente envía `pressAt` (timestamp de cliente, corregido con offset de reloj sincronizado al entrar en la sala). El servidor compara con el instante teórico del ciclo actual. **Importante:** el servidor genera el patrón de fases (con seed por sesión), no el cliente — así no se puede leer el patrón inspeccionando el binario. El cliente recibe solo el estado actual "ahora pulsa".

**Ejemplo:** el mecanismo del reloj astronómico: pulsar cuando la aguja cruza la constelación, 3 veces seguidas, cada vez más rápido.

---

### A5. 🥢 Palillos / coincidencias (`matchsticks`)

**Capa:** panel (React). **Componente:** `<MatchstickPuzzle>`.

```typescript
interface MatchstickPuzzleDefinition extends PuzzleDefinition {
  type: 'matchsticks';
  equation: MatchstickElement[];  // elementos: dígitos en seven-segment + operadores
  moveCount: number;              // cuántos palillos se pueden mover
  goal: 'correct_equation' | 'target_value';  // corregir la igualdad o llegar a un valor
  targetValue?: string;
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** el cliente envía la configuración final de segmentos; el servidor evalúa la ecuación (parser simple de enteros y operadores soportados: +, -, ×, ÷). Para `correct_equation`, comprueba igualdad; para `target_value`, evalúa el lado izquierdo. El servidor también valida que la configuración es alcanzable con `moveCount` movimientos desde el estado inicial (hash comparado contra todas las permutaciones ≤ moveCount precomputadas en el editor).

**Ejemplo:** "VI + IV = X" en números romanos de antorchas — mover una antorcha para corregir.

---

### A6. 🔤 Palabra oculta / sopa de letras (`word_search`)

**Capa:** panel (React). **Componente:** `<WordSearchPuzzle>`.

```typescript
interface WordSearchDefinition extends PuzzleDefinition {
  type: 'word_search';
  grid: { cols: number; rows: number };
  words: string[];                // objetivo (solo servidor)
  filler: 'random' | 'themed';    // relleno temático medieval/scifi
  decoyWords: string[];           // palabras falsas que también aparecen
  case: 'upper' | 'lower';
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** el servidor genera la cuadrícula (colocación de objetivos + señuelos + relleno) **por sesión** y solo revela las letras. El cliente marca selección de celdas → `selection {cells}` → servidor responde si forma una palabra objetivo. `solved` cuando todas las objetivas están encontradas. Las palabras objetivo no se listan en el cliente (se descubren narrativamente: "encuentra los nombres de los traidores").

**Ejemplo:** inscripciones de la tumba: encontrar los 4 nombres de los caballeros traidores entre decenas de nombres falsos.

---

### A7. 🔌 Circuito (`circuit_board`)

**Capa:** panel (React). **Componente:** `<CircuitPuzzle>`.

```typescript
interface CircuitPuzzleDefinition extends PuzzleDefinition {
  type: 'circuit_board';
  grid: { cols: number; rows: number };
  cellTypes: CircuitCellType[];   // cable, resistencia, interruptor, fuente, bombilla, cruce
  sourceCell: { x, y };
  targetCells: { x, y }[];        // una o varias bombillas a encender
  blockedCells?: { x, y, opensWithItem?: string }[];
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** flood-fill de corriente desde `sourceCell` respetando direccionalidad de cada celda (los cables tienen entradas/salidas por rotación). `solved` cuando **todas** las `targetCells` reciben corriente. Acepta múltiples soluciones (no compara contra solución única). Regla extra configurable: `needAllSwitches: true` (los interruptores deben estar activados).

**Ejemplo:** el panel eléctrico del laboratorio del mago: encender las 3 bombillas para revelar el código.

---

## PARTE B — Puzzles cooperativos (forzan 2+ jugadores)

### B1. 🏃 Relé de activación (`relay_activation`)

**Capa:** world (Phaser) + panel mínimo (React, estado del temporizador).

```typescript
interface RelayActivationDefinition extends PuzzleDefinition {
  type: 'relay_activation';
  activator: { objectId: string };        // palanca/botón que sostiene A
  gate: { objectId: string; holdSec: number };  // puerta que permanece abierta X seg.
  chainObjects?: { objectId: string; position: RelayPoint }[]; // puntos intermedios
  soloBridgeItemId?: string;              // objeto que mantiene la palanca fija
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** jugador A interactúa con la palanca → el servidor abre la puerta e inicia `holdSec`. Si la puerta se cierra antes de que B la atraviese (evento `on_enter_room`/`zone` del otro lado), el intento falla y debe repetirse. Con `chainObjects`, el relé es en cadena (A sostiene, B activa el punto intermedio, C llega al final). `soloBridgeItemId` mantiene la palanca activada sin jugador.

**Ejemplo (catacumbas v2):** el puente levadizo: un caballero sostiene la cadena mientras los otros cruzan.

---

### B2. 🪞 Simetría (`mirror_copy`)

**Capa:** panel (React), uno por jugador.

```typescript
interface MirrorCopyDefinition extends PuzzleDefinition {
  type: 'mirror_copy';
  pattern: PatternCell[];         // patrón del "líder" (solo servidor lo conoce entero)
  gridSize: { cols, rows };
  showDurationSec: number;        // cuánto ve el líder el patrón inicial
  communicationOnly: boolean;     // true = el copiador no puede ver nada del original
  soloBridgeItemId?: string;      // un espejo que proyecta el patrón (modo solitario)
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** el servidor asigna roles (líder/copista). El líder ve `pattern` durante `showDurationSec`; luego solo el copista puede editar su rejilla. El servidor compara la rejilla del copista contra `pattern` al confirmar. Con `communicationOnly: true`, el copista ve su rejilla vacía permanentemente — toda la comunicación es por voz/chat (los jugadores describen). El panel nunca muestra ambas rejillas a la vez a un mismo jugador.

**Ejemplo:** los vitrales gemelos: uno mira el vitral original, el otro debe replicarlo en el vitral vacío describiéndose por voz.

---

### B3. 🧩 Información dividida expandida (`split_clue_multi`)

**Capa:** híbrido (Phaser: occlusión y visión; React: entrada de respuesta).

```typescript
interface SplitClueMultiDefinition extends PuzzleDefinition {
  type: 'split_clue_multi';
  viewpoints: ViewpointConfig[];  // 3+ mirillas/zonas de visión
  fragments: string[];            // orden final de la solución
  assignment: 'fixed' | 'rotating'; // fija por posición o rota entre jugadores
  soloBridgeItemId?: string;      // artefacto que revela fragmentos extra
  inputUI: 'symbols' | 'code';
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** el servidor decide qué `fragments` ve cada jugador según la zona/avatar (igual que `split_clue` del MVP, generalizado a N). Con `assignment: 'rotating'`, los fragmentos rotan cada X segundos para forzar comunicación continua. La respuesta combinada se introduce en el panel React y se valida como código.

**Ejemplo:** la torre de los cuatro vientos: 4 ventanas, cada una muestra una letra del nombre del viento prohibido; rotan cada 15 segundos.

---

### B4. ⚔️ Desafío por equipos (`team_split`)

**Capa:** panel (React), un panel por equipo, + Phaser para la caja central.

```typescript
interface TeamSplitDefinition extends PuzzleDefinition {
  type: 'team_split';
  teamPuzzles: { teamA: PuzzleDefinition; teamB: PuzzleDefinition }; // referencias a puzzles normales
  centralObjectId: string;        // caja/puerta que abre solo cuando AMBOS resolvieron
  windowSec?: number;             // si se define: ambas soluciones deben ocurrir dentro de la ventana
  teamsAutoAssign: boolean;       // la plataforma equilibra; si no, el organizador asigna
}
```

**Estados:** `locked → available → in_progress → solved` (estado agregado: `solved_A`, `solved_B` internos).

**Validación en servidor:** los sub-puzzles (A1–A8 del catálogo) se resuelven de forma independiente y el servidor lleva la cuenta. La caja central pasa a `available` cuando ambos están en `solved`; si hay `windowSec`, ambos `solved` deben estar dentro de la ventana (reloj del servidor). Un equipo puede inspeccionar el estado del otro solo si `spyAllowed` (opcional, añade presión).

**Ejemplo (eventos B2B ideales):** 10 empleados, 5 contra 5: cada mitad resuelve su mitad del plano del castillo; la caja del tesoro solo abre con ambas mitades.

---

## PARTE C — Puzzles de mundo (Phaser, estado sincronizado)

### C1. 🔦 Luz y espejos (`light_mirrors`)

**Capa:** world (Phaser). Mecánica híbrida: el rayo se renderiza en Phaser; la conectividad la calcula el servidor.

```typescript
interface LightMirrorsDefinition extends PuzzleDefinition {
  type: 'light_mirrors';
  grid: { cols, rows };
  emitterCell: { x, y; direction: 'N'|'S'|'E'|'W' };
  mirrors: MirrorConfig[];        // celdas con espejo giratorio: {cell, orientations: 2|4}
  targetCell: { x, y };
  obstacles?: { x, y }[];         // bloquean la luz
  prisms?: { x, y; splits: ('N'|'S'|'E'|'W')[] }[]; // v2.1: dividen el rayo
  solution?: MirrorOrientation[]; // solo servidor
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** trazado de rayo por pasos (BFS de direcciones): desde el emisor, en cada celda aplica la regla del elemento (espejo refleja según orientación, obstáculo absorbe, prisma divide). `solved` cuando el rayo alcanza `targetCell`. El cliente envía solo rotaciones de espejo; el servidor recalcula y devuelve el trazado (que el cliente renderiza como haz de luz). **Múltiples soluciones válidas** → validación por simulación, no por comparación.

**Ejemplo (catacumbas):** dirigir la luz del sol por un pozo con espejos hasta el relicario; cada rotación se ve en tiempo real por todos.

---

### C2. 🔐 Caja fuerte multi-cerradura (`multi_lock`)

**Capa:** world (Phaser para la caja; los sub-puzzles pueden ser panel).

```typescript
interface MultiLockDefinition extends PuzzleDefinition {
  type: 'multi_lock';
  locks: LockRef[];               // referencias a otros puzzles (ids) que actúan de cerraduras
  openWindowSec?: number;         // tras abrirse, cuánto tarda en "resetear"
  orderMatters: boolean;          // si las cerraduras deben activarse en orden
  soloBridgeItemId?: string;      // llave maestra que sustituye a una cerradura
}
```

**Estados:** `locked → available → in_progress (n/M cerraduras) → solved`. Estado por cerradura: `engaged/released`.

**Validación en servidor:** escucha los eventos `solved` de cada `locks[i].puzzleId`. Si `orderMatters`, valida la secuencia. Cuando todas liberadas → caja abierta. Con `openWindowSec`, si pasa el tiempo sin completar el contenido (recoger el objeto dentro), las cerraduras se rearman (las cerraduras ya resueltas **no** se revierten: quedan en `released`, solo hay que re-activar las pendientes — ajustable vía `fullReset: true`).

**Ejemplo:** el relicario del Rey Aldric v2: tres cerraduras (candado numérico + espejos + engranajes) que deben abrirse en ventana de 60 segundos.

---

### C3. ⚙️ Engranajes (`gear_mechanism`)

**Capa:** world (Phaser).

```typescript
interface GearPuzzleDefinition extends PuzzleDefinition {
  type: 'gear_mechanism';
  gears: GearConfig[];            // {id, cell, teeth, initialRotation, locked?: boolean}
  driveGearId: string;            // el engranaje motor (giro constante)
  targetRotations: Map<string, number>;  // orientación objetivo por engranaje (solo servidor)
  mechanismObjectId: string;      // objeto que se activa (puente, puerta, reloj)
}
```

**Estados:** `locked → available → in_progress → solved`.

**Validación en servidor:** grafo de engranajes (engranajes adyacentes en el grid transmiten rotación: `rotation_b = -rotation_a × teeth_a / teeth_b`). El servidor calcula el estado de rotación completo a partir de las rotaciones manuales y valida contra `targetRotations` (con tolerancia de cuarto de vuelta: 4 posiciones discretas por engranaje). El cliente envía `rotate(gearId, quarterTurns)`; el servidor responde con el estado calculado de todo el mecanismo → Phaser anima el giro en cadena.

**Ejemplo:** el reloj de la torre: alinear las agujas moviendo engranajes intermedios hasta que marquen la hora de la traición (medianoche).

---

### C4. 🌊 Agua que sube (`rising_water`)

**Capa:** world (Phaser renderiza el agua; la lógica es 100% del motor de reglas + timers).

```typescript
interface RisingWaterDefinition extends PuzzleDefinition {
  type: 'rising_water';
  waterLevels: WaterLevel[];      // niveles con altura y tiempo para alcanzarlo
  levelObjectStates: LevelStateMap[];  // qué objetos/estados aparecen o se bloquean por nivel
  drains: DrainConfig[];          // mecanismos (puzzles) que frenan/paran el agua
  lethalLevel?: number;           // nivel que termina la partida (o temporizador global)
}
```

**Estados:** `locked → available → in_progress (nivel n, subiendo) → solved` (vía drenaje) o `failed` (agua letal / tiempo agotado).

**Validación en servidor:** implementado sobre el **motor de reglas** (punto 1 del plan): el agua es un `start_timer` encadenado por niveles; cada `waterLevels[i]` dispara reglas que cambian estados de objetos (`set_object_state` a altura de agua) y desbloquea `drains`. Los drenajes son puzzles normales referenciados: al resolverse, `pause_timer`/`stop_timer`. El estado del agua (`currentLevel`, `paused`) viaja en `GameState.timers` → Phaser interpola la animación del agua entre niveles.

**Ejemplo (v2 del Rey Aldric):** las catacumbas se inundan: el agua sube un nivel cada 5 minutos; en el nivel 2 se apagan las antorchas (más oscuridad); el drenaje requiere resolver las tuberías antes del nivel 4.

---

## Resumen comparativo

| # | Plantilla | Capa | Validación servidor | Multi-solución |
|---|---|---|---|---|
| A1 | Secuencia musical | React | Comparación de secuencia | ❌ |
| A2 | Pesas y balanza | React | Pesos secretos + comparación final | ❌ |
| A3 | Sudoku de símbolos | React | Comparación / reglas parciales | ❌ |
| A4 | Reflejos / timing | React | Timestamp corregido + patrón server-seeded | ❌ |
| A5 | Palillos | React | Parser de ecuación + alcanzabilidad | ✅ (parcial) |
| A6 | Sopa de letras | React | Generación por sesión, comparación de selección | ✅ (muchas) |
| A7 | Circuito | React | Flood-fill eléctrico | ✅ |
| B1 | Relé de activación | Phaser + React | Ventana temporal de puerta | — |
| B2 | Simetría | React ×2 roles | Comparación de rejilla por rol | ❌ |
| B3 | Info dividida N | Híbrido | Visión por jugador + código | ❌ |
| B4 | Desafío por equipos | React ×2 + Phaser | Agregación de sub-puzzles | — |
| C1 | Luz y espejos | Phaser | Simulación de rayo (BFS) | ✅ |
| C2 | Multi-cerradura | Phaser | Secuencia + ventana | — |
| C3 | Engranajes | Phaser | Grafo de rotaciones | ❌ |
| C4 | Agua que sube | Phaser + reglas | Timers del motor de reglas | — |

## Notas de implementación transversales

1. **Sub-puzzle pattern:** B4 y C2 confirman que las plantillas deben poder **referenciar otras plantillas** (`locks: LockRef[]`, `teamPuzzles`). En el editor, el validador comprueba referencias cruzadas (una cerradura que referencia un puzzle inexistente = error).
2. **Simuladores en servidor:** C1 y C3 requieren simulación por pasos; A5 requiere precomputación de permutaciones. Estos simuladores viven en `packages/shared` y se reutilizan en: runtime (servidor), editor (validador: "¿tiene esta sala solución?") y MCP (el agente puede preguntar `is_solvable`).
3. **Estado `failed`:** en A2, A4, B? y C4 el estado `failed` puede ser final (puzzle inservible) o recuperable (`failed → available` tras cooldown). Configurable por plantilla (`failBehavior: 'permanent' | 'cooldown'`).
4. **Componentes React compartidos:** todos los paneles siguen la misma firma: `<XProps = { definition: XDefinition; runtime: XRuntime; onSubmit: (attempt) => void; state: PuzzleState }>`.
5. **Prioridad de construcción sugerida (post-MVP):** A7 (circuito, reutiliza flood-fill de tuberías) → C1 (luz y espejos, el más espectacular) → B4 (ideal para el caso de uso B2B) → resto.
