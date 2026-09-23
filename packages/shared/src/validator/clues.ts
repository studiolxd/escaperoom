import type { CodeLockDefinition, Rule } from "../schemas";
import { flattenActions, type RoomIndex } from "./model";
import type { CodeClueDigit, CodeLockClues } from "./types";

/**
 * Pistas de código descubiertas jugando (notas de diseño del Rey Aldric §1–2).
 *
 * Un `code_lock` no declara de dónde salen sus dígitos, pero las reglas que los
 * revelan sí están en los datos: `set_flag` con un valor entero 0–9 o
 * `reveal_number`. El validador asigna a cada dígito del código, como mucho,
 * una regla reveladora con ese valor (cada regla sirve a un solo candado,
 * prefiriendo las de la misma habitación que el candado y, después, el orden
 * de declaración). Los dígitos sin reveladora se leen del decorado (retratos,
 * tapices…) y no generan dependencia.
 *
 * Así el brasero (dígito 3, solo visible al encenderlo) pasa a ser requisito
 * del candado del arca, y el mural, las copas y las vasijas del sello final.
 */

interface Revealer {
  rule: Rule;
  value: string;
  roomId: string | undefined;
  order: number;
}

function revealersOf(index: RoomIndex): Revealer[] {
  const out: Revealer[] = [];
  index.rules.forEach((rule, order) => {
    for (const action of flattenActions(rule.actions)) {
      let value: number | null = null;
      if (action.type === "set_flag" && typeof action.value === "number") value = action.value;
      if (action.type === "reveal_number") value = action.value;
      if (value === null || !Number.isInteger(value) || value < 0 || value > 9) continue;
      out.push({ rule, value: String(value), roomId: index.roomOfRule(rule), order });
    }
  });
  return out;
}

/** Asigna reglas reveladoras a los dígitos de cada `code_lock`. */
export function computeCodeClues(index: RoomIndex): CodeLockClues[] {
  const revealers = revealersOf(index);
  const used = new Set<Revealer>();
  const result: CodeLockClues[] = [];

  for (const puzzle of index.pkg.puzzles) {
    if (puzzle.type !== "code_lock") continue;
    const lock: CodeLockDefinition = puzzle;
    const hintIds = index.pkg.hints
      .filter((hint) => hint.puzzleId === lock.id)
      .map((hint) => hint.id);
    for (const hintId of lock.hints ?? []) {
      if (!hintIds.includes(hintId)) hintIds.push(hintId);
    }

    const revealedDigits: CodeClueDigit[] = [];
    [...lock.code].forEach((digit, position) => {
      const candidates = revealers
        .filter((revealer) => !used.has(revealer) && revealer.value === digit)
        .sort((a, b) => {
          const sameA = a.roomId === lock.roomId ? 0 : 1;
          const sameB = b.roomId === lock.roomId ? 0 : 1;
          return sameA - sameB || a.order - b.order;
        });
      const chosen = candidates[0];
      if (!chosen) return;
      used.add(chosen);
      revealedDigits.push({ position, digit, ruleId: chosen.rule.id });
    });

    result.push({ puzzleId: lock.id, hintIds, revealedDigits });
  }
  return result;
}

/** Reglas que deben haber disparado para poder deducir el código de cada candado. */
export function clueRequirements(clues: readonly CodeLockClues[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const lock of clues) {
    map.set(
      lock.puzzleId,
      lock.revealedDigits.map((digit) => digit.ruleId),
    );
  }
  return map;
}
