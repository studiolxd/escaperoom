# 06 — Plantillas de puzzle (MVP)

Depende de `03-arquitectura-y-stack.md` (§3, capa Phaser/React) y `05-motor-de-reglas-y-estado.md`.
El catálogo comparativo con las v2 está en `reference/catalogo-plantillas.md`.

---

## 1. Base común de todas las plantillas

```typescript
interface PuzzleDefinition {
  id: string;                    // "sala1-arca-candado" (IDs legibles)
  type: PuzzleType;
  layer: 'world' | 'panel';      // Phaser o React
  roomId: string;
  position?: { x: number; y: number };   // solo si layer === 'world'
  requiresSolved: string[];      // puzzles que deben resolverse antes (encadenamiento)
  grantsItems: string[];         // objetos que da al resolverse
  unlocks: string[];             // puertas/mecanismos que abre
  timeLimitSec?: number;         // opcional
}

type PuzzleState = 'locked' | 'available' | 'in_progress' | 'solved' | 'failed';
```

- **`locked`**: existe pero no es interactivo aún (algún `requiresSolved` pendiente).
- **`available`**: interactivo.
- **`in_progress`**: alguien lo está intentando (informativo).
- **`solved`**: resuelto (inmutable, con timestamp y autor).
- **`failed`**: agotó intentos/tiempo (si aplica; recuperable según plantilla).

En el estado sincronizado de la room, cada puzzle ocupa solo su instancia mínima:

```typescript
// Estado sincronizado (room state — pequeño, va por la red)
puzzles: MapSchema<PuzzleRuntime>   // { state, solvedBy?, solvedAt?, attempts }
```

**Flujo de verificación siempre igual:** el jugador interactúa → el cliente envía `attempt` →
**el servidor valida** → muta `PuzzleRuntime` → todos los clientes reaccionan (animación en
Phaser / cierre de panel en React). El cliente nunca marca `solved`.

**Modo solitario:** cada mecánica cooperativa admite `soloBridgeItemId`, un objeto que sustituye
a un jugador, evitando código especial en la lógica cooperativa.

---

## 2. Las 8 plantillas del MVP

### 1. `hidden_key` — Llave escondida · *world (Phaser)*

```typescript
interface HiddenKeyDefinition extends PuzzleDefinition {
  type: 'hidden_key';
  hidingSpot: { objectId?: string; x?: number; y?: number; sprite: string };
  revealAnimation: 'slide' | 'fade' | 'shake';
  keyItemId: string;                 // qué objeto entrega ("llave-bronce")
}
```

- **Estados:** `locked → available → (click en el spot) → solved`. Sin `in_progress` (instantáneo).
- **Dificultad puramente escenográfica:** el sprite de cobertura (cuadro, alfombra, barril).
- **En Phaser:** el spot es un objeto interactuable invisible hasta que el cursor se acerca
  (radio de proximidad o brillo sutil). Al click → animación de reveal → evento al servidor.
- **Servidor:** valida que el click sea sobre un escondite válido → otorga `keyItemId`.

### 2. `code_lock` — Código numérico · *panel (React)*

```typescript
interface CodeLockDefinition extends PuzzleDefinition {
  type: 'code_lock';
  length: number;                    // 4–6 dígitos
  code: string;                      // "4732" (solo en servidor, jamás en el cliente)
  maxAttempts?: number;
  lockoutSec?: number;
  hints: string[];                   // ids de HintDef
}
```

- **Estados:** `locked → available → in_progress → solved` (o `failed` si agota intentos).
- **Componente:** `<CodeLockPuzzle length={4} maxAttempts={5} />`. Renderiza casillas y envía
  `attempt("4732")`; **nunca conoce el código**. El servidor responde
  `correct | wrong | locked_out(30s)`.
- **Anti-trampa:** el código vive solo en la definición de servidor; inspeccionar el cliente no
  lo revela.
- **Variante símbolos:** misma plantilla con alfabeto de símbolos (`inputUI`), usada por la pista
  dividida.

### 3. `simultaneous_plates` — Botones simultáneos · *world (Phaser)*

