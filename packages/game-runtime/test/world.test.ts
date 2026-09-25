import { describe, expect, it } from "vitest";
import {
  collectContainer,
  consumeFromContainer,
  containsItem,
  containerContents,
  createContainerStateMap,
  createObjectStateMap,
  currentObjectState,
  hasObjectState,
  initialObjectState,
  inspectObject,
  resolveObjectStateAnimation,
  resolveObjectStateSprite,
  setObjectState,
  WorldObjectStateError,
  type ContainerStateMap,
  type ObjectStateMap,
  type RuntimeModel,
  type RuntimeObject,
} from "../src";
import { loadRoomPackage, toRuntimeModel } from "../src/loader";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function loadFixtureModel(locale?: string): RuntimeModel {
  const raw: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  return toRuntimeModel(loadRoomPackage(raw), locale ? { locale } : {});
}

/** Paquete mínimo y válido para probar objetos, contenedores y reglas. */
function demoPackage() {
  return {
    meta: {
      id: "room-demo",
      title: "Demo",
      authorId: "org-test",
      version: "1.0.0",
      packageFormat: "roompackage/v1",
      theme: "medieval",
      description: "Sala de prueba",
      languages: ["es", "en"],
      defaultLanguage: "es",
      estimatedMinutes: 10,
      difficulty: 1 as const,
      players: { min: 1, max: 4 },
      assetsManifest: "r2://assets/demo/manifest.json",
    },
    map: {
      tileset: "demo-v1",
      rooms: [
        {
          id: "sala",
          name: "Sala",
          grid: { cols: 6, rows: 6 },
          layers: [{ name: "ground", rle: [36, 1] }],
          decorations: [],
          spawnPoints: [{ id: "spawn-1", x: 1, y: 1 }],
          lighting: [{ type: "ambient" as const, color: "#0b1120", intensity: 0.4 }],
        },
      ],
    },
    objects: [
      {
        id: "cofre",
        roomId: "sala",
        type: "cajon",
        position: { x: 3, y: 3 },
        sprite: "cofre-cerrado",
        states: {
          closed: "cofre-cerrado",
          open: { sprite: "cofre-abierto", animation: "slide_up" },
        },
        initialState: "closed",
        interactable: true,
        inventory: ["llave-bronce", "moneda"],
        distribution: "first_click" as const,
      },
      {
        id: "palanca",
        roomId: "sala",
        type: "mecanismo",
        position: { x: 4, y: 2 },
        sprite: "palanca",
        states: { off: "palanca", on: "palanca-on" },
        initialState: "off",
        interactable: true,
      },
    ],
    items: [
      { id: "llave-bronce", name: { es: { text: "Llave de bronce" } }, icon: "icon-llave" },
      { id: "moneda", name: { es: { text: "Moneda" } }, icon: "icon-moneda" },
    ],
    puzzles: [],
    rules: [
      {
        id: "r-inspeccionar-cofre",
        priority: 0,
        once: false,
        trigger: { type: "on_interact" as const, objectId: "cofre" },
        conditions: [],
        actions: [{ type: "show_dialog" as const, dialogId: "d-cofre" }],
      },
      {
        id: "r-palanca",
        priority: 0,
        once: false,
        trigger: { type: "on_interact" as const, objectId: "palanca" },
        conditions: [],
        actions: [
          { type: "show_dialog" as const, dialogId: "d-palanca" },
          { type: "open_panel_puzzle" as const, puzzleId: "p-palanca" },
        ],
      },
    ],
    dialogs: [
      {
        id: "d-cofre",
        text: { es: { text: "Un cofre polvoriento." }, en: { text: "A dusty chest." } },
      },
      { id: "d-palanca", text: { es: { text: "Una palanca oxidada." } } },
    ],
    hints: [],
  };
}

function demoModel(locale?: string): RuntimeModel {
  return toRuntimeModel(loadRoomPackage(demoPackage()), locale ? { locale } : {});
}

