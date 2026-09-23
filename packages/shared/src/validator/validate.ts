import type { RoomPackage } from "../schemas";
import { clueRequirements, computeCodeClues } from "./clues";
import {
  analyzeDoubleUse,
  analyzeRepeatableRules,
  checkReferences,
  checkSoloBridges,
  guardLabel,
} from "./checks";
import { checkAssets, checkPuzzleHints, checkRecipeConsumption } from "./heuristics";
import { recipeLabel, RoomIndex, type Move, type StepEffects } from "./model";
import { createOracle } from "./oracles";
import {
  describeMissingItem,
  explainBlocked,
  relaxedClosure,
  searchCriticalRoute,
  type RouteNode,
} from "./search";
import type {
  BlockedEntry,
  CodeLockClues,
  DoubleUseItem,
  DurationEstimate,
  RouteStep,
  SolvabilityResult,
  ValidateOptions,
  ValidationCheck,
  ValidationIssue,
  ValidationReport,
} from "./types";

/**
 * Validador + test de solvabilidad (specs/22 §2). Puro y determinista: recibe
 * un `RoomPackage` ya parseado y devuelve un informe estructurado. Es el mismo
 * código que usarán el editor (3.7) y `POST /validate` antes de publicar (3.9).
 */

/** Presupuesto por defecto de estados de la BFS exacta (por tamaño de grupo). */
export const DEFAULT_MAX_STATES = 200_000;

/**
 * Minutos medios por tipo de paso (specs/22 §2.5). Constantes iniciales,
 * calibradas contra el Rey Aldric; se revisarán con los datos de playtest
 * (specs/22 §4.4).
 */
export const DURATION_WEIGHTS = {
  enter_room: 1,
  interact: 2,
  use_item: 2,
  combine: 2,
  zone: 1,
  timer: 1,
  hidden_key: 3,
  code_lock: 5,
  simultaneous_plates: 4,
  combine_items: 2,
  sliding_puzzle: 7,
  memory: 5,
  split_clue: 6,
  pipes: 7,
} as const;

/** Margen admitido entre `estimatedMinutes` y la estimación (specs/22 §4.5: ±30 %). */
const DURATION_TOLERANCE = 0.3;

export function validateRoomPackage(
  pkg: RoomPackage,
  options: ValidateOptions = {},
): ValidationReport {
  const index = new RoomIndex(pkg);
  const playerCounts = resolvePlayerCounts(pkg, options.playerCounts);
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;

  const codeClues = computeCodeClues(index);
  const plainOracle = createOracle(index);
  const clueOracle = createOracle(index, { clueRules: clueRequirements(codeClues) });

  const closures = playerCounts.map((n) => ({ n, state: relaxedClosure(index, n, plainOracle) }));

  const solvability: SolvabilityResult[] = closures.map(({ n, state }) => {
    if (!state.victory) {
      return {
        playerCount: n,
        solvable: false,
        route: null,
        ignoredClueOrder: false,
        searchTruncated: false,
        exploredStates: 0,
        blocked: explainBlocked(index, state, plainOracle),
      };
    }
    let search = searchCriticalRoute(index, n, clueOracle, maxStates);
    let ignoredClueOrder = false;
    if (!search.route && !search.truncated && codeClues.some((c) => c.revealedDigits.length)) {
      const plain = searchCriticalRoute(index, n, plainOracle, maxStates);
      if (plain.route || plain.truncated) {
        search = plain;
        ignoredClueOrder = plain.route !== null;
      }
    }
    const route = search.route ? toRouteSteps(index, search.route) : null;
    const blocked: BlockedEntry[] =
      route || search.truncated
        ? []
        : [
            {
              kind: "rule",
              id: "end_game",
              reasons: [
                "la victoria solo es alcanzable gastando ítems que luego faltan (posible soft-lock por consumo)",
              ],
            },
          ];
    return {
      playerCount: n,
      // Con la búsqueda truncada no se puede probar lo contrario: el cierre sí
      // llega a la victoria y el check lo marca como aviso.
      solvable: route !== null || search.truncated,
      route,
      ignoredClueOrder,
      searchTruncated: search.truncated,
      exploredStates: search.explored,
      blocked,
    };
  });

  const primary = solvability.find((result) => result.route !== null) ?? null;
  const criticalRoute =
    primary?.route != null ? { playerCount: primary.playerCount, steps: primary.route } : null;
  const estimate = criticalRoute ? estimateDuration(pkg, criticalRoute) : null;
  const doubleUse = analyzeDoubleUse(index);

  const checks: ValidationCheck[] = [
    referencesCheck(pkg),
    orphansCheck(
      index,
      closures.map((closure) => closure.state),
    ),
    deadEndsCheck(index, closures, plainOracle, playerCounts),
    solvabilityCheck(
      solvability,
      playerCounts,
      playerCounts.includes(1) ? checkSoloBridges(pkg) : [],
    ),
    codeHintsCheck(codeClues, solvability),
    ruleCutsCheck(pkg),
    doubleUseCheck(doubleUse),
    puzzleHintsCheck(pkg),
    recipeConsumptionCheck(index),
    assetsCheck(pkg, options.assetManifest),
    difficultyCheck(pkg, estimate),
  ];

  return {
    roomId: pkg.meta.id,
    ok: checks.every((check) => check.status !== "error"),
    checks,
    solvability,
    criticalRoute,
    estimate,
    codeClues,
    doubleUse,
  };
}

