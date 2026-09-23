import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  createRoomValidator,
  createRulesOverlaySerializer,
  DEFAULT_VALIDATION_DEBOUNCE_MS,
  docToRoomPackage,
  insertCondition,
  removeCondition,
  RulesGraph,
  triggerNodeId,
  ValidationPanel,
  writeRules,
  type RoomValidator,
  type ValidationPanelLabelsInput,
} from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

/**
 * Doc del editor con las reglas del paquete en el mapa `rules` (3.6). Hasta
 * que 3.1 publique la serialización completa, el resto de secciones sale del
 * paquete base (adaptador `createRulesOverlaySerializer`).
 */
function setup(base: RoomPackage = reyAldric) {
  const doc = new Y.Doc();
  writeRules(doc, base.rules);
  return { doc, serialize: createRulesOverlaySerializer(base) };
}

let validators: RoomValidator[] = [];
function track(validator: RoomValidator): RoomValidator {
  validators.push(validator);
  return validator;
}

afterEach(() => {
  for (const validator of validators) validator.destroy();
  validators = [];
  vi.useRealTimers();
});

describe("validador del editor — mapeo de hallazgos a ids", () => {
  it("el Rey Aldric no tiene errores y la regla del grafo queda limpia", () => {
    const { doc, serialize } = setup();
    const state = track(createRoomValidator({ doc, serialize })).getState();
    expect(state.status).toBe("ready");
    expect(state.report!.ok).toBe(true);
    expect(state.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(state.ruleGraphIssues).toEqual([]);
    // Los 🟡 de puzzles sin pista apuntan a puzzles.
    expect(state.issues).toContainEqual(
      expect.objectContaining({ id: "p-mural-vendimia", kind: "puzzle", severity: "warning" }),
    );
  });

  it("marca un objeto huérfano con su id", () => {
    const base = structuredClone(reyAldric);
    base.items.push({ id: "gema-perdida", name: { es: { text: "Gema" } }, icon: "icon-gema" });
    const { doc, serialize } = setup(base);

    const state = track(createRoomValidator({ doc, serialize })).getState();
    const orphans = state.issues.filter((issue) => issue.checkId === "orphans");
    expect(orphans).toEqual([
      {
        id: "gema-perdida",
        kind: "item",
        severity: "warning",
        checkId: "orphans",
        code: "item_without_source",
        message:
          "«gema-perdida» está en el catálogo pero ningún puzzle, receta, regla ni escondite lo otorga",
      },
    ]);
  });

  it("marca un dead end: el puzzle sin salida y la regla que nunca se dispara", () => {
    const base = structuredClone(reyAldric);
    base.puzzles.find((puzzle) => puzzle.id === "p-llave-cuadro")!.grantsItems = [];
    const { doc, serialize } = setup(base);

    const state = track(createRoomValidator({ doc, serialize })).getState();
    const deadEnds = state.issues.filter((issue) => issue.checkId === "dead_ends");
    expect(deadEnds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p-llave-cuadro", kind: "puzzle", severity: "error" }),
        expect.objectContaining({ id: "r-abrir-armario", kind: "rule", severity: "error" }),
      ]),
    );
    // El hook `issues` del grafo de reglas recibe la regla, no el puzzle.
    expect(state.ruleGraphIssues).toContainEqual({
      id: "r-abrir-armario",
      severity: "error",
      message:
        "la regla «r-abrir-armario» nunca se dispara: necesita «llave-bronce», que ningún puzzle, receta, regla ni escondite otorga",
    });
    expect(state.ruleGraphIssues.map((issue) => issue.id)).not.toContain("p-llave-cuadro");
    // Lo que colgaba del armario queda huérfano (items).
    expect(
      state.issues.filter((issue) => issue.checkId === "orphans").map((issue) => issue.id),
    ).toEqual(expect.arrayContaining(["llave-bronce", "mechero", "vela", "antorcha"]));
  });

  it("un doc que aún no forma un RoomPackage deja el estado en `invalid` sin lanzar", () => {
    const doc = new Y.Doc();
    const state = track(
      createRoomValidator({ doc, serialize: () => ({ meta: { title: "" } }) }),
    ).getState();
    expect(state.status).toBe("invalid");
    expect(state.report).toBeNull();
    expect(state.conversionErrors.length).toBeGreaterThan(0);

    const thrown = docToRoomPackage(doc, () => {
      throw new Error("sin mapa");
    });
    expect(thrown).toEqual({ ok: false, errors: [{ path: "", message: "sin mapa" }] });
  });
});