describe("WorldObject: estados y transiciones (specs/04 §3.1)", () => {
  it("crea el estado inicial por objeto desde el fixture del Rey Aldric", () => {
    const model = loadFixtureModel();
    const states = createObjectStateMap(model);

    expect(states["cuadro-aurelio"]).toBe("closed");
    expect(states["brasero"]).toBe("unlit");
    expect(states["armario"]).toBe("closed");
    expect(states["placa-izq"]).toBe("up");
    expect(states["trono"]).toBe("");
    expect(Object.keys(states)).toHaveLength(model.objects.length);
  });

  it("resuelve el estado inicial con fallback al primero declarado", () => {
    const object = demoModel().objectsById["cofre"];
    if (!object) throw new Error("falta el cofre");
    expect(initialObjectState(object)).toBe("closed");
    expect(initialObjectState({ ...object, initialState: "inexistente" })).toBe("closed");
  });

  it("aplica transiciones válidas y resuelve el sprite por estado", () => {
    const model = loadFixtureModel();
    const cuadro = model.objectsById["cuadro-aurelio"];
    if (!cuadro) throw new Error("falta el cuadro");

    let states: ObjectStateMap = createObjectStateMap(model);
    expect(resolveObjectStateSprite(cuadro, currentObjectState(states, cuadro))).toBe("cuadro-rey");

    states = setObjectState(states, cuadro, "open");
    expect(states["cuadro-aurelio"]).toBe("open");
    expect(resolveObjectStateSprite(cuadro, "open")).toBe("cuadro-rey-torcido");
  });

  it("es idempotente al fijar el mismo estado", () => {
    const model = loadFixtureModel();
    const brasero = model.objectsById["brasero"];
    if (!brasero) throw new Error("falta el brasero");
    const states = createObjectStateMap(model);

    expect(setObjectState(states, brasero, "unlit")).toBe(states);
  });

  it("rechaza estados no declarados por el objeto", () => {
    const model = loadFixtureModel();
    const brasero = model.objectsById["brasero"];
    if (!brasero) throw new Error("falta el brasero");
    const states = createObjectStateMap(model);

    expect(hasObjectState(brasero, "lit")).toBe(true);
    expect(hasObjectState(brasero, "exploded")).toBe(false);
    expect(() => setObjectState(states, brasero, "exploded")).toThrowError(WorldObjectStateError);
    expect(() => setObjectState(states, brasero, "exploded")).toThrowError(/no declara el estado/);
  });

  it("expone la animación de transición declarada por estado", () => {
    const model = demoModel();
    const cofre = model.objectsById["cofre"];
    if (!cofre) throw new Error("falta el cofre");

    expect(cofre.animationByState).toEqual({ open: "slide_up" });
    expect(resolveObjectStateAnimation(cofre, "open")).toBe("slide_up");
    expect(resolveObjectStateAnimation(cofre, "closed")).toBeUndefined();
  });
});