function resolvePlayerCounts(pkg: RoomPackage, requested: number[] | undefined): number[] {
  if (requested && requested.length > 0) {
    return [...new Set(requested.filter((n) => Number.isInteger(n) && n >= 1))].sort(
      (a, b) => a - b,
    );
  }
  const min = Math.max(1, pkg.meta.players.min);
  const max = Math.max(min, pkg.meta.players.max);
  const counts: number[] = [];
  for (let n = min; n <= max; n++) counts.push(n);
  return counts;
}

function playersLabel(counts: readonly number[]): string {
  if (counts.length === 0) return "";
  const first = counts[0]!;
  const last = counts[counts.length - 1]!;
  const range = first === last ? `${first}` : `${first}–${last}`;
  return `${range} jugador${last === 1 ? "" : "es"}`;
}

// ---------------------------------------------------------------------------
// Ruta
// ---------------------------------------------------------------------------

function describeMove(
  index: RoomIndex,
  move: Move,
  effects: StepEffects,
): { description: string; subjectId: string; puzzleType?: string; minutes: number } {
  switch (move.kind) {
    case "solve_puzzle": {
      const puzzle = index.puzzles.get(move.puzzleId)!;
      const minutes = DURATION_WEIGHTS[puzzle.type];
      const base = { subjectId: puzzle.id, puzzleType: puzzle.type, minutes };
      switch (puzzle.type) {
        case "hidden_key":
          return {
            ...base,
            description: `Inspeccionar ${puzzle.hidingSpot.objectId ?? puzzle.id} (${puzzle.id})`,
          };
        case "code_lock":
          return { ...base, description: `Resolver ${puzzle.id} "${puzzle.code}"` };
        case "simultaneous_plates":
          return {
            ...base,
            description:
              puzzle.soloBridgeItemId !== undefined &&
              effects.itemsUsed.includes(puzzle.soloBridgeItemId)
                ? `Colocar ${puzzle.soloBridgeItemId} en ${puzzle.id} (puente)`
                : `Pisar las placas de ${puzzle.id} a la vez`,
          };
        case "sliding_puzzle":
          return {
            ...base,
            description: `Resolver ${puzzle.id} (${puzzle.grid.cols}×${puzzle.grid.rows})`,
          };
        case "memory":
          return { ...base, description: `Resolver ${puzzle.id} (${puzzle.pairs.length} pares)` };
        case "split_clue":
          return {
            ...base,
            description:
              puzzle.soloBridgeItemId !== undefined &&
              effects.itemsUsed.includes(puzzle.soloBridgeItemId)
                ? `Resolver ${puzzle.id} con ${puzzle.soloBridgeItemId} (puente)`
                : `Resolver ${puzzle.id} (cooperativo)`,
          };
        case "pipes": {
          const gates = (puzzle.blockedCells ?? [])
            .map((cell) => cell.opensWithItem)
            .filter((itemId): itemId is string => itemId !== undefined);
          return {
            ...base,
            description:
              gates.length > 0
                ? `Resolver ${puzzle.id} (con ${[...new Set(gates)].join(", ")})`
                : `Resolver ${puzzle.id}`,
          };
        }
        default:
          return { ...base, description: `Resolver ${puzzle.id}` };
      }
    }
    case "combine": {
      const puzzle = index.puzzles.get(move.puzzleId);
      const recipe =
        puzzle?.type === "combine_items" ? puzzle.recipes[move.recipeIndex] : undefined;
      const inputs = recipe?.inputs ?? [];
      return {
        subjectId: move.puzzleId,
        puzzleType: "combine_items",
        minutes: DURATION_WEIGHTS.combine,
        description:
          inputs.length === 1
            ? `Examinar ${inputs[0]} (${move.puzzleId})`
            : `Combinar ${recipe ? recipeLabel(recipe).split("→")[0] : move.puzzleId} (${move.puzzleId})`,
      };
    }
    case "use_item":
      return {
        subjectId: move.objectId,
        minutes: DURATION_WEIGHTS.use_item,
        description: `Usar ${move.itemId} en ${move.objectId}`,
      };
    case "interact":
      return {
        subjectId: move.objectId,
        minutes: DURATION_WEIGHTS.interact,
        description: `Inspeccionar ${move.objectId}`,
      };
    case "enter_room":
      return {
        subjectId: move.roomId,
        minutes: DURATION_WEIGHTS.enter_room,
        description: `Entrar en ${move.roomId} (por ${move.doorId})`,
      };
    case "zone":
      return {
        subjectId: move.ruleId,
        minutes: DURATION_WEIGHTS.zone,
        description: `Reunir al grupo en la zona (${move.ruleId})`,
      };
    case "timer":
      return {
        subjectId: move.timerId,
        minutes: DURATION_WEIGHTS.timer,
        description: `Esperar al timer ${move.timerId}`,
      };
  }
}

