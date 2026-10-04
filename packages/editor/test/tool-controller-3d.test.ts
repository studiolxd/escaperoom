import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  Edit3DController,
  deleteRule,
  listLights,
  listPieces3D,
  listSpawnPoints3D,
  readObject,
  roomDocToPackage,
  roomPackageToDoc,
  setSpawnPoints3D,
  type Pointer3D,
} from "../src";
import { makeRoom3D } from "./fixtures/room-3d";

function setup() {
  const doc = roomPackageToDoc(makeRoom3D());
  const controller = new Edit3DController(doc, { roomId: "sala" });
  return { doc, controller };
}

const ev = (type: Pointer3D["type"], x: number, y: number, extra: Partial<Pointer3D> = {}): Pointer3D => ({
  type,
  point: { x, y, h: 0 },
  target: { kind: "none" },
  shiftKey: false,
  altKey: false,
  ...extra,
});

const pieces = (doc: Y.Doc) => listPieces3D(doc, "sala");

describe("Edit3DController — colocar", () => {
  it("el imán ajusta al centro de celda y usa la altura de trabajo; Alt lo desactiva", () => {
    const { doc, controller } = setup();
    controller.setWorkHeight(0.4);
    controller.selectModel("muro-test", "piece", true);
    controller.pointer(ev("down", 2.8, 3.1));
    controller.pointer(ev("up", 2.8, 3.1));
    expect(pieces(doc).at(-1)).toMatchObject({ model: "muro-test", x: 2.5, y: 3.5, h: 0.4 });
    controller.pointer(ev("down", 3.3, 0.2, { altKey: true }));
    controller.pointer(ev("up", 3.3, 0.2));
    expect(pieces(doc).at(-1)).toMatchObject({ x: 3.3, y: 0.2, h: 0.4 });
    expect(controller.getState().error).toBeUndefined();
  });

  it("una pieza con snap:false o con el imán global apagado se coloca tal cual", () => {
    const { doc, controller } = setup();
    controller.selectModel("a", "piece", false);
    controller.pointer(ev("down", 2.8, 3.1));
    controller.pointer(ev("up", 2.8, 3.1));
    expect(pieces(doc).at(-1)).toMatchObject({ x: 2.8, y: 3.1 });
    controller.setSnapEnabled(false);
    controller.selectModel("b", "piece", true);
    controller.pointer(ev("down", 1.7, 2.9));
    controller.pointer(ev("up", 1.7, 2.9));
    expect(pieces(doc).at(-1)).toMatchObject({ model: "b", x: 1.7, y: 2.9 });
  });

  it("move actualiza el fantasma (con el giro) y sin punto lo quita", () => {
    const { controller } = setup();
    controller.selectModel("muro-test", "piece", true);
    controller.rotatePlacement();
    controller.pointer(ev("move", 1.2, 1.9));
    expect(controller.getState().ghost).toEqual({ model: "muro-test", x: 1.5, y: 1.5, h: 0, yaw: 90 });
    controller.pointer(ev("move", 0, 0, { point: null }));
    expect(controller.getState().ghost).toBeUndefined();
  });

  it("rotatePlacement da la vuelta a 360", () => {
    const { controller } = setup();
    for (let i = 0; i < 4; i += 1) controller.rotatePlacement();
    expect(controller.getState().placeYaw).toBe(0);
  });

  it("un trazo coloca una pieza por celda nueva y no repite", () => {
    const { doc, controller } = setup();
    controller.selectModel("muro-test", "piece", true);
    const before = pieces(doc).length;
    controller.pointer(ev("down", 2.2, 2.2));
    controller.pointer(ev("move", 2.4, 2.3)); // misma celda
    controller.pointer(ev("move", 3.2, 2.3));
    controller.pointer(ev("move", 2.2, 2.2)); // vuelve a la primera
    controller.pointer(ev("up", 3.2, 2.3));
    expect(pieces(doc).length - before).toBe(2);
    // Un trazo nuevo sobre una celda ya ocupada por el mismo modelo se salta.
    controller.pointer(ev("down", 2.2, 2.2));
    controller.pointer(ev("up", 2.2, 2.2));
    expect(pieces(doc).length - before).toBe(2);
    // Sin `down`, los `move` no colocan nada.
    controller.pointer(ev("move", 0.2, 3.2));
    expect(pieces(doc).length - before).toBe(2);
  });

  it("colocar un objeto lo selecciona y vuelve a select", () => {
    const { doc, controller } = setup();
    controller.selectModel("arca-test", "object", false);
    controller.pointer(ev("click", 1.4, 3.1));
    const state = controller.getState();
    expect(state.tool).toBe("select");
    const id = state.lastPlacedObjectId!;
    expect(state.selection).toEqual([{ kind: "object", id }]);
    expect(readObject(doc, id)).toMatchObject({
      sprite: "arca-test",
      type: "decorativo",
      interactable: true,
      transform: { x: 1.4, y: 3.1, h: 0, yaw: 0 },
    });
  });
});