describe("distribution: inventario interno (specs/04 §3.2)", () => {
  function containers(): ContainerStateMap {
    return createContainerStateMap(demoModel());
  }

  function chest(model = demoModel()): RuntimeObject {
    const object = model.objectsById["cofre"];
    if (!object) throw new Error("falta el cofre");
    return object;
  }

  it("crea un contenedor por objeto con `inventory` y sabe qué contiene", () => {
    const model = demoModel();
    const map = createContainerStateMap(model);

    expect(Object.keys(map)).toEqual(["cofre"]);
    expect(containerContents(map, "cofre")).toEqual(["llave-bronce", "moneda"]);
    expect(containsItem(map, "cofre", "llave-bronce")).toBe(true);
    expect(containsItem(map, "cofre", "antorcha")).toBe(false);
    expect(containsItem(map, "palanca", "llave-bronce")).toBe(false);
  });

  it("first_click entrega todo a quien abre y vacía el contenedor", () => {
    const map = containers();
    const result = collectContainer(map, chest(), { openerId: "p1" });

    expect(result.grants).toEqual({ p1: ["llave-bronce", "moneda"] });
    expect(containerContents(result.map, "cofre")).toEqual([]);
    expect(result.opened).toBe(true);
    expect(result.alreadyOpen).toBe(false);
  });

  it("no vuelve a repartir un contenedor ya abierto (idempotente)", () => {
    const first = collectContainer(containers(), chest(), { openerId: "p1" });
    const second = collectContainer(first.map, chest(), { openerId: "p2" });

    expect(second.grants).toEqual({});
    expect(second.alreadyOpen).toBe(true);
    expect(containerContents(second.map, "cofre")).toEqual([]);
  });

  it("all_players entrega a todos los jugadores presentes", () => {
    const model = demoModel();
    const chestObject = { ...chest(model), distribution: "all_players" as const };
    const result = collectContainer(createContainerStateMap(model), chestObject, {
      openerId: "p1",
      playerIds: ["p1", "p2", "p3"],
    });

    expect(result.grants).toEqual({
      p1: ["llave-bronce", "moneda"],
      p2: ["llave-bronce", "moneda"],
      p3: ["llave-bronce", "moneda"],
    });
    expect(containerContents(result.map, "cofre")).toEqual([]);
  });

  it("assigned entrega solo lo asignado y deja el resto dentro", () => {
    const model = demoModel();
    const chestObject = { ...chest(model), distribution: "assigned" as const };
    const result = collectContainer(createContainerStateMap(model), chestObject, {
      openerId: "p1",
      assigned: { p1: ["llave-bronce"], p2: ["moneda"] },
    });

    expect(result.grants).toEqual({ p1: ["llave-bronce"], p2: ["moneda"] });
    expect(containerContents(result.map, "cofre")).toEqual([]);

    const partial = collectContainer(createContainerStateMap(model), chestObject, {
      openerId: "p1",
      assigned: { p2: ["moneda"] },
    });
    expect(partial.grants).toEqual({ p2: ["moneda"] });
    expect(containerContents(partial.map, "cofre")).toEqual(["llave-bronce"]);
  });

  it("consume items del contenedor una unidad cada vez", () => {
    const map = containers();
    const first = consumeFromContainer(map, "cofre", "llave-bronce");
    expect(first.consumed).toBe(true);
    expect(containerContents(first.map, "cofre")).toEqual(["moneda"]);

    const missing = consumeFromContainer(first.map, "cofre", "llave-bronce");
    expect(missing.consumed).toBe(false);
    expect(missing.map).toBe(first.map);

    const unknown = consumeFromContainer(map, "palanca", "moneda");
    expect(unknown.consumed).toBe(false);
  });
});