function describeOutcome(effects: StepEffects): string {
  const parts: string[] = [];
  const gained = effects.itemsGained.filter((item, i, all) => all.indexOf(item) === i);
  if (gained.length > 0) parts.push(gained.join(" + "));
  parts.push(...effects.flags);
  // `x: desbloqueado` (de `unlocks`) solo si ninguna regla describe ya ese objeto.
  const states = effects.objectStates.filter((entry, i, all) => all.indexOf(entry) === i);
  const described = new Set(
    states.filter((entry) => !entry.endsWith(": desbloqueado")).map((entry) => entry.split(":")[0]),
  );
  parts.push(
    ...states.filter(
      (entry) => !entry.endsWith(": desbloqueado") || !described.has(entry.split(":")[0]),
    ),
  );
  if (effects.victory) parts.push("VICTORIA");
  return parts.join(", ");
}

function toRouteSteps(index: RoomIndex, route: RouteNode[]): RouteStep[] {
  return route.map(({ move, effects }, i) => {
    const described = describeMove(index, move, effects);
    return {
      index: i + 1,
      kind: move.kind,
      subjectId: described.subjectId,
      ...(described.puzzleType !== undefined ? { puzzleType: described.puzzleType } : {}),
      description: described.description,
      outcome: describeOutcome(effects),
      itemsGained: [...effects.itemsGained],
      itemsConsumed: [...effects.itemsConsumed],
      itemsUsed: [...effects.itemsUsed],
      rulesFired: [...effects.rulesFired],
      puzzlesSolved: [...effects.puzzlesSolved],
      roomsEntered: [...effects.roomsEntered],
      victory: effects.victory,
      minutes: described.minutes,
    };
  });
}