```typescript
interface SimultaneousPlatesDefinition extends PuzzleDefinition {
  type: 'simultaneous_plates';
  plates: { objectId: string; x: number; y: number }[];
  windowMs: number;                  // tolerancia (p. ej. 800 ms)
  soloBridgeItemId?: string;         // objeto que fija una placa (el cáliz real)
  holdMode: 'press' | 'stand';       // pulsar vs. mantenerse encima
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Lógica en servidor:** cada `plate_activated`/`plate_deactivated` llega con timestamp; el
  servidor comprueba que **todas las placas están activas dentro de `windowMs`**.
- Con `soloBridgeItemId`, una placa puede quedar permanentemente activa colocando el objeto →
  modo solitario sin código especial.
- **En Phaser:** placas como sprites con estados visuales (hundida / con luz); el avatar se para
  encima → evento continuo.

### 4. `combine_items` — Combinar objetos · *panel (React, sobre el inventario)*

```typescript
interface CombineItemsDefinition extends PuzzleDefinition {
  type: 'combine_items';
  recipes: Recipe[];                  // el puzzle ES el conjunto de recetas descubribles
}
interface Recipe {
  inputs: string[];                   // ["yesquero", "vela"]
  output: string;                     // "antorcha"
  consumeInputs: boolean;             // si los ingredientes desaparecen
  description?: string;               // p. ej. "Inspeccionar: una llave dentro de otra"
}
```

- **Sin estado propio:** cada receta es una micro-transacción. El servidor valida posesión de
  inputs → emite `items_consumed + item_granted`.
- Las recetas pueden ser conocidas (el jugador las prueba) o reveladas por pistas.
- **Componente:** `<InventoryPanel>` con drag & drop → al soltar dos objetos → `combine(a, b)` →
  servidor responde resultado o `invalid_combination`.
- Patrón de inspección: `consumeInputs: false` convierte `llave-plata → llave-oro` en "examinar".

### 5. `sliding_puzzle` — Puzle deslizante · *panel (React), opción mural en world*

```typescript
interface SlidingPuzzleDefinition extends PuzzleDefinition {
  type: 'sliding_puzzle';
  grid: { cols: number; rows: number };
  imageAsset: string;                     // el mural de la vendimia
  scramble: 'random' | 'fixed_seed';
  seed?: number;                          // obligatorio si fixed_seed
  blankPosition: 'last' | 'random';
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Nota de diseño:** en el MVP abre como panel React; el mural en la pared (Phaser) solo
  necesita 2 fotogramas (completo/incompleto). El servidor recibe el array de posiciones y
  comprueba el orden.
- **Solvabilidad:** si `random`, el servidor/editor baraja **haciendo movimientos válidos desde
  la posición resuelta** (nunca una permutación impar). Con `fixed_seed`, todos los grupos
  reciben el mismo desorden (justicia competitiva en eventos).

### 6. `memory` — Memoria · *panel (React)*

```typescript
interface MemoryPuzzleDefinition extends PuzzleDefinition {
  type: 'memory';
  pairs: { id: string; symbol: string }[];
  decoys?: number;
  maxFlipsPerTurn?: number;               // 2 por defecto
  winCondition: 'find_all_pairs' | 'find_target_pairs';
  targetPairIds?: string[];
  turnMode: 'shared' | 'per_player';
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Servidor:** lleva estado por grupo (cartas volteadas este turno, parejas encontradas) y
  valida turnos. **Anti-trampa:** el servidor asigna los símbolos a posiciones al crear la
  sesión; el cliente solo recibe "carta 3 volteada = símbolo X" cuando se voltea de verdad.

### 7. `split_clue` — Pista dividida · *híbrido (Phaser mecanismo + React entrada)*

```typescript
interface SplitClueDefinition extends PuzzleDefinition {
  type: 'split_clue';
  viewpoints: { objectId: string; zone: { x: number; y: number; w: number; h: number } }[];
  fragments: string[];                    // orden final de la solución
  visibleByViewpoint: Record<string, (string | null)[]>; // p. ej. mirilla-a ve índices 0 y 2
  wallOccluder: { x: number; y: number; w: number; h: number };
  soloBridgeItemId?: string;              // el espejo
  inputUI: 'symbols' | 'code';
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **La restricción física** (no ver ambas mitades) vive en **Phaser** (oclusión por posición de
  cámara/avatar); la **verificación** es servidor: cada jugador solo recibe del servidor el
  fragmento que su avatar puede ver (`visible_fragments[playerId]`).
- El espejo (`soloBridgeItemId`) añade el segundo fragmento a la visión del jugador solo.
- La entrada de la respuesta combinada es un panel React (`<SymbolInput>`).

### 8. `pipes` — Tuberías · *panel (React)*

```typescript
interface PipesPuzzleDefinition extends PuzzleDefinition {
  type: 'pipes';
  grid: { cols: number; rows: number };
  cellTypes: ('straight' | 'curve' | 'tee' | 'cross')[];
  startCell: { x: number; y: number };
  endCell: { x: number; y: number };
  blockedCells?: { x: number; y: number; opensWithItem?: string }[];
  solution?: Rotation[][];                // opcional, servidor
}
```

- **Estados:** `locked → available → in_progress → solved`.
- **Validación en servidor:** cada rotación se envía; el servidor calcula conectividad
  start→end con **flood fill** (admite múltiples soluciones válidas; no compara con una única).
- El agua fluye visualmente en Phaser **en el mundo** (el canal es escenario); el puzzle
  interactivo es el panel React.
- **Conexión con el mundo:** `blockedCells[].opensWithItem` enlaza con la compuerta que pide la
  llave de oro (cadena Salón → Bodega → Catacumbas del Rey Aldric).

---

## 3. Resumen: dónde vive cada cosa

| Plantilla | Interacción | Verificación | UI |
|---|---|---|---|
| 1. `hidden_key` | Phaser | Servidor (click válido) | — |
| 2. `code_lock` | React panel | Servidor (compara código) | `<CodeLockPuzzle>` |
| 3. `simultaneous_plates` | Phaser | Servidor (ventana temporal) | — |
| 4. `combine_items` | React (inventario) | Servidor (receta) | `<InventoryPanel>` |
| 5. `sliding_puzzle` | React panel | Servidor (orden de piezas) | `<SlidingPuzzle>` |
| 6. `memory` | React panel | Servidor (parejas, turnos) | `<MemoryPuzzle>` |
| 7. `split_clue` | Phaser (visión) + React (entrada) | Servidor (fragmentos visibles) | `<SymbolInput>` |
| 8. `pipes` | React panel | Servidor (flood fill) | `<PipesPuzzle>` |

**Patrón que se repite:** definición estática (JSON, editable) → instancia viva mínima en
Colyseus → validación siempre en servidor → reacción en la capa correspondiente. Los componentes
React de puzzle son **puros y reutilizables**: el mismo `<MemoryPuzzle>` sirve para jugar y para
previsualizar/editar.

## 4. Dependencias

- `specs/07-plantillas-puzzle-v2.md` — extensión del catálogo.
- `specs/11-protocolo-multijugador.md` — mensajes `puzzle_attempt`, `combine`, `plate_state`, etc.
- `reference/catalogo-plantillas.md` — comparativa completa.
