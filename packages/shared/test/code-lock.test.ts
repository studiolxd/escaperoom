import { describe, expect, it } from "vitest";
import {
  CODE_LOCK_DEFAULT_LOCKOUT_SEC,
  CODE_LOCK_DEFAULT_MAX_ATTEMPTS,
  attemptCode,
  createCodeLockState,
  isSolvableGiven,
  toPublicView,
  type CodeLockState,
} from "../src/templates";
import { CodeLockDefinitionSchema, type CodeLockDefinition } from "../src/schemas";

function makeDef(overrides: Partial<CodeLockDefinition> = {}): CodeLockDefinition {
  return CodeLockDefinitionSchema.parse({
    id: "p-candado-arca",
    type: "code_lock",
    layer: "panel",
    roomId: "salon-trono",
    requiresSolved: [],
    grantsItems: ["caliz-real"],
    unlocks: ["arca-candado"],
    length: 4,
    code: "4732",
    maxAttempts: 5,
    lockoutSec: 30,
    hints: ["hint-arca-1", "hint-arca-2"],
    ...overrides,
  });
}

describe("code_lock · estado inicial", () => {
  it("arranca disponible sin requiresSolved pendientes", () => {
    const state = createCodeLockState(makeDef());
    expect(state).toEqual({ state: "available", attempts: 0, lockedUntil: null });
  });

  it("arranca bloqueado si depende de otro puzzle", () => {
    const state = createCodeLockState(makeDef({ requiresSolved: ["p-canal-agua"] }));
    expect(state.state).toBe("locked");
  });

  it("no acepta intentos mientras está locked", () => {
    const state = createCodeLockState(makeDef({ requiresSolved: ["p-canal-agua"] }));
    const result = attemptCode(state, makeDef({ requiresSolved: ["p-canal-agua"] }), "4732", 0);
    expect(result.outcome).toBe("unavailable");
    expect(result.state.state).toBe("locked");
  });
});

describe("code_lock · validación", () => {
  it("el código 4732 abre", () => {
    const def = makeDef();
    const wrong = attemptCode(createCodeLockState(def), def, "4731", 1_000);
    expect(wrong.outcome).toBe("wrong");
    expect(wrong.state.attempts).toBe(1);

    const correct = attemptCode(wrong.state, def, "4732", 2_000);
    expect(correct.outcome).toBe("correct");
    expect(correct.state.state).toBe("solved");
    expect(correct.state.solvedAt).toBe(2_000);
  });

  it("tolera espacios alrededor del código", () => {
    const def = makeDef();
    const result = attemptCode(createCodeLockState(def), def, "  4732 ", 1_000);
    expect(result.outcome).toBe("correct");
  });

  it("no muta el estado de entrada (lógica pura)", () => {
    const def = makeDef();
    const state = createCodeLockState(def);
    attemptCode(state, def, "0000", 1_000);
    expect(state).toEqual({ state: "available", attempts: 0, lockedUntil: null });
  });

  it("5 fallos bloquean 30 s y durante el bloqueo no se aceptan intentos", () => {
    const def = makeDef({ maxAttempts: 5, lockoutSec: 30 });
    let state = createCodeLockState(def);

    for (let i = 1; i <= 4; i += 1) {
      const result = attemptCode(state, def, "0000", 1_000);
      expect(result.outcome).toBe("wrong");
      state = result.state;
    }
    expect(state.attempts).toBe(4);

    const fifth = attemptCode(state, def, "0000", 1_000);
    expect(fifth.outcome).toBe("locked_out");
    expect(fifth.lockedUntil).toBe(1_000 + 30_000);
    expect(fifth.state.lockedUntil).toBe(1_000 + 30_000);
    expect(fifth.state.attempts).toBe(0);
    state = fifth.state;

    const duringWithCorrect = attemptCode(state, def, "4732", 20_000);
    expect(duringWithCorrect.outcome).toBe("locked_out");
    expect(duringWithCorrect.state.state).not.toBe("solved");
    expect(duringWithCorrect.state.attempts).toBe(0);

    const duringWithWrong = attemptCode(state, def, "0000", 20_000);
    expect(duringWithWrong.outcome).toBe("locked_out");
    expect(duringWithWrong.state.attempts).toBe(0);

    const afterLockout = attemptCode(state, def, "4732", 31_000);
    expect(afterLockout.outcome).toBe("correct");
    expect(afterLockout.state.state).toBe("solved");
  });

  it("usa maxAttempts/lockoutSec por defecto si faltan (5 y 30)", () => {
    const def = makeDef({ maxAttempts: undefined, lockoutSec: undefined });
    const view = toPublicView(createCodeLockState(def), def);
    expect(view.maxAttempts).toBe(CODE_LOCK_DEFAULT_MAX_ATTEMPTS);
    expect(view.lockoutSec).toBe(CODE_LOCK_DEFAULT_LOCKOUT_SEC);
  });

  it("maxAttempts/lockoutSec son configurables", () => {
    const def = makeDef({ maxAttempts: 2, lockoutSec: 45 });
    const first = attemptCode(createCodeLockState(def), def, "0000", 5_000);
    expect(first.outcome).toBe("wrong");
    expect(first.remainingAttempts).toBe(1);

    const second = attemptCode(first.state, def, "0000", 5_000);
    expect(second.outcome).toBe("locked_out");
    expect(second.lockedUntil).toBe(5_000 + 45_000);

    const reopened = attemptCode(second.state, def, "4732", 50_000);
    expect(reopened.outcome).toBe("correct");
  });

  it("con lockoutSec 0 el fallo es definitivo", () => {
    const def = makeDef({ maxAttempts: 2, lockoutSec: 0 });
    const first = attemptCode(createCodeLockState(def), def, "0000", 1_000);
    expect(first.outcome).toBe("wrong");

    const second = attemptCode(first.state, def, "0000", 1_000);
    expect(second.outcome).toBe("locked_out");
    expect(second.state.state).toBe("failed");
    expect(second.lockedUntil).toBeNull();

    const afterwards = attemptCode(second.state, def, "4732", 999_999);
    expect(afterwards.outcome).toBe("unavailable");
    expect(afterwards.state.state).toBe("failed");
  });

  it("un candado ya resuelto no vuelve a validar", () => {
    const def = makeDef();
    const solved = attemptCode(createCodeLockState(def), def, "4732", 1_000).state;
    const again = attemptCode(solved, def, "0000", 2_000);
    expect(again.outcome).toBe("already_solved");
    expect(again.state.state).toBe("solved");
  });
});

