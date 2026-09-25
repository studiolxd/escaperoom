import type { MemoryPuzzleDefinition, PuzzleState } from "../schemas";

/**
 * Plantilla `memory` (specs/06 §2.6). Toda la validación y, sobre todo, la
 * **asignación de símbolos por servidor** viven aquí, en `shared`: al crear la
 * sesión se barajan los símbolos sobre las posiciones con una semilla
 * determinista y el cliente solo recibe "carta 3 volteada = símbolo X" cuando
 * esa carta se voltea de verdad (anti-trampa, specs/11 §5). El cliente jamás
 * conoce el reparto completo antes de voltear.
 *
 * La lógica es pura: `flipCard` no muta `state` y devuelve un estado nuevo, con
 * la aleatoriedad inyectada (`rng`), igual que `code-lock.ts` /
 * `combine-items.ts` / `simultaneous-plates.ts`. Así el host (Colyseus/React)
 * decide cuándo y cómo persistirlo y los tests corren sin infraestructura ni
 * `Math.random`.
 *
 * Reglas cubiertas (specs/06 §2.6):
 * - **Turnos:** `turnMode: "shared"` es cooperativo (el turno no cambia solo);
 *   `turnMode: "per_player"` pasa el turno al fallar un par, en el orden de
 *   `players` si el host lo conoce.
 * - **`maxFlipsPerTurn`** (2 por defecto): se acumulan volteos mientras no se
 *   forme pareja; al alcanzar el máximo sin acierto se resuelve el turno
 *   (fallo → pasa el turno en `per_player`; acierto → se reinicia el contador).
 * - **`winCondition`:** `find_all_pairs` exige todas las parejas;
 *   `find_target_pairs` solo `targetPairIds`.
 */

/** Volteos por turno cuando la definición no los fija (specs/06 §2.6). */
export const MEMORY_DEFAULT_MAX_FLIPS_PER_TURN = 2;

/**
 * Generador pseudoaleatorio inyectable. Devuelve un número en `[0, 1)`.
 * Nunca se usa `Math.random`: el host decide la semilla y los tests la fijan.
 */
export type MemoryRng = () => number;

/** Una carta en el tablero: posición física + símbolo oculto asignado por el servidor. */
export interface MemoryCard {
  /** Id de la posición (`"carta-0"`, `"carta-1"`, …), estable para el cliente. */
  id: string;
  /** Índice de la posición en el tablero (0..n-1). */
  index: number;
  /** Símbolo asignado (secreto hasta que la carta se voltea; solo para mostrar). */
  symbol: string;
  /**
   * Id de la pareja a la que pertenece la carta (`pair.id` del creador, o
   * `decoy:<n>` — único por señuelo, así que nunca empareja). El emparejamiento
   * usa SIEMPRE `pairId`, nunca `symbol` (auditoría D-7): dos parejas con el
   * mismo `symbol` (el creador puede repetirlo sin querer) resolvían las dos a
   * la vez porque la clave interna se indexaba por símbolo.
   */
  pairId: string;
  /** Fila del tablero. */
  row: number;
  /** Columna del tablero. */
  col: number;
}

/**
 * Estado interno de un `memory` (nunca sale al cliente tal cual). Incluye el
 * reparto completo de símbolos (`cards`), que solo se proyecta en
 * `toPublicView` para las cartas ya volteadas o emparejadas.
 */
export interface MemoryState {
  /** `locked` si hay `requiresSolved` pendientes; `failed` solo si es definitivo. */
  state: PuzzleState;
  /** Cartas barajadas con sus símbolos (el reparto es secreto). */
  cards: MemoryCard[];
  /** Ids de las cartas vueltas boca arriba en el turno en curso. */
  flippedCardIds: string[];
  /** Claves de símbolo (`symbol:<n>`) de las parejas ya resueltas. */
  matchedPairIds: string[];
  /** Volteos acumulados en el turno en curso (se reinicia al resolverlo). */
  flipsThisTurn: number;
  /** Jugador con el turno en `per_player`; `null` en `shared` o sin asignar. */
  currentPlayerId: string | null;
  solvedAt?: number;
  solvedBy?: string;
}

/** Desenlace de voltear una carta. */
export type MemoryFlipOutcome =
  | "flipped"
  | "match"
  | "mismatch"
  | "turn_ended"
  | "already_flipped"
  | "already_matched"
  | "already_solved"
  | "unavailable"
  | "unknown_card"
  | "not_your_turn";