function estimateDuration(
  pkg: RoomPackage,
  route: { playerCount: number; steps: RouteStep[] },
): DurationEstimate {
  const minutes = route.steps.reduce((sum, step) => sum + step.minutes, 0);
  const byMinutes = minutes < 35 ? 1 : minutes <= 70 ? 2 : 3;
  const puzzles = pkg.puzzles.length;
  const byPuzzles = puzzles <= 4 ? 1 : puzzles <= 10 ? 2 : 3;
  return {
    playerCount: route.playerCount,
    routeSteps: route.steps.length,
    minutes,
    range: { min: Math.round(minutes * 0.8), max: Math.round(minutes * 1.25) },
    expectedDifficulty: Math.round((byMinutes + byPuzzles) / 2) as 1 | 2 | 3,
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function check(
  id: ValidationCheck["id"],
  failStatus: "warning" | "error",
  issues: ValidationIssue[],
  okSummary: string,
  failSummary: string,
  heuristic = false,
): ValidationCheck {
  const passed = issues.length === 0;
  return {
    id,
    status: heuristic ? "warning" : passed ? "ok" : failStatus,
    heuristic,
    passed,
    summary: passed ? okSummary : failSummary,
    issues,
  };
}

function referencesCheck(pkg: RoomPackage): ValidationCheck {
  const issues = checkReferences(pkg);
  return check(
    "references",
    "error",
    issues,
    "Referencias íntegras: todo id referenciado existe",
    `Referencias rotas: ${issues.length} id(s) inexistentes o duplicados`,
  );
}

function orphansCheck(
  index: RoomIndex,
  closures: readonly { itemCount(id: string): number }[],
): ValidationCheck {
  const issues: ValidationIssue[] = [];
  for (const item of index.pkg.items) {
    const sources = index.itemSources.get(item.id) ?? [];
    if (sources.length === 0) {
      issues.push({
        code: "item_without_source",
        message: `«${item.id}» está en el catálogo pero ningún puzzle, receta, regla ni escondite lo otorga`,
        ids: [item.id],
      });
    } else if (closures.every((state) => state.itemCount(item.id) <= 0)) {
      issues.push({
        code: "item_unreachable",
        message: describeMissingItem(index, item.id),
        ids: [item.id],
      });
    }
  }
  return check(
    "orphans",
    "warning",
    issues,
    "Sin objetos huérfanos: todo item otorgado es alcanzable por una regla o puzzle",
    `Objetos huérfanos: ${issues.map((issue) => issue.ids[0]).join(", ")}`,
  );
}

const BLOCKED_LABEL: Record<BlockedEntry["kind"], (id: string) => string> = {
  puzzle: (id) => `el puzzle «${id}» no puede resolverse`,
  door: (id) => `la puerta «${id}» nunca se abre`,
  rule: (id) => `la regla «${id}» nunca se dispara`,
  item: (id) => `el item «${id}» nunca se obtiene`,
};

/** Fusiona entradas bloqueadas por tamaño de grupo (`playerCounts` si no son todos). */
function mergeBlocked(
  perCount: { n: number; blocked: BlockedEntry[] }[],
  allCounts: readonly number[],
  code: string,
): ValidationIssue[] {
  const merged = new Map<string, { entry: BlockedEntry; counts: number[] }>();
  for (const { n, blocked } of perCount) {
    for (const entry of blocked) {
      const key = `${entry.kind}|${entry.id}`;
      const current = merged.get(key);
      if (current) current.counts.push(n);
      else merged.set(key, { entry, counts: [n] });
    }
  }
  return [...merged.values()].map(({ entry, counts }) => {
    const partial = counts.length < allCounts.length;
    const suffix = partial ? ` (con ${playersLabel(counts)})` : "";
    return {
      code,
      message: `${BLOCKED_LABEL[entry.kind](entry.id)}: ${entry.reasons.join("; ")}${suffix}`,
      ids: [entry.id],
      ...(partial ? { playerCounts: counts } : {}),
    };
  });
}

function deadEndsCheck(
  index: RoomIndex,
  closures: { n: number; state: Parameters<typeof explainBlocked>[1] }[],
  oracle: ReturnType<typeof createOracle>,
  playerCounts: readonly number[],
): ValidationCheck {
  const perCount = closures.map(({ n, state }) => ({
    n,
    blocked: explainBlocked(index, state, oracle).filter((entry) => entry.id !== "end_game"),
  }));
  const issues = mergeBlocked(perCount, playerCounts, "dead_end");
  const doors = index.doors.map((door) => `${door.id} ← ${door.lockedBy ?? "regla"}`);
  return check(
    "dead_ends",
    "error",
    issues,
    doors.length > 0
      ? `Sin dead ends: toda puerta se desbloquea (${doors.join("; ")})`
      : "Sin dead ends: todo puzzle y regla es alcanzable",
    `Dead ends: ${issues.length} elemento(s) sin salida`,
  );
}

function solvabilityCheck(
  results: readonly SolvabilityResult[],
  playerCounts: readonly number[],
  soloIssues: readonly ValidationIssue[],
): ValidationCheck {
  const failing = results.filter((result) => !result.solvable);
  const issues = mergeBlocked(
    failing.map((result) => ({ n: result.playerCount, blocked: result.blocked })),
    playerCounts,
    "unsolvable",
  );
  if (failing.length > 0 && issues.length === 0) {
    issues.push({
      code: "unsolvable",
      message: "no existe secuencia de acciones que llegue a la victoria",
      ids: [],
    });
  }
  // Modo solitario: mecánicas cooperativas sin objeto-puente (specs/22 §2.1).
  issues.push(...soloIssues);
  const truncated = results.filter((result) => result.searchTruncated);
  const summary =
    truncated.length > 0
      ? `Solvabilidad: la victoria es alcanzable (${playersLabel(playerCounts)}), pero la ruta exacta no se verificó con ${playersLabel(truncated.map((r) => r.playerCount))} (presupuesto de estados agotado)`
      : `Solvabilidad: ruta crítica verificada (${playersLabel(playerCounts)}; ver secuencia abajo)`;
  const result = check(
    "solvability",
    "error",
    issues,
    summary,
    failing.length > 0
      ? `Solvabilidad: sin victoria posible con ${playersLabel(failing.map((r) => r.playerCount))}`
      : `Solvabilidad: la sala admite 1 jugador, pero ${soloIssues.map((issue) => issue.ids[0]).join(", ")} no declara(n) objeto-puente`,
  );
  if (result.passed && truncated.length > 0) result.status = "warning";
  return result;
}

/** `hint-sello-1, hint-sello-2` → `hint-sello-1/2`. */
function compactIds(ids: readonly string[]): string {
  if (ids.length <= 1) return ids.join("");
  const cut = ids[0]!.lastIndexOf("-");
  const prefix = cut >= 0 ? ids[0]!.slice(0, cut + 1) : "";
  if (prefix && ids.every((id) => id.startsWith(prefix))) {
    return `${prefix}${ids.map((id) => id.slice(prefix.length)).join("/")}`;
  }
  return ids.join(", ");
}

function codeHintsCheck(
  clues: readonly CodeLockClues[],
  solvability: readonly SolvabilityResult[],
): ValidationCheck {
  if (clues.length === 0) {
    return check("code_hints", "warning", [], "Sin candados de código", "");
  }
  const issues: ValidationIssue[] = [];
  const parts = clues.map((lock) => {
    const covered = lock.hintIds.length > 0;
    if (!covered) {
      issues.push({
        code: "code_lock_without_hints",
        message: `«${lock.puzzleId}» no tiene pistas asociadas`,
        ids: [lock.puzzleId],
      });
    }
    const k = lock.revealedDigits.length;
    if (k === 0) {
      return covered
        ? `${lock.puzzleId} tiene pistas asociadas (OK)`
        : `${lock.puzzleId} no tiene pistas asociadas`;
    }
    const rules = lock.revealedDigits.map((digit) => digit.ruleId).join(", ");
    const head = `${lock.puzzleId} depende de ${k} dígito${k === 1 ? "" : "s"} descubierto${k === 1 ? "" : "s"} sin pista directa (${rules})`;
    return covered
      ? `${head}; cubierto por ${compactIds(lock.hintIds)} (OK)`
      : `${head}; sin pistas que lo cubran`;
  });
  const reordered = solvability.filter((result) => result.ignoredClueOrder);
  if (reordered.length > 0) {
    issues.push({
      code: "clue_order",
      message: `la ruta solo existe ignorando el orden de descubrimiento de los dígitos (con ${playersLabel(reordered.map((r) => r.playerCount))}): algún dígito se revela después de necesitarlo`,
      ids: clues.map((lock) => lock.puzzleId),
    });
  }
  const summary = `Pistas de código: ${parts.join(" — ")}`;
  return check("code_hints", "warning", issues, summary, summary, true);
}

function ruleCutsCheck(pkg: RoomPackage): ValidationCheck {
  const repeatables = analyzeRepeatableRules(pkg.rules);
  const issues: ValidationIssue[] = repeatables
    .filter((rule) => rule.cutConditions === 0)
    .map((rule) => ({
      code: "rule_without_cut",
      message: `«${rule.ruleId}» es repeatable y ninguna de sus condiciones deja de cumplirse al disparar: puede repetirse sin fin`,
      ids: [rule.ruleId],
    }));
  const notes = repeatables.map(
    (rule) => `${rule.ruleId} es repeatable con ${guardLabel(rule.guards)}`,
  );
  return check(
    "rule_cuts",
    "warning",
    issues,
    `Sin reglas sin condiciones de corte${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`,
    `Reglas sin condición de corte: ${issues.map((issue) => issue.ids[0]).join(", ")}`,
  );
}

function doubleUseCheck(items: readonly DoubleUseItem[]): ValidationCheck {
  const issues: ValidationIssue[] = items
    .filter((item) => item.conflict)
    .map((item) => ({
      code: "double_use_conflict",
      message: `«${item.itemId}» se usa en ${item.uses.join(", ")} y ${item.consumingUses.join(", ")} lo gasta: posible soft-lock si se gasta primero en el uso equivocado`,
      ids: [item.itemId],
    }));
  const resolved = items.filter((item) => item.resolvedBy !== null);
  return check(
    "double_use",
    "warning",
    issues,
    `Sin items de doble uso conflictivo${resolved.length > 0 ? ` (${resolved.map((item) => `${item.itemId} se recupera con ${item.resolvedBy}`).join("; ")})` : ""}`,
    `Items de doble uso conflictivo: ${issues.map((issue) => issue.ids[0]).join(", ")}`,
  );
}

function puzzleHintsCheck(pkg: RoomPackage): ValidationCheck {
  const issues = checkPuzzleHints(pkg);
  return check(
    "puzzle_hints",
    "warning",
    issues,
    "Todo puzzle tiene al menos una pista asociada",
    `Puzzles sin pista asociada: ${issues.map((issue) => issue.ids[0]).join(", ")}`,
  );
}

function recipeConsumptionCheck(index: RoomIndex): ValidationCheck {
  const issues = checkRecipeConsumption(index);
  return check(
    "recipe_consumption",
    "warning",
    issues,
    "Sin items gastados (consumeInputs) por más de una receta",
    `Items con consumeInputs en más de una receta: ${issues.map((issue) => issue.ids[0]).join(", ")}`,
  );
}

function assetsCheck(
  pkg: RoomPackage,
  manifest: ValidateOptions["assetManifest"],
): ValidationCheck {
  if (!manifest) {
    return check("assets", "warning", [], "Assets no comprobados (sin manifest del pack)", "");
  }
  const issues = checkAssets(pkg, manifest);
  return check(
    "assets",
    "warning",
    issues,
    "Assets íntegros: todo tile, sprite e icono está en el manifest del pack",
    `Assets sin declarar en el manifest: ${issues.length}`,
  );
}

function difficultyCheck(pkg: RoomPackage, estimate: DurationEstimate | null): ValidationCheck {
  const { difficulty, estimatedMinutes } = pkg.meta;
  if (!estimate) {
    return check(
      "difficulty",
      "warning",
      [
        {
          code: "no_estimate",
          message: "sin ruta crítica no se puede estimar la duración",
          ids: [],
        },
      ],
      "",
      `Dificultad ${difficulty} y estimatedMinutes ${estimatedMinutes} sin estimación (no hay ruta)`,
      true,
    );
  }
  const issues: ValidationIssue[] = [];
  const detail = `estimación ~${estimate.minutes} min, rango ${estimate.range.min}–${estimate.range.max}, ruta de ${estimate.routeSteps} pasos`;
  if (Math.abs(estimatedMinutes - estimate.minutes) > estimatedMinutes * DURATION_TOLERANCE) {
    issues.push({
      code: "duration_out_of_range",
      message: `estimatedMinutes ${estimatedMinutes} se aleja más de un ${DURATION_TOLERANCE * 100} % de la estimación (~${estimate.minutes} min)`,
      ids: [],
    });
  }
  if (difficulty !== estimate.expectedDifficulty) {
    issues.push({
      code: "difficulty_mismatch",
      message: `la dificultad declarada (${difficulty}) no encaja con la esperada (${estimate.expectedDifficulty}) por nº de puzzles y duración`,
      ids: [],
    });
  }
  return check(
    "difficulty",
    "warning",
    issues,
    `Dificultad ${difficulty} coherente con estimatedMinutes ${estimatedMinutes} (${detail})`,
    `Dificultad ${difficulty} / estimatedMinutes ${estimatedMinutes} fuera de rango (${detail})`,
    true,
  );
}
