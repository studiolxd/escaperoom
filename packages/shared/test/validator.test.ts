import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  computeCodeClues,
  renderValidationReport,
  validateRoomPackage,
  type ValidationCheckId,
  type ValidationReport,
} from "../src/validator";
import { RoomIndex } from "../src/validator/model";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const notesPath = fileURLToPath(
  new URL("../../../docs/reference/rey-aldric-notas-diseno.md", import.meta.url),
);

const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

/** Copia profunda del fixture para mutarla en cada test (el JSON no se toca). */
function cloneFixture(): RoomPackage {
  return structuredClone(reyAldric);
}

function checkOf(report: ValidationReport, id: ValidationCheckId) {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`falta el check ${id}`);
  return check;
}

/** Iconos ✅/🟡/❌ de las líneas de check (primer nivel) de un informe de texto. */
function icons(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(✅|🟡|❌)/u.test(line))
    .map((line) => [...line][0]!);
}

/** Bloque "Informe de validación esperado" de las notas de diseño. */
function expectedReportBlock(): string {
  const notes = readFileSync(notesPath, "utf8");
  const section = notes.split("## Informe de validación esperado")[1] ?? "";
  return section.split("```")[1] ?? "";
}

describe("validador — Rey Aldric", () => {
  const report = validateRoomPackage(reyAldric);
  const text = renderValidationReport(report);

  it("reproduce los mismos ✅/🟡 del informe esperado de las notas de diseño", () => {
    const expected = icons(expectedReportBlock());
    expect(expected).toEqual(["✅", "✅", "✅", "🟡", "✅", "🟡"]);
    expect(icons(text)).toEqual(expected);
    expect(report.ok).toBe(true);
  });

  it("cada check tiene el estado del documento de diseño", () => {
    expect(checkOf(report, "orphans")).toMatchObject({ status: "ok", passed: true });
    expect(checkOf(report, "dead_ends")).toMatchObject({ status: "ok", passed: true });
    expect(checkOf(report, "solvability")).toMatchObject({ status: "ok", passed: true });
    expect(checkOf(report, "code_hints")).toMatchObject({ status: "warning", passed: true });
    expect(checkOf(report, "rule_cuts")).toMatchObject({ status: "ok", passed: true });
    expect(checkOf(report, "difficulty")).toMatchObject({ status: "warning", passed: true });
    expect(checkOf(report, "references").passed).toBe(true);
    expect(checkOf(report, "double_use").passed).toBe(true);

    expect(text).toContain("Sin objetos huérfanos");
    expect(text).toContain(
      "toda puerta se desbloquea (puerta-bodega ← p-placas-estatuas; reja-escalera ← p-reja-mirillas)",
    );
    expect(text).toContain("r-recoger-caliz es repeatable con guarda doble");
    expect(text).toContain("Dificultad 2 coherente con estimatedMinutes 55");
    expect(text).toContain("cubierto por hint-sello-1/2/3 (OK)");
  });

  it("es solvable para todos los tamaños de grupo de players.min a players.max", () => {
    expect(report.solvability.map((result) => result.playerCount)).toEqual([1, 2, 3, 4]);
    expect(report.solvability.every((result) => result.solvable)).toBe(true);
    expect(report.solvability.every((result) => !result.searchTruncated)).toBe(true);
  });

  it("la ruta crítica (players.min = 1) es coherente con la secuencia de 14 pasos", () => {
    const route = report.criticalRoute!;
    expect(route.playerCount).toBe(1);
    expect(route.steps.length).toBeGreaterThanOrEqual(12);
    expect(route.steps.length).toBeLessThanOrEqual(16);

    const at = (predicate: (s: (typeof route.steps)[number]) => boolean, label: string): number => {
      const position = route.steps.findIndex(predicate);
      expect(position, `falta el paso «${label}» en la ruta`).toBeGreaterThanOrEqual(0);
      return position;
    };
    const solve = (id: string) => at((s) => s.puzzlesSolved.includes(id) && s.subjectId === id, id);
    const gained = (item: string) => at((s) => s.itemsGained.includes(item), item);

    // Orden de la secuencia verificada de las notas de diseño (pasos 1–14).
    const order = [
      solve("p-llave-cuadro"), // 1. llave-bronce
      gained("mechero"), // 2. armario
      gained("antorcha"), // 3. mechero+vela
      at((s) => s.rulesFired.includes("r-encender-brasero"), "brasero"), // 4. dígito 3
      solve("p-candado-arca"), // 5. "4732" → cáliz
      solve("p-placas-estatuas"), // 6. placas (en solitario con el cáliz)
      solve("p-mural-vendimia"), // 7. mural → llave-plata
      gained("llave-oro"), // 8. inspeccionar llave-plata
      solve("p-copas-memoria"), // 10. copas
      solve("p-reja-mirillas"), // 11. mirillas (espejo)
      solve("p-canal-agua"), // 12. tuberías con llave-oro
      solve("p-sello-final"), // 14. sello "4538"
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(at((s) => s.rulesFired.includes("r-inspeccionar-vasijas"), "vasijas")).toBeLessThan(
      solve("p-sello-final"),
    );

    // El puente del modo solitario se usa (cáliz en la placa, espejo en la mirilla).
    // El puente se presenta y no se gasta (mismo criterio que `RoomSession`).
    expect(route.steps[solve("p-placas-estatuas")]!.itemsUsed).toEqual(["caliz-real"]);
    expect(route.steps[solve("p-placas-estatuas")]!.itemsConsumed).not.toContain("caliz-real");
    expect(route.steps[solve("p-reja-mirillas")]!.itemsUsed).toEqual(["espejo"]);
    expect(route.steps[solve("p-reja-mirillas")]!.itemsConsumed).not.toContain("espejo");

    const last = route.steps[route.steps.length - 1]!;
    expect(last.victory).toBe(true);
    expect(last.subjectId).toBe("p-sello-final");
    expect(text).toContain("Secuencia de solución verificada (ruta crítica, 1 jugador)");
    expect(text).toContain('Resolver p-sello-final "4538"');
  });

  it("en grupo las placas se pisan sin puente y la ruta es más corta", () => {
    const group = report.solvability.find((result) => result.playerCount === 2)!;
    const plates = group.route!.find((step) => step.subjectId === "p-placas-estatuas")!;
    expect(plates.itemsConsumed).toEqual([]);
    expect(plates.itemsUsed).toEqual([]);
    expect(group.route!.length).toBeLessThan(report.criticalRoute!.steps.length);
  });

  it("asigna los dígitos revelados a cada candado (brasero → arca; mural, copas, vasijas → sello)", () => {
    const clues = computeCodeClues(new RoomIndex(reyAldric));
    expect(clues).toEqual([
      {
        puzzleId: "p-candado-arca",
        hintIds: ["hint-arca-1", "hint-arca-2"],
        revealedDigits: [{ position: 2, digit: "3", ruleId: "r-encender-brasero" }],
      },
      {
        puzzleId: "p-sello-final",
        hintIds: ["hint-sello-1", "hint-sello-2", "hint-sello-3"],
        revealedDigits: [
          { position: 1, digit: "5", ruleId: "r-mural-resuelto" },
          { position: 2, digit: "3", ruleId: "r-copas-resueltas" },
          { position: 3, digit: "8", ruleId: "r-inspeccionar-vasijas" },
        ],
      },
    ]);
  });

  it("estima la duración a partir de la ruta crítica", () => {
    const estimate = report.estimate!;
    expect(estimate.routeSteps).toBe(report.criticalRoute!.steps.length);
    expect(estimate.minutes).toBeGreaterThanOrEqual(45);
    expect(estimate.minutes).toBeLessThanOrEqual(70);
    expect(estimate.expectedDifficulty).toBe(2);
  });

  it("el cáliz no es doble uso conflictivo: el puente se presenta y no se gasta (sin aviso)", () => {
    expect(report.doubleUse.filter((item) => item.conflict)).toEqual([]);
    expect(report.doubleUse.map((item) => item.itemId)).not.toContain("caliz-real");
    expect(text).not.toContain("doble uso conflictivo");
  });

  it("es puro y determinista: no muta el paquete y repite el mismo informe", () => {
    const pkg = cloneFixture();
    const before = structuredClone(pkg);
    const first = validateRoomPackage(pkg);
    expect(pkg).toEqual(before);
    expect(validateRoomPackage(pkg)).toEqual(first);
  });
});

describe("validador — dead ends artificiales", () => {
  it("sin el grantsItems de la llave de bronce, el armario queda sin salida", () => {
    const pkg = cloneFixture();
    const puzzle = pkg.puzzles.find((candidate) => candidate.id === "p-llave-cuadro")!;
    puzzle.grantsItems = [];

    const report = validateRoomPackage(pkg);
    const deadEnds = checkOf(report, "dead_ends");
    expect(report.ok).toBe(false);
    expect(deadEnds.status).toBe("error");
    const messages = deadEnds.issues.map((issue) => issue.message);
    expect(messages).toContain(
      "el puzzle «p-llave-cuadro» no puede resolverse: el escondite no entrega ningún objeto (grantsItems y keyItemId vacíos)",
    );
    expect(messages).toContain(
      "la regla «r-abrir-armario» nunca se dispara: necesita «llave-bronce», que ningún puzzle, receta, regla ni escondite otorga",
    );
    // Lo que colgaba del armario queda huérfano.
    expect(checkOf(report, "orphans").issues.map((issue) => issue.ids[0])).toEqual(
      expect.arrayContaining(["llave-bronce", "mechero", "vela", "antorcha"]),
    );
    expect(renderValidationReport(report)).toMatch(/^❌ Dead ends/mu);
  });

  it("una reja que depende de un puzzle posterior deja la sala sin victoria", () => {
    const pkg = cloneFixture();
    pkg.objects.find((object) => object.id === "reja-escalera")!.lockedBy = "p-sello-final";

    const report = validateRoomPackage(pkg);
    expect(report.ok).toBe(false);
    expect(report.solvability.every((result) => !result.solvable)).toBe(true);
    expect(report.criticalRoute).toBeNull();

    const solvability = checkOf(report, "solvability");
    expect(solvability.status).toBe("error");
    expect(solvability.summary).toBe("Solvabilidad: sin victoria posible con 1–4 jugadores");
    const messages = solvability.issues.map((issue) => issue.message);
    expect(messages).toContain(
      "la puerta «reja-escalera» nunca se abre: depende de «p-sello-final», que nunca se resuelve",
    );
    expect(messages).toContain(
      "el puzzle «p-canal-agua» no puede resolverse: su habitación «catacumbas» no es accesible",
    );
    expect(checkOf(report, "dead_ends").status).toBe("error");
  });

  it("sin objeto-puente, las placas no se resuelven en solitario pero sí en grupo", () => {
    const pkg = cloneFixture();
    const plates = pkg.puzzles.find((candidate) => candidate.id === "p-placas-estatuas")!;
    if (plates.type !== "simultaneous_plates") throw new Error("tipo inesperado");
    delete plates.soloBridgeItemId;

    const report = validateRoomPackage(pkg);
    expect(report.solvability.map((result) => [result.playerCount, result.solvable])).toEqual([
      [1, false],
      [2, true],
      [3, true],
      [4, true],
    ]);
    const issue = checkOf(report, "solvability").issues.find((candidate) =>
      candidate.ids.includes("p-placas-estatuas"),
    )!;
    expect(issue.playerCounts).toEqual([1]);
    expect(issue.message).toContain("no declara soloBridgeItemId");
    expect(issue.message).toContain("(con 1 jugador)");
    // La ruta reportada pasa a ser la del grupo más pequeño que sí gana.
    expect(report.criticalRoute!.playerCount).toBe(2);
  });

  it("sin la receta de la llave de oro, la compuerta de las tuberías bloquea el canal", () => {
    const pkg = cloneFixture();
    const combine = pkg.puzzles.find((candidate) => candidate.id === "p-combina")!;
    if (combine.type !== "combine_items") throw new Error("tipo inesperado");
    combine.recipes = combine.recipes.filter((recipe) => recipe.output !== "llave-oro");

    const report = validateRoomPackage(pkg);
    const messages = checkOf(report, "solvability").issues.map((issue) => issue.message);
    expect(messages).toContain(
      "el puzzle «p-canal-agua» no puede resolverse: la compuerta (3,2) necesita «llave-oro» en el inventario; «llave-oro» no lo otorga ningún puzzle, receta, regla ni escondite",
    );
  });
});

describe("validador — huérfanos, reglas y referencias", () => {
  it("detecta un item del catálogo que nadie otorga", () => {
    const pkg = cloneFixture();
    pkg.items.push({ id: "gema-perdida", name: { es: { text: "Gema" } }, icon: "icon-gema" });

    const report = validateRoomPackage(pkg);
    const orphans = checkOf(report, "orphans");
    expect(orphans.status).toBe("warning");
    expect(orphans.issues).toEqual([
      {
        code: "item_without_source",
        message:
          "«gema-perdida» está en el catálogo pero ningún puzzle, receta, regla ni escondite lo otorga",
        ids: ["gema-perdida"],
      },
    ]);
    expect(renderValidationReport(report)).toContain("🟡 Objetos huérfanos: gema-perdida");
    // Un huérfano no bloquea la publicación por sí solo.
    expect(report.ok).toBe(true);
  });

  it("detecta un item que solo otorga una regla inalcanzable", () => {
    const pkg = cloneFixture();
    pkg.items.push({ id: "corona", name: { es: { text: "Corona" } }, icon: "icon-corona" });
    pkg.rules.push({
      id: "r-corona",
      priority: 0,
      once: true,
      trigger: { type: "on_interact", objectId: "trono" },
      conditions: [{ type: "flag_is", flag: "nunca", value: true }],
      actions: [{ type: "grant_item", itemId: "corona", to: "interactor" }],
    });

    const orphans = checkOf(validateRoomPackage(pkg), "orphans");
    expect(orphans.issues).toEqual([
      expect.objectContaining({
        code: "item_unreachable",
        message: "«corona» solo se obtiene de la regla «r-corona», que no llega a alcanzarse",
      }),
    ]);
  });

  it("avisa de una regla repetible sin condición de corte", () => {
    const pkg = cloneFixture();
    pkg.rules.push({
      id: "r-bucle",
      priority: 0,
      once: false,
      trigger: { type: "on_interact", objectId: "trono" },
      conditions: [],
      actions: [{ type: "grant_item", itemId: "vela", to: "interactor" }],
    });

    const report = validateRoomPackage(pkg);
    const cuts = checkOf(report, "rule_cuts");
    expect(cuts.status).toBe("warning");
    expect(cuts.issues.map((issue) => issue.ids)).toEqual([["r-bucle"]]);
    expect(renderValidationReport(report)).toContain("🟡 Reglas sin condición de corte: r-bucle");
  });

  it("avisa del doble uso del cáliz si la ranura lo gasta y se quita la regla de recuperación", () => {
    const pkg = cloneFixture();
    pkg.rules = pkg.rules.filter((rule) => rule.id !== "r-recoger-caliz");
    const slot = pkg.rules.find((rule) => rule.id === "r-caliz-en-ranura")!;
    slot.conditions = slot.conditions.map((condition) =>
      condition.type === "item_in_inventory" && condition.itemId === "caliz-real"
        ? { ...condition, consumed: true }
        : condition,
    );

    const report = validateRoomPackage(pkg);
    const doubleUse = checkOf(report, "double_use");
    expect(doubleUse.status).toBe("warning");
    expect(doubleUse.issues[0]!.ids).toEqual(["caliz-real"]);
    expect(renderValidationReport(report)).toContain(
      "🟡 Items de doble uso conflictivo: caliz-real",
    );
  });

  it("señala referencias rotas con los ids disponibles", () => {
    const pkg = cloneFixture();
    pkg.rules.push({
      id: "r-rota",
      priority: 0,
      once: true,
      trigger: { type: "on_interact", objectId: "salida-bodega" },
      conditions: [],
      actions: [],
    });

    const report = validateRoomPackage(pkg);
    const references = checkOf(report, "references");
    expect(report.ok).toBe(false);
    expect(references.status).toBe("error");
    expect(references.issues[0]!.message).toMatch(
      /^el objeto «salida-bodega» \(en rules\[r-rota\]\.trigger\) no existe\. Disponibles: \[altar, arca-candado, /u,
    );
  });

  it("marca la dificultad como fuera de rango si estimatedMinutes no encaja", () => {
    const pkg = cloneFixture();
    pkg.meta.estimatedMinutes = 20;
    pkg.meta.difficulty = 3;

    const difficulty = checkOf(validateRoomPackage(pkg), "difficulty");
    expect(difficulty).toMatchObject({ status: "warning", passed: false });
    expect(difficulty.issues.map((issue) => issue.code)).toEqual([
      "duration_out_of_range",
      "difficulty_mismatch",
    ]);
  });

  it("permite evaluar solo el modo solitario (players.min) para 2.10", () => {
    const report = validateRoomPackage(reyAldric, { playerCounts: [1] });
    expect(report.solvability).toHaveLength(1);
    expect(report.solvability[0]).toMatchObject({ playerCount: 1, solvable: true });
  });
});