export interface MemoryFlipResult {
  outcome: MemoryFlipOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: MemoryState;
  /** Carta volteada; `null` si el id era desconocido o no se pudo voltear. */
  cardId: string | null;
  /** Símbolo revelado por esta acción, o `null` si no se reveló ninguno. */
  revealedSymbol: string | null;
  /** `true` si esta acción resolvió una pareja. */
  matched: boolean;
  /** `true` si esta acción cambió el dueño del turno (`per_player`). */
  turnChanged: boolean;
  /** Siguiente jugador en `per_player`, o `null` si no cambia. */
  nextPlayerId: string | null;
  /** `true` si el puzzle acaba de resolverse con esta acción. */
  solved: boolean;
}

/** Proyección de una carta que viaja al cliente. */
export interface MemoryCardView {
  id: string;
  index: number;
  row: number;
  col: number;
  /** `true` si está boca arriba (volteada en el turno o ya emparejada). */
  flipped: boolean;
  /** `true` si la pareja ya está resuelta. */
  matched: boolean;
  /** Símbolo visible; `null` mientras la carta está boca abajo (anti-trampa). */
  symbol: string | null;
}

/**
 * Proyección que viaja al cliente: tablero, turno y progreso. **Nunca** incluye
 * el símbolo de una carta no volteada ni el reparto completo, así que inspeccionar
 * el cliente no revela la solución.
 */
export interface MemoryPublicView {
  id: string;
  type: "memory";
  state: PuzzleState;
  cols: number;
  rows: number;
  cards: MemoryCardView[];
  flippedCardIds: string[];
  matchedPairIds: string[];
  matchedCount: number;
  targetCount: number;
  turnMode: MemoryPuzzleDefinition["turnMode"];
  maxFlipsPerTurn: number;
  flipsThisTurn: number;
  currentPlayerId: string | null;
  /** Turnos restantes en el turno en curso (útil para pintar el marcador). */
  flipsRemaining: number;
  solvedAt: number | null;
  solvedBy: string | null;
}

/** Volteos por turno de la definición (o el valor por defecto de specs/06 §2.6). */
export function maxFlipsPerTurnOf(def: MemoryPuzzleDefinition): number {
  return def.maxFlipsPerTurn ?? MEMORY_DEFAULT_MAX_FLIPS_PER_TURN;
}

/** Ids de las parejas que hacen ganar: todas o solo `targetPairIds`. */
export function targetPairIdsOf(def: MemoryPuzzleDefinition): string[] {
  return def.winCondition === "find_target_pairs"
    ? [...(def.targetPairIds ?? [])]
    : def.pairs.map((pair) => pair.id);
}

/** Nº total de cartas del tablero: parejas + cartas señuelo. */
export function memoryCardCount(def: MemoryPuzzleDefinition): number {
  return def.pairs.length * 2 + (def.decoys ?? 0);
}

/**
 * Columnas del tablero. La definición del MVP no declara `grid`; si algún
 * paquete lo añade como extensión se respeta, y si no se usa un cuadrado.
 */
export function memoryCols(def: MemoryPuzzleDefinition): number {
  const declared = (def as { grid?: { cols?: number } }).grid?.cols;
  if (typeof declared === "number" && declared > 0) return declared;
  return Math.max(1, Math.ceil(Math.sqrt(memoryCardCount(def))));
}

/** Filas del tablero, derivadas de las columnas y el total de cartas. */
export function memoryRows(def: MemoryPuzzleDefinition): number {
  return Math.max(1, Math.ceil(memoryCardCount(def) / memoryCols(def)));
}

/**
 * Construye el reparto de símbolos de forma determinista con `rng` inyectable.
 * En el MVP las cartas señuelo (`decoys`) no forman pareja, así que se rellenan
 * con símbolos exclusivos (`decoy:<n>`) que nunca casan ni entre sí ni con las
 * parejas. Las posiciones se barajan con Fisher–Yates.
 */
export function shuffleMemoryCards(def: MemoryPuzzleDefinition, rng: MemoryRng): MemoryCard[] {
  const entries: { symbol: string; pairId: string }[] = [];
  for (const pair of def.pairs) {
    entries.push({ symbol: pair.symbol, pairId: pair.id }, { symbol: pair.symbol, pairId: pair.id });
  }
  const decoys = def.decoys ?? 0;
  for (let i = 0; i < decoys; i += 1) {
    entries.push({ symbol: `decoy:${i}`, pairId: `decoy:${i}` });
  }

  const cols = memoryCols(def);
  return fisherYates(entries, rng).map(({ symbol, pairId }, index) => ({
    id: `carta-${index}`,
    index,
    symbol,
    pairId,
    row: Math.floor(index / cols),
    col: index % cols,
  }));
}