describe("Edit3DController — seleccionar", () => {
  const piece = { kind: "piece", id: "p-suelo000" } as const;
  const object = { kind: "object", id: "arca" } as const;

  it("clic selecciona; Mayús añade o quita; clic en nada vacía", () => {
    const { controller } = setup();
    controller.pointer(ev("click", 0, 0, { target: piece }));
    expect(controller.getState().selection).toEqual([piece]);
    controller.pointer(ev("click", 0, 0, { target: object, shiftKey: true }));
    expect(controller.getState().selection).toEqual([piece, object]);
    controller.pointer(ev("click", 0, 0, { target: piece, shiftKey: true }));
    expect(controller.getState().selection).toEqual([object]);
    controller.pointer(ev("click", 0, 0, { target: { kind: "torch", index: 1 } }));
    controller.pointer(ev("click", 0, 0, { target: { kind: "torch", index: 1 }, shiftKey: true }));
    expect(controller.getState().selection).toEqual([]);
    controller.select([piece, object]);
    controller.pointer(ev("click", 0, 0));
    expect(controller.getState().selection).toEqual([]);
  });

  it("setRoom limpia selección y fantasma", () => {
    const { controller } = setup();
    controller.select([piece]);
    controller.setRoom("otra");
    expect(controller.getState()).toMatchObject({ roomId: "otra", selection: [] });
  });
});

describe("Edit3DController — spawn y antorcha", () => {
  it("spawn: ids libres, yaw de colocación, imán y tope de 8", () => {
    const { doc, controller } = setup();
    controller.setTool("spawn");
    controller.rotatePlacement();
    controller.pointer(ev("click", 2.7, 0.3));
    expect(listSpawnPoints3D(doc, "sala")).toContainEqual({ id: "spawn-2", x: 2.5, y: 0.5, h: 0, yaw: 90 });
    for (let i = 0; i < 6; i += 1) controller.pointer(ev("click", 0.5, 3.5));
    expect(listSpawnPoints3D(doc, "sala")).toHaveLength(8);
    expect(controller.getState().error).toBeUndefined();
    controller.pointer(ev("click", 0.5, 3.5));
    expect(listSpawnPoints3D(doc, "sala")).toHaveLength(8);
    expect(controller.getState().error?.code).toBe("INVALID_VALUE");
  });

  it("spawn rellena el primer id libre", () => {
    const { doc, controller } = setup();
    setSpawnPoints3D(doc, "sala", [{ id: "spawn-2", x: 1, y: 1, h: 0, yaw: 0 }]);
    controller.setTool("spawn");
    controller.pointer(ev("click", 1, 1));
    expect(listSpawnPoints3D(doc, "sala").map((s) => s.id)).toEqual(["spawn-2", "spawn-1"]);
  });

  it("torch: antorcha en (x, y) a workHeight + 1.6", () => {
    const { doc, controller } = setup();
    controller.setTool("torch");
    controller.setWorkHeight(0.4);
    controller.pointer(ev("click", 1.3, 2.2));
    expect(listLights(doc, "sala").at(-1)).toEqual({ type: "torch", x: 1.3, y: 2.2, h: 2 });
  });
});