describe("code_lock · proyección pública", () => {
  it("el estado público serializado NO contiene el código", () => {
    const def = makeDef();
    const state = attemptCode(createCodeLockState(def), def, "0000", 1_000).state;
    const view = toPublicView(state, def);

    expect(view).not.toHaveProperty("code");
    expect(JSON.stringify(view)).not.toContain(def.code);
    expect(Object.keys(view)).not.toContain("code");
    expect(view.id).toBe(def.id);
    expect(view.length).toBe(def.length);
    expect(view.attempts).toBe(1);
    expect(view.remainingAttempts).toBe(4);
  });

  it("la vista pública expone bloqueo e intentos para el panel", () => {
    const def = makeDef({ maxAttempts: 1, lockoutSec: 10 });
    const result = attemptCode(createCodeLockState(def), def, "0000", 1_000);
    const view = toPublicView(result.state, def);

    expect(view.state).toBe("available");
    expect(view.lockedUntil).toBe(11_000);
    expect(view.maxAttempts).toBe(1);
    expect(view.hints).toEqual(["hint-arca-1", "hint-arca-2"]);
    expect(JSON.stringify(view)).not.toContain(def.code);
  });

  it("no filtra el código ni con un estado resuelto", () => {
    const def = makeDef();
    const solved = attemptCode(createCodeLockState(def), def, "4732", 1_000).state;
    const view = toPublicView(solved, def);
    expect(JSON.stringify(view)).not.toContain(def.code);
    expect(view.solvedAt).toBe(1_000);
  });
});

describe("code_lock · solvencia (validador futuro)", () => {
  it("una definición coherente y no fallida es resoluble", () => {
    const def = makeDef();
    expect(isSolvableGiven(createCodeLockState(def), def)).toBe(true);
  });

  it("un fallo definitivo no es resoluble", () => {
    const def = makeDef({ maxAttempts: 1, lockoutSec: 0 });
    const failed: CodeLockState = attemptCode(createCodeLockState(def), def, "0000", 1_000).state;
    expect(isSolvableGiven(failed, def)).toBe(false);
  });

  it("un código de longitud incorrecta no es resoluble", () => {
    const def = makeDef({ length: 5, code: "4732" });
    expect(isSolvableGiven(createCodeLockState(def), def)).toBe(false);
  });
});