/**
 * Crea el estado inicial de un `memory`. El servidor llama a esto al crear la
 * sesión; `rng` puede ser una semilla fija (reproducible) o una fuente aleatoria
 * del host. Un puzzle con `requiresSolved` pendiente arranca `locked`.
 */
export function createMemoryState(def: MemoryPuzzleDefinition, rng: MemoryRng): MemoryState {
  return {
    state: def.requiresSolved.length > 0 ? "locked" : "available",
    cards: shuffleMemoryCards(def, rng),
    flippedCardIds: [],
    matchedPairIds: [],
    flipsThisTurn: 0,
    currentPlayerId: null,
  };
}

/** Busca una carta por su id. */
export function findMemoryCard(state: MemoryState, cardId: string): MemoryCard | null {
  return state.cards.find((card) => card.id === cardId) ?? null;
}

/**
 * Voltea una carta. Valida disponibilidad, turno, carta conocida y que no esté
 * ya boca arriba; revela el símbolo y, al completar la pareja o agotar
 * `maxFlipsPerTurn`, resuelve el turno.
 */
export interface FlipCardOptions {
  /**
   * Jugadores de la partida, en orden estable (`RoomSession.players()`), para
   * rotar el turno en `turnMode: "per_player"` (auditoría D-8). Sin ella, el
   * turno no rota (mismo comportamiento que antes de conocer a los
   * jugadores: el creador puede probar el puzzle sin partida real).
   */
  players?: readonly string[];
}

export function flipCard(
  state: MemoryState,
  def: MemoryPuzzleDefinition,
  cardId: string,
  actorId: string,
  now: number,
  options: FlipCardOptions = {},
): MemoryFlipResult {
  if (state.state === "solved") return flipResult("already_solved", state, cardId);
  if (state.state === "locked" || state.state === "failed") {
    return flipResult("unavailable", state, cardId);
  }
  if (
    def.turnMode === "per_player" &&
    state.currentPlayerId !== null &&
    state.currentPlayerId !== actorId
  ) {
    return flipResult("not_your_turn", state, cardId);
  }

  const card = findMemoryCard(state, cardId);
  if (card === null) return flipResult("unknown_card", state, cardId);

  if (state.matchedPairIds.includes(card.pairId)) {
    return flipResult("already_matched", state, cardId);
  }
  if (state.flippedCardIds.includes(cardId)) return flipResult("already_flipped", state, cardId);

  const maxFlips = maxFlipsPerTurnOf(def);
  const flippedCardIds = [...state.flippedCardIds, cardId];
  const flipsThisTurn = state.flipsThisTurn + 1;
  const turnOwner = state.currentPlayerId ?? (def.turnMode === "per_player" ? actorId : null);

  const flippedCards = state.cards.filter((candidate) => flippedCardIds.includes(candidate.id));
  const matchedPairId = findMatchingPairId(flippedCards);

  if (matchedPairId !== null) {
    const matchedPairIds = [...state.matchedPairIds, matchedPairId];
    const solved = targetPairIdsOf(def).every((pairId) => matchedPairIds.includes(pairId));

    const next: MemoryState = {
      ...state,
      state: solved ? "solved" : "in_progress",
      flippedCardIds: [],
      matchedPairIds,
      flipsThisTurn: 0,
      currentPlayerId: solved ? null : turnOwner,
      ...(solved ? { solvedAt: now, solvedBy: actorId } : {}),
    };
    return {
      ...flipResult("match", next, cardId),
      revealedSymbol: card.symbol,
      matched: true,
      solved,
    };
  }

  if (flipsThisTurn < maxFlips) {
    const next: MemoryState = {
      ...state,
      state: "in_progress",
      flippedCardIds,
      flipsThisTurn,
      currentPlayerId: turnOwner,
    };
    return { ...flipResult("flipped", next, cardId), revealedSymbol: card.symbol };
  }

  const turnChanged = def.turnMode === "per_player";
  const nextPlayerId = turnChanged ? nextTurnOwner(state, options.players, actorId) : null;
  const next: MemoryState = {
    ...state,
    state: "in_progress",
    flippedCardIds: [],
    flipsThisTurn: 0,
    currentPlayerId: nextPlayerId,
  };
  return {
    ...flipResult(turnChanged ? "turn_ended" : "mismatch", next, cardId),
    revealedSymbol: card.symbol,
    turnChanged,
    nextPlayerId,
  };
}

/**
 * Proyección pública: el panel recibe el tablero con los símbolos **solo** de
 * las cartas ya volteadas o emparejadas. Se prefija con `Memory` para no
 * colisionar con `toPublicView` de `code-lock` al reexportar las plantillas.
 */