describe("inspección: diálogo por idioma con fallback (specs/04 §4)", () => {
  it("resuelve el diálogo del objeto al idioma del modelo (es)", () => {
    const model = loadFixtureModel("es");
    const result = inspectObject(model, "cuadro-aurelio");

    expect(result?.dialogId).toBe("d-cuadro");
    expect(result?.dialog?.text).toContain("Aurelio");
    expect(result?.conditioned).toBe(false);
    expect(result?.panelPuzzleId).toBeUndefined();
  });

  it("cambia de idioma en caliente y cae al primer locale si falta", () => {
    const model = loadFixtureModel("en");
    const result = inspectObject(model, "cuadro-aurelio", { locale: "en" });

    expect(result?.dialog?.text).toContain("Aurelio");
    expect(result?.dialog?.localized.es?.text).toContain("Aurelio");
    expect(result?.dialog?.text).toBe(result?.dialog?.localized.es?.text);
  });

  it("respeta el idioma pedido cuando el diálogo lo tiene", () => {
    const model = demoModel("es");
    const es = inspectObject(model, "cofre", { locale: "es" });
    const en = inspectObject(model, "cofre", { locale: "en" });

    expect(es?.dialog?.text).toBe("Un cofre polvoriento.");
    expect(en?.dialog?.text).toBe("A dusty chest.");
  });

  it("marca las inspecciones condicionadas (las evalúa el motor de 1.4)", () => {
    const model = loadFixtureModel();
    expect(inspectObject(model, "brasero")?.conditioned).toBe(true);
    expect(inspectObject(model, "mural-ranura")?.dialogId).toBe("d-ranura");
    expect(inspectObject(model, "armario")?.dialogId).toBeUndefined();
  });

  it("devuelve el panel asociado a la inspección", () => {
    const result = inspectObject(demoModel(), "palanca");
    expect(result?.dialogId).toBe("d-palanca");
    expect(result?.panelPuzzleId).toBe("p-palanca");
  });

  it("adjunta el contenido interno del contenedor y su modo de reparto", () => {
    const result = inspectObject(demoModel(), "cofre");
    expect(result?.contents).toEqual(["llave-bronce", "moneda"]);
    expect(result?.distribution).toBe("first_click");
    expect(result?.opened).toBe(false);
  });

  it("devuelve undefined para un objeto inexistente", () => {
    expect(inspectObject(loadFixtureModel(), "no-existe")).toBeUndefined();
  });
});

describe("loader: proyección de inspección sin filtrar secretos", () => {
  it("deriva el diálogo de inspección de las reglas on_interact", () => {
    const model = loadFixtureModel();

    expect(model.objectsById["cuadro-aurelio"]?.inspectDialogId).toBe("d-cuadro");
    expect(model.objectsById["cuadro-aurelio"]?.inspectConditioned).toBeUndefined();
    expect(model.objectsById["vasijas"]?.inspectDialogId).toBe("d-vasijas");
    expect(model.objectsById["sarcofago"]?.inspectDialogId).toBe("d-sarcofago");
    expect(model.objectsById["mural-ranura"]?.inspectDialogId).toBe("d-ranura");
  });

  it("marca condicionadas las reglas que dependen del estado de la partida", () => {
    const model = loadFixtureModel();
    expect(model.objectsById["brasero"]?.inspectDialogId).toBe("d-brasero");
    expect(model.objectsById["brasero"]?.inspectConditioned).toBe(true);
  });

  it("no inventa inspección para objetos sin regla on_interact con diálogo", () => {
    const model = loadFixtureModel();
    expect(model.objectsById["armario"]?.inspectDialogId).toBeUndefined();
    expect(model.objectsById["armario"]?.inspectPanelPuzzleId).toBeUndefined();
  });

  it("deriva la imagen de inspección de las reglas on_interact + show_image (specs/26 §3.4)", () => {
    const model = loadFixtureModel();
    expect(model.objectsById["cuadro-aurelio"]?.inspectImage).toEqual({ image: "cuadro-rey" });
    expect(model.objectsById["retrato-2"]?.inspectImage).toEqual({
      image: "cuadro-reino-4torres",
    });
    expect(model.objectsById["vasijas"]?.inspectImage).toEqual({ image: "vasijas-8" });
    // Objetos sin `show_image` en su regla no tienen imagen.
    expect(model.objectsById["armario"]?.inspectImage).toBeUndefined();
  });

  it("show_image llega también a InspectionResult.image, junto al diálogo", () => {
    const model = loadFixtureModel();
    const result = inspectObject(model, "cuadro-aurelio");
    expect(result?.image).toEqual({ image: "cuadro-rey" });
    expect(result?.dialog?.text).toContain("Aurelio");
  });

  it("expone los estados declarados y no copia reglas ni acciones crudas", () => {
    const model = loadFixtureModel();
    const cuadro = model.objectsById["cuadro-aurelio"];
    expect(cuadro?.states).toEqual(["closed", "open"]);
    expect(cuadro).not.toHaveProperty("rules");
    expect(JSON.stringify(model.objects)).not.toContain("digito3");
  });
});