describe("Edit3DController — transform, borrar, duplicar", () => {
  it("transform final escribe en el doc; no final no", () => {
    const { doc, controller } = setup();
    const change = { kind: "object", id: "arca", x: 1, y: 1, h: 0, yaw: 90 } as const;
    controller.transform([change], false);
    expect(readObject(doc, "arca")?.transform).toMatchObject({ x: 2.6 });
    controller.transform([change], true);
    expect(readObject(doc, "arca")?.transform).toMatchObject({ x: 1, y: 1, yaw: 90 });
  });

  it("deleteSelection borra de todo tipo en una transacción", () => {
    const { doc, controller } = setup();
    deleteRule(doc, "r-fin");
    controller.setTool("torch");
    controller.pointer(ev("click", 1, 1));
    controller.setTool("select");
    controller.select([
      { kind: "piece", id: "p-suelo000" },
      { kind: "object", id: "arca" },
      { kind: "torch", index: 1 },
    ]);
    let transactions = 0;
    doc.on("afterTransaction", () => (transactions += 1));
    controller.deleteSelection();
    expect(transactions).toBe(1);
    expect(pieces(doc)).toHaveLength(3);
    expect(readObject(doc, "arca")).toBeUndefined();
    expect(listLights(doc, "sala")).toHaveLength(1);
    expect(controller.getState().selection).toEqual([]);
  });

  it("borra antorchas de mayor a menor índice", () => {
    const { doc, controller } = setup();
    controller.setTool("torch");
    controller.pointer(ev("click", 1, 1));
    controller.pointer(ev("click", 2, 2));
    controller.select([
      { kind: "torch", index: 1 },
      { kind: "torch", index: 2 },
    ]);
    controller.deleteSelection();
    expect(listLights(doc, "sala")).toEqual([{ type: "ambient", color: "#ffffff", intensity: 1 }]);
  });

  it("un objeto referenciado no se borra y no se borra nada más", () => {
    const { doc, controller } = setup();
    controller.select([
      { kind: "piece", id: "p-suelo000" },
      { kind: "object", id: "arca" },
    ]);
    controller.deleteSelection();
    expect(controller.getState().error?.code).toBe("REFERENCED_ID");
    expect(readObject(doc, "arca")).toBeDefined();
    expect(pieces(doc)).toHaveLength(4);
    expect(controller.getState().selection).toHaveLength(2);
  });

  it("nunca deja la habitación sin puntos de aparición", () => {
    const { doc, controller } = setup();
    controller.select([
      { kind: "spawn", id: "spawn-1" },
      { kind: "piece", id: "p-suelo000" },
    ]);
    controller.deleteSelection();
    expect(controller.getState().error?.code).toBe("INVALID_VALUE");
    expect(listSpawnPoints3D(doc, "sala")).toHaveLength(1);
    expect(pieces(doc)).toHaveLength(4);
    // Con otro spawn sí se puede.
    controller.setTool("spawn");
    controller.pointer(ev("click", 3, 3));
    controller.select([{ kind: "spawn", id: "spawn-1" }]);
    controller.deleteSelection();
    expect(listSpawnPoints3D(doc, "sala").map((s) => s.id)).toEqual(["spawn-2"]);
  });

  it("duplicateSelection desplaza (1, 0, 0) y selecciona las copias", () => {
    const { doc, controller } = setup();
    controller.select([
      { kind: "piece", id: "p-suelo000" },
      { kind: "object", id: "arca" },
      { kind: "spawn", id: "spawn-1" },
    ]);
    controller.duplicateSelection();
    const selection = controller.getState().selection;
    expect(selection).toHaveLength(2);
    expect(selection.map((t) => t.kind)).toEqual(["piece", "object"]);
    expect(pieces(doc)).toHaveLength(5);
    const objectTarget = selection[1]!;
    expect(readObject(doc, (objectTarget as { id: string }).id)?.transform).toMatchObject({ x: 3.6, y: 2.2 });
  });
});

describe("Edit3DController — errores y estado", () => {
  it("los errores de comando acaban en state.error y no se propagan", () => {
    const { doc, controller } = setup();
    controller.selectModel("muro-test", "piece", false);
    expect(() => controller.pointer(ev("down", 9, 9))).not.toThrow();
    expect(controller.getState().error?.code).toBe("OUT_OF_BOUNDS");
    expect(pieces(doc)).toHaveLength(4);
    controller.clearError();
    expect(controller.getState().error).toBeUndefined();
    controller.transform([{ kind: "piece", id: "nope", x: 1, y: 1, h: 0, yaw: 0 }], true);
    expect(controller.getState().error?.code).toBe("UNKNOWN_PIECE");
  });

  it("setWorkHeight redondea a 0.2 y acota", () => {
    const { controller } = setup();
    controller.setWorkHeight(0.31);
    expect(controller.getState().workHeight).toBe(0.4);
    controller.setWorkHeight(-3);
    expect(controller.getState().workHeight).toBe(0);
    controller.setWorkHeight(99);
    expect(controller.getState().workHeight).toBe(32);
  });

  it("notifica a los suscriptores", () => {
    const { controller } = setup();
    let calls = 0;
    const off = controller.subscribe(() => (calls += 1));
    controller.setGizmoMode("rotate");
    expect(calls).toBe(1);
    off();
    controller.setGizmoMode("scale");
    expect(calls).toBe(1);
  });
});