export function toMemoryPublicView(
  state: MemoryState,
  def: MemoryPuzzleDefinition,
): MemoryPublicView {
  const matched = new Set(state.matchedPairIds);
  const flipped = new Set(state.flippedCardIds);
  const targetKeys = targetPairIdsOf(def);

  return {
    id: def.id,
    type: "memory",
    state: state.state,
    cols: memoryCols(def),
    rows: memoryRows(def),
    cards: state.cards.map((card) => {
      const matchedNow = matched.has(card.pairId);
      const flippedNow = flipped.has(card.id);
      return {
        id: card.id,
        index: card.index,
        row: card.row,
        col: card.col,
        flipped: flippedNow || matchedNow,
        matched: matchedNow,
        symbol: flippedNow || matchedNow ? card.symbol : null,
      };
    }),
    flippedCardIds: [...state.flippedCardIds],
    matchedPairIds: [...state.matchedPairIds],
    matchedCount: targetKeys.filter((key) => matched.has(key)).length,
    targetCount: targetKeys.length,
    turnMode: def.turnMode,
    maxFlipsPerTurn: maxFlipsPerTurnOf(def),
    flipsThisTurn: state.flipsThisTurn,
    currentPlayerId: state.currentPlayerId,
    flipsRemaining: Math.max(0, maxFlipsPerTurnOf(def) - state.flipsThisTurn),
    solvedAt: state.solvedAt ?? null,
    solvedBy: state.solvedBy ?? null,
  };
}

/**
 * Comprobación simple para el validador futuro: la definición tiene parejas
 * únicas con símbolo y, si `find_target_pairs`, declara objetivos válidos.
 */
export function isMemorySolvable(state: MemoryState, def: MemoryPuzzleDefinition): boolean {
  if (state.state === "solved") return true;
  if (state.state === "failed") return false;
  return isCoherentMemoryDefinition(def);
}

/** `true` si la definición es jugable (parejas únicas, símbolos no vacíos y objetivos válidos). */
export function isCoherentMemoryDefinition(def: MemoryPuzzleDefinition): boolean {
  if (def.pairs.length === 0 || maxFlipsPerTurnOf(def) < 1) return false;
  const ids = new Set<string>();
  for (const pair of def.pairs) {
    if (pair.id.trim().length === 0 || pair.symbol.trim().length === 0) return false;
    if (ids.has(pair.id)) return false;
    ids.add(pair.id);
  }
  if (def.winCondition === "find_target_pairs") {
    const targets = def.targetPairIds ?? [];
    if (targets.length === 0 || !targets.every((id) => ids.has(id))) return false;
  }
  return true;
}

/**
 * `pairId` que forma pareja entre las cartas volteadas (auditoría D-7:
 * siempre por `pairId`, nunca por `symbol` — dos parejas con el mismo símbolo
 * no deben resolverse juntas). Los señuelos tienen `pairId` único por carta,
 * así que nunca casan.
 */
function findMatchingPairId(cards: MemoryCard[]): string | null {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (card.pairId.startsWith("decoy:")) continue;
    const next = (counts.get(card.pairId) ?? 0) + 1;
    if (next >= 2) return card.pairId;
    counts.set(card.pairId, next);
  }
  return null;
}

/**
 * Siguiente dueño del turno en `per_player`: rota respecto a `currentPlayerId`
 * (o `actorId`, quien acaba de fallar) en el orden de `players`, si el host lo
 * conoce. Sin lista de jugadores, no cambia el dueño.
 */
function nextTurnOwner(
  state: MemoryState,
  players: readonly string[] | undefined,
  actorId: string,
): string | null {
  const current = state.currentPlayerId ?? actorId;
  if (players === undefined || players.length === 0) return null;
  const index = players.indexOf(current);
  if (index < 0) return players[0] ?? null;
  return players[(index + 1) % players.length] ?? null;
}

/** Volteo de Fisher–Yates con `rng` inyectable (determinista con semilla fija). */
function fisherYates<T>(items: T[], rng: MemoryRng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const raw = Math.floor(rng() * (i + 1));
    const j = Math.min(Math.max(raw, 0), i);
    const a = result[i];
    const b = result[j];
    if (a !== undefined && b !== undefined) {
      result[i] = b;
      result[j] = a;
    }
  }
  return result;
}

function flipResult(
  outcome: MemoryFlipOutcome,
  state: MemoryState,
  cardId: string | null,
): MemoryFlipResult {
  return {
    outcome,
    state,
    cardId,
    revealedSymbol: null,
    matched: false,
    turnChanged: false,
    nextPlayerId: state.currentPlayerId,
    solved: state.state === "solved",
  };
}