describe("validador del editor — revalidación continua con debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const lockArmario = { type: "flag_is", flag: "armario-desbloqueado", value: true } as const;
  const hasDeadEnd = (validator: RoomValidator) =>
    validator
      .getState()
      .ruleGraphIssues.some(
        (issue) => issue.id === "r-abrir-armario" && issue.severity === "error",
      );

  it("un cambio en el doc Yjs dispara la revalidación tras el debounce; al corregirlo el aviso desaparece", () => {
    const { doc, serialize } = setup();
    const validator = track(createRoomValidator({ doc, serialize }));
    expect(validator.getState().runs).toBe(1);
    expect(hasDeadEnd(validator)).toBe(false);

    // Una condición con un flag que nadie activa deja el armario sin salida.
    insertCondition(doc, "r-abrir-armario", lockArmario);
    expect(validator.getState().pending).toBe(true);
    vi.advanceTimersByTime(DEFAULT_VALIDATION_DEBOUNCE_MS - 1);
    expect(validator.getState().runs).toBe(1);
    expect(hasDeadEnd(validator)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(validator.getState()).toMatchObject({ runs: 2, pending: false });
    expect(hasDeadEnd(validator)).toBe(true);
    expect(validator.getState().report!.ok).toBe(false);

    // Corregirlo (quitar la condición) hace desaparecer el aviso.
    removeCondition(doc, "r-abrir-armario", 1);
    vi.advanceTimersByTime(DEFAULT_VALIDATION_DEBOUNCE_MS);
    expect(validator.getState().runs).toBe(3);
    expect(hasDeadEnd(validator)).toBe(false);
    expect(validator.getState().report!.ok).toBe(true);
  });

  it("agrupa una ráfaga de cambios en una sola pasada y notifica a los suscriptores", () => {
    const { doc, serialize } = setup();
    const validator = track(createRoomValidator({ doc, serialize, debounceMs: 100 }));
    const listener = vi.fn();
    validator.subscribe(listener);

    for (let i = 0; i < 5; i++) {
      insertCondition(doc, "r-abrir-armario", lockArmario);
      vi.advanceTimersByTime(50);
    }
    expect(validator.getState().runs).toBe(1);
    vi.advanceTimersByTime(100);
    expect(validator.getState().runs).toBe(2);
    // Una notificación al pasar a `pending` y otra con el informe nuevo.
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("los cambios de un colaborador remoto (update Yjs aplicado) también revalidan", () => {
    const { doc, serialize } = setup();
    const validator = track(createRoomValidator({ doc, serialize }));
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    insertCondition(remote, "r-abrir-armario", lockArmario);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));

    vi.advanceTimersByTime(DEFAULT_VALIDATION_DEBOUNCE_MS);
    expect(hasDeadEnd(validator)).toBe(true);
  });

  it("destroy deja de escuchar el doc", () => {
    const { doc, serialize } = setup();
    const validator = createRoomValidator({ doc, serialize });
    validator.destroy();
    insertCondition(doc, "r-abrir-armario", lockArmario);
    vi.advanceTimersByTime(DEFAULT_VALIDATION_DEBOUNCE_MS * 2);
    expect(validator.getState().runs).toBe(1);
  });
});

describe("<ValidationPanel> y <RulesGraph> con los hallazgos", () => {
  const labels: ValidationPanelLabelsInput = {
    ui: {
      title: "Validación",
      blocked: "Hay errores que bloquean la publicación",
      errors: "Errores",
      warnings: "Avisos",
      estimate: "Estimación",
      estimateValue: "~{minutes} min ({min}–{max}), {players} jugador(es), {steps} pasos",
      noRoute: "Sin ruta de solución",
    },
    checks: { dead_ends: "Dead ends", orphans: "Objetos huérfanos" },
    kinds: { rule: "Regla", puzzle: "Puzzle" },
  };

  it("pinta errores y avisos con los ids señalados y los textos recibidos por props", () => {
    const base = structuredClone(reyAldric);
    base.puzzles.find((puzzle) => puzzle.id === "p-llave-cuadro")!.grantsItems = [];
    const { doc, serialize } = setup(base);
    const state = track(createRoomValidator({ doc, serialize })).getState();

    const html = renderToStaticMarkup(<ValidationPanel state={state} labels={labels} />);
    expect(html).toContain("Validación");
    expect(html).toContain("Hay errores que bloquean la publicación");
    expect(html).toContain('data-section="errors"');
    expect(html).toContain('data-section="warnings"');
    expect(html).toContain('data-target-id="r-abrir-armario"');
    expect(html).toContain("Regla: r-abrir-armario");
    expect(html).toContain("Puzzle: p-llave-cuadro");
    expect(html).toContain("❌ Dead ends");
    // El armario es un callejón sin salida, pero la victoria sigue siendo alcanzable.
    expect(html).toContain('data-section="route"');

    const graph = renderToStaticMarkup(
      <RulesGraph doc={doc} issues={state.ruleGraphIssues} height={480} />,
    );
    expect(graph).toContain(`data-id="${triggerNodeId("r-abrir-armario")}"`);
    expect(graph).toContain('data-severity="error"');
  });

  it("muestra la estimación de duración y la ruta crítica de una sala solvable", () => {
    const { doc, serialize } = setup();
    const state = track(createRoomValidator({ doc, serialize })).getState();
    const html = renderToStaticMarkup(<ValidationPanel state={state} labels={labels} />);
    const { estimate, criticalRoute } = state.report!;
    expect(html).toContain(
      `~${estimate!.minutes} min (${estimate!.range.min}–${estimate!.range.max}), 1 jugador(es), ${estimate!.routeSteps} pasos`,
    );
    expect(html).toContain('data-section="route"');
    expect(html.split('data-subject-id="').length - 1).toBe(criticalRoute!.steps.length);
    expect(html).toContain("Resolver p-sello-final &quot;4538&quot;");
    expect(html).not.toContain('data-section="errors"');
  });

  it("sin victoria posible no hay estimación ni ruta", () => {
    const base = structuredClone(reyAldric);
    base.objects.find((object) => object.id === "reja-escalera")!.lockedBy = "p-sello-final";
    const { doc, serialize } = setup(base);
    const state = track(createRoomValidator({ doc, serialize })).getState();
    expect(state.issues).toContainEqual(
      expect.objectContaining({ id: "reja-escalera", kind: "object", severity: "error" }),
    );
    const html = renderToStaticMarkup(<ValidationPanel state={state} labels={labels} />);
    expect(html).toContain("Sin ruta de solución");
    expect(html).not.toContain('data-section="route"');
  });
});
