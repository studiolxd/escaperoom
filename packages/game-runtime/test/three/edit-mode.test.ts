import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { toRuntimeModel, type RuntimeModel } from "../../src/loader";
import { RoomRuntime3D, type EditPointer3D, type TransformChange3D } from "../../src/three";
import type { RoomWorld } from "../../src/three/world";
import { makeRoom3D } from "../fixtures/room-3d";

/** `parent` mínimo: el modo headless no toca el DOM. */
function fakeParent(): HTMLElement {
  return {
    clientWidth: 1280,
    clientHeight: 720,
    appendChild: () => undefined,
    removeChild: () => undefined,
  } as unknown as HTMLElement;
}

type Piece = RuntimeModel["subrooms"][number]["pieces"][number];

/** Mismo modelo con las piezas de la habitación `sala` sustituidas. */
function withPieces(model: RuntimeModel, pieces: Piece[]): RuntimeModel {
  const room = { ...model.subroomsById.sala!, pieces };
  return {
    ...model,
    subrooms: model.subrooms.map((r) => (r.id === "sala" ? room : r)),
    subroomsById: { ...model.subroomsById, sala: room },
  };
}

async function start(model = toRuntimeModel(makeRoom3D())) {
  const runtime = new RoomRuntime3D(fakeParent(), model, { headless: true, mode: "edit" });
  await runtime.ready;
  return { runtime, model };
}

const internals = (runtime: RoomRuntime3D) =>
  runtime as unknown as {
    world: RoomWorld;
    camera: THREE.PerspectiveCamera;
    editLayer: { navmeshOverlay: THREE.Object3D | undefined; group: THREE.Group };
  };

/** Coordenadas normalizadas de un punto del mundo (Three). */
function ndcOf(runtime: RoomRuntime3D, x: number, y: number, z: number): { x: number; y: number } {
  const camera = internals(runtime).camera;
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(x, y, z).project(camera);
  return { x: p.x, y: p.y };
}

function collect(runtime: RoomRuntime3D) {
  const events: EditPointer3D[] = [];
  runtime.onEditEvent((e) => events.push(e));
  return events;
}

function transforms(runtime: RoomRuntime3D) {
  const calls: { changes: readonly TransformChange3D[]; final: boolean }[] = [];
  runtime.onTransform((changes, final) => calls.push({ changes, final }));
  return calls;
}

describe("RoomRuntime3D en modo edición (headless)", () => {
  describe("diferencias con el modo juego", () => {
    it("no crea avatar y los métodos de juego no hacen nada", async () => {
      const { runtime } = await start();
      expect(runtime.avatarPose).toBeUndefined();
      expect(runtime.avatarCell).toBeUndefined();
      expect(runtime.walkTo({ x: 1, y: 1 })).toBe(false);
      runtime.placeAvatar(1, 1, 0, 0);
      expect(runtime.avatarPose).toBeUndefined();
      runtime.walkToObject("arca");
      expect(runtime.interactHighlighted()).toBe(false);
      expect(runtime.dropItemAt("llave", 10, 10)).toBeUndefined();
      runtime.setPlayers([
        { id: "p1", name: "p1", roomId: "sala", x: 1, y: 1, tint: "#fff", characterId: "", connected: true },
      ]);
      runtime.setObserverCamera({ type: "free" });
      expect(runtime.observerCamera).toEqual({ type: "free" });
      runtime.destroy();
    });

    it("`observer` con `mode: \"edit\"` lanza", () => {
      expect(
        () =>
          new RoomRuntime3D(fakeParent(), toRuntimeModel(makeRoom3D()), {
            headless: true,
            mode: "edit",
            observer: true,
          }),
      ).toThrow(/observer/);
    });

    it("la calidad queda fija en alta", async () => {
      const { runtime } = await start();
      runtime.setQuality("low");
      expect(runtime.quality).toBe("high");
      runtime.destroy();
    });

    it("los objetos en estado `oculto` se pintan al 40 % de opacidad", async () => {
      const model = toRuntimeModel(makeRoom3D());
      const arca = {
        ...model.objectsById.arca!,
        states: ["closed", "oculto"],
        spriteByState: { closed: "arca-test", oculto: "arca-test" },
        initialState: "oculto",
      };
      model.objectsById.arca = arca;
      model.subroomsById.sala!.objects = [arca];
      model.objects = [arca];
      const { runtime } = await start(model);
      const entry = internals(runtime).world.objects.get("arca")!;
      expect(entry.slot.holder.visible).toBe(true);
      const material = entry.slot.meshes()[0]!.material as THREE.Material;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeCloseTo(0.4);
      runtime.destroy();
    });

    it("los métodos de edición no existen fuera del modo edición", async () => {
      const runtime = new RoomRuntime3D(fakeParent(), toRuntimeModel(makeRoom3D()), { headless: true });
      await runtime.ready;
      expect(() => runtime.setModel(toRuntimeModel(makeRoom3D()))).toThrow(/mode: "edit"/);
      expect(() => runtime.simulatePointer("click", 0, 0)).toThrow(/mode: "edit"/);
      // Los que son un simple ajuste no hacen nada.
      runtime.setSelection([{ kind: "object", id: "arca" }]);
      runtime.setGizmoMode("translate");
      runtime.destroy();
    });
  });

  describe("setModel incremental", () => {
    it("añadir una pieza crea un objeto de escena y no recrea los demás", async () => {
      const { runtime, model } = await start();
      const world = internals(runtime).world;
      const before = new Map([...world.pieces].map(([id, e]) => [id, e.slot.holder]));
      const arcaBefore = world.objects.get("arca")!.slot.holder;
      const children = world.group.children.length;

      const extra: Piece = { id: "p-nueva0001", model: "suelo-test", x: 2.5, y: 0.5, h: 0, yaw: 0 };
      runtime.setModel(withPieces(model, [...model.subroomsById.sala!.pieces, extra]));

      expect(internals(runtime).world).toBe(world);
      expect(world.group.children.length).toBe(children + 1);
      expect(world.pieces.size).toBe(before.size + 1);
      for (const [id, holder] of before) expect(world.pieces.get(id)!.slot.holder).toBe(holder);
      expect(world.objects.get("arca")!.slot.holder).toBe(arcaBefore);
      const added = world.pieces.get("p-nueva0001")!.slot.holder;
      expect(added.parent).toBe(world.group);
      expect(added.position.x).toBeCloseTo(2.5);
      runtime.destroy();
    });

    it("mover una pieza actualiza su posición, giro y escala", async () => {
      const { runtime, model } = await start();
      const world = internals(runtime).world;
      const holder = world.pieces.get("p-suelo000")!.slot.holder;
      const moved = model.subroomsById.sala!.pieces.map((p) =>
        p.id === "p-suelo000" ? { ...p, x: 3.5, y: 2.5, h: 0.4, yaw: 90, scale: 2 } : p,
      );
      runtime.setModel(withPieces(model, moved));
      expect(world.pieces.get("p-suelo000")!.slot.holder).toBe(holder);
      expect(holder.position.x).toBeCloseTo(3.5);
      expect(holder.position.z).toBeCloseTo(2.5);
      expect(holder.position.y).toBeCloseTo(0.4);
      expect(holder.rotation.y).toBeCloseTo(Math.PI / 2);
      expect(holder.scale.x).toBeCloseTo(2);
      runtime.destroy();
    });

    it("cambiar el modelo de una pieza sustituye su contenido, no su contenedor", async () => {
      const { runtime, model } = await start();
      const world = internals(runtime).world;
      const slot = world.pieces.get("p-suelo000")!.slot;
      const holder = slot.holder;
      const swapped = model.subroomsById.sala!.pieces.map((p) =>
        p.id === "p-suelo000" ? { ...p, model: "arca-test" } : p,
      );
      runtime.setModel(withPieces(model, swapped));
      expect(slot.holder).toBe(holder);
      expect(slot.modelId).toBe("arca-test");
      runtime.destroy();
    });

    it("quitar una pieza la elimina de la escena", async () => {
      const { runtime, model } = await start();
      const world = internals(runtime).world;
      const holder = world.pieces.get("p-suelo001")!.slot.holder;
      runtime.setModel(withPieces(model, model.subroomsById.sala!.pieces.filter((p) => p.id !== "p-suelo001")));
      expect(world.pieces.has("p-suelo001")).toBe(false);
      expect(holder.parent).toBeNull();
      runtime.destroy();
    });

    it("un objeto movido o retirado se actualiza igual", async () => {
      const { runtime, model } = await start();
      const world = internals(runtime).world;
      const holder = world.objects.get("arca")!.slot.holder;
      const arca = { ...model.objectsById.arca!, transform: { x: 1, y: 3, h: 0.2, yaw: 90 } };
      const room = { ...model.subroomsById.sala!, objects: [arca] };
      const next: RuntimeModel = {
        ...model,
        subrooms: [room],
        subroomsById: { sala: room },
        objectsById: { arca },
      };
      runtime.setModel(next);
      expect(holder.position.x).toBeCloseTo(1);
      expect(holder.position.z).toBeCloseTo(3);
      expect(holder.position.y).toBeCloseTo(0.2);

      const emptyRoom = { ...room, objects: [] };
      runtime.setModel({ ...next, subrooms: [emptyRoom], subroomsById: { sala: emptyRoom }, objectsById: {} });
      expect(world.objects.size).toBe(0);
      expect(holder.parent).toBeNull();
      runtime.destroy();
    });

    it("si la habitación visible deja de existir, pasa a la primera", async () => {
      const { runtime, model } = await start();
      const otra = { ...model.subroomsById.sala!, id: "otra", name: "Otra", objects: [] };
      const next: RuntimeModel = {
        ...model,
        initialRoomId: "otra",
        subrooms: [otra],
        subroomsById: { otra },
        objects: [],
        objectsById: {},
      };
      runtime.setModel(next);
      expect(runtime.currentRoomId).toBe("otra");
      runtime.destroy();
    });

    it("cambiar las medidas o las luces reconstruye rejilla y luces", async () => {
      const { runtime, model } = await start();
      const layer = internals(runtime).editLayer;
      const gridCount = () => layer.group.children.filter((c) => c.type === "Group").length;
      const room = model.subroomsById.sala!;
      const bigger = {
        ...room,
        width: 8,
        height: 6,
        lighting: [...room.lighting, { type: "torch" as const, x: 1, y: 1, h: 1.2 }],
      };
      runtime.setModel({
        ...model,
        subrooms: [bigger],
        subroomsById: { sala: bigger },
      });
      expect(gridCount()).toBeGreaterThan(0);
      const torches = layer.group.children.filter((c) => c.userData.editTarget?.kind === "torch");
      expect(torches).toHaveLength(1);
      expect(torches[0]!.position.y).toBeCloseTo(1.2);
      runtime.destroy();
    });
  });

  describe("selección y fantasma", () => {
    it("no lanzan con ids inexistentes", async () => {
      const { runtime } = await start();
      expect(() =>
        runtime.setSelection([
          { kind: "piece", id: "p-noexiste" },
          { kind: "object", id: "nada" },
          { kind: "spawn", id: "x" },
          { kind: "torch", index: 99 },
          { kind: "none" },
        ]),
      ).not.toThrow();
      expect(() =>
        runtime.setGhost({ model: "modelo-que-no-existe", x: 1, y: 1, h: 0, yaw: 0 }),
      ).not.toThrow();
      expect(() => runtime.setGhost(null)).not.toThrow();
      expect(() => runtime.setSelection([])).not.toThrow();
      runtime.destroy();
    });

    it("el fantasma no entra en el picking", async () => {
      const { runtime } = await start();
      const events = collect(runtime);
      runtime.setGhost({ model: "suelo-test", x: 3.5, y: 0.5, h: 0, yaw: 0 });
      const at = ndcOf(runtime, 3.5, 0.05, 0.5);
      runtime.simulatePointer("click", at.x, at.y);
      expect(events[0]!.target).toEqual({ kind: "none" });
      runtime.destroy();
    });

    it("la selección contornea la pieza y la quita al vaciarla", async () => {
      const { runtime } = await start();
      const slot = internals(runtime).world.pieces.get("p-suelo000")!.slot;
      const outlines = () =>
        slot.meshes().flatMap((m) => m.children.filter((c) => c.userData.editOutline));
      runtime.setSelection([{ kind: "piece", id: "p-suelo000" }]);
      expect(outlines()).toHaveLength(1);
      runtime.setSelection([]);
      expect(outlines()).toHaveLength(0);
      runtime.destroy();
    });
  });

  describe("puntero", () => {
    it("un clic sobre el centro de un objeto da `target.kind === \"object\"`", async () => {
      const { runtime } = await start();
      const events = collect(runtime);
      const f = runtime.getObjectScreenFraction("arca")!;
      runtime.simulatePointer("click", f.x * 2 - 1, 1 - f.y * 2, { shiftKey: true });
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("click");
      expect(events[0]!.target).toEqual({ kind: "object", id: "arca" });
      expect(events[0]!.shiftKey).toBe(true);
      expect(events[0]!.button).toBe(0);
      runtime.destroy();
    });

    it("sobre una pieza da `piece` y sobre el suelo vacío da `none` con el punto del plano", async () => {
      const { runtime } = await start();
      const events = collect(runtime);
      const onPiece = ndcOf(runtime, 0.5, 0.05, 0.5);
      runtime.simulatePointer("down", onPiece.x, onPiece.y);
      expect(events[0]!.type).toBe("down");
      expect(events[0]!.target).toEqual({ kind: "piece", id: "p-suelo000" });

      const empty = ndcOf(runtime, 3.5, 0, 0.5);
      runtime.simulatePointer("click", empty.x, empty.y);
      const e = events[1]!;
      expect(e.target).toEqual({ kind: "none" });
      expect(e.point).not.toBeNull();
      expect(e.point!.x).toBeCloseTo(3.5, 3);
      expect(e.point!.y).toBeCloseTo(0.5, 3);
      expect(e.point!.h).toBe(0);
      runtime.destroy();
    });

    it("un rayo que no corta el plano da `point: null`", async () => {
      const { runtime } = await start();
      const events = collect(runtime);
      // La cámara mira al cielo: ningún rayo corta el plano de trabajo.
      const camera = internals(runtime).camera;
      camera.position.set(2, 0.5, 2);
      camera.lookAt(2, 3, 2);
      camera.updateMatrixWorld();
      runtime.simulatePointer("move", 0, 0);
      expect(events[0]!.type).toBe("move");
      expect(events[0]!.point).toBeNull();
      runtime.destroy();
    });

    it("también devuelve spawns y antorchas", async () => {
      const model = toRuntimeModel(makeRoom3D());
      const sala = model.subroomsById.sala!;
      const room = {
        ...sala,
        // Fuera de las piezas de suelo (las cajas de los modelos propios tapan el disco).
        spawns: sala.spawns.map((s) => ({ ...s, x: 3.5, y: 1.5 })),
        lighting: [...sala.lighting, { type: "torch" as const, x: 3.5, y: 3.5, h: 1.6 }],
      };
      const { runtime } = await start({ ...model, subrooms: [room], subroomsById: { sala: room } });
      const events = collect(runtime);
      const spawn = ndcOf(runtime, 3.5, 0.03, 1.5);
      runtime.simulatePointer("click", spawn.x, spawn.y);
      expect(events[0]!.target).toEqual({ kind: "spawn", id: "spawn-1" });
      const torch = ndcOf(runtime, 3.5, 1.6, 3.5);
      runtime.simulatePointer("click", torch.x, torch.y);
      expect(events[1]!.target).toEqual({ kind: "torch", index: 1 });
      runtime.destroy();
    });

    it("`setWorkHeight(1)` mueve el plano de picking", async () => {
      const { runtime } = await start();
      const events = collect(runtime);
      const at = ndcOf(runtime, 3.5, 0, 0.5);
      runtime.simulatePointer("click", at.x, at.y);
      runtime.setWorkHeight(1);
      expect(runtime.workHeight).toBe(1);
      runtime.simulatePointer("click", at.x, at.y);
      expect(events[0]!.point!.h).toBe(0);
      expect(events[1]!.point!.h).toBe(1);
      expect(Math.hypot(events[1]!.point!.x - 3.5, events[1]!.point!.y - 0.5)).toBeGreaterThan(0.1);
      runtime.destroy();
    });

    it("el suscriptor deja de recibir al darse de baja", async () => {
      const { runtime } = await start();
      const seen: string[] = [];
      const off = runtime.onEditEvent((e) => seen.push(e.type));
      runtime.simulatePointer("move", 0, 0);
      off();
      runtime.simulatePointer("move", 0, 0);
      expect(seen).toEqual(["move"]);
      runtime.destroy();
    });
  });

  describe("gizmos (applyGizmoDelta)", () => {
    const arcaTarget = { kind: "object", id: "arca" } as const;

    it("el imán de 1 m redondea el incremento", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.setSelection([arcaTarget]);
      runtime.setSnap({ move: 1, yaw: 0 });
      runtime.applyGizmoDelta({ dx: 0.6, dy: 0.4, dh: 0.2 });
      const c = calls.at(-1)!.changes[0]!;
      expect(c.target).toEqual(arcaTarget);
      expect(c.x).toBeCloseTo(3.6);
      expect(c.y).toBeCloseTo(2.2);
      expect(c.h).toBeCloseTo(0);
      expect(calls.at(-1)!.final).toBe(false);
      runtime.destroy();
    });

    it("sin imán (0) el movimiento es libre", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.setSelection([arcaTarget]);
      runtime.setSnap({ move: 0, yaw: 0 });
      runtime.applyGizmoDelta({ dx: 0.3, dh: 0.25 });
      const c = calls.at(-1)!.changes[0]!;
      expect(c.x).toBeCloseTo(2.9);
      expect(c.h).toBeCloseTo(0.25);
      runtime.destroy();
    });

    it("el imán de giro redondea y `yaw` se normaliza a [0, 360)", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.setSelection([arcaTarget]);
      runtime.setSnap({ move: 0, yaw: 15 });
      runtime.applyGizmoDelta({ dyaw: 200 }, true); // 180 + 195 (200 → 195) = 375 → 15
      expect(calls.at(-1)!.changes[0]!.yaw).toBeCloseTo(15);
      runtime.applyGizmoDelta({ dyaw: -400 }, true); // 15 − 405 = −390 → 330
      const yaw = calls.at(-1)!.changes[0]!.yaw;
      expect(yaw).toBeGreaterThanOrEqual(0);
      expect(yaw).toBeLessThan(360);
      expect(yaw).toBeCloseTo(330);
      runtime.destroy();
    });

    it("el gesto se cierra con `final: true` y el siguiente parte de la vista actual", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.setSelection([arcaTarget]);
      runtime.applyGizmoDelta({ dx: 0.5 });
      runtime.applyGizmoDelta({ dx: 0.7 });
      runtime.applyGizmoDelta({ dx: 0.7 }, true);
      expect(calls.map((c) => c.final)).toEqual([false, false, true]);
      // Son incrementos sobre el inicio del gesto, no acumulados.
      expect(calls.at(-1)!.changes[0]!.x).toBeCloseTo(3.3);
      runtime.applyGizmoDelta({ dx: 0.2 }, true);
      expect(calls.at(-1)!.changes[0]!.x).toBeCloseTo(3.5);
      runtime.destroy();
    });

    it("la vista se actualiza en local, sin esperar a `setModel`; manda el modelo después", async () => {
      const { runtime, model } = await start();
      const holder = internals(runtime).world.objects.get("arca")!.slot.holder;
      runtime.setSelection([arcaTarget]);
      runtime.applyGizmoDelta({ dx: 1 }, true);
      expect(holder.position.x).toBeCloseTo(3.6);
      runtime.setModel(model); // el modelo conserva x = 2,6
      expect(holder.position.x).toBeCloseTo(2.6);
      runtime.destroy();
    });

    it("la selección múltiple gira alrededor del pivote", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.setSelection([
        { kind: "piece", id: "p-suelo000" }, // (0,5, 0,5)
        { kind: "piece", id: "p-suelo003" }, // (1,5, 1,5) → pivote (1, 1)
      ]);
      runtime.setSnap({ move: 0, yaw: 0 });
      runtime.applyGizmoDelta({ dyaw: 90 }, true);
      const [a, b] = calls.at(-1)!.changes;
      expect(a!.x).toBeCloseTo(0.5);
      expect(a!.y).toBeCloseTo(1.5);
      expect(b!.x).toBeCloseTo(1.5);
      expect(b!.y).toBeCloseTo(0.5);
      expect(a!.yaw).toBeCloseTo(90);
      expect(b!.yaw).toBeCloseTo(90);
      runtime.destroy();
    });

    it("al mover varios, todos se desplazan lo mismo", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.setSelection([
        { kind: "piece", id: "p-suelo000" },
        { kind: "piece", id: "p-suelo003" },
      ]);
      runtime.setSnap({ move: 1, yaw: 0 });
      runtime.applyGizmoDelta({ dx: 1.2, dy: 1 }, true);
      const [a, b] = calls.at(-1)!.changes;
      expect(a!.x).toBeCloseTo(1.5);
      expect(a!.y).toBeCloseTo(1.5);
      expect(b!.x).toBeCloseTo(2.5);
      expect(b!.y).toBeCloseTo(2.5);
      runtime.destroy();
    });

    it("escalar es sobre cada uno y se limita a [0,1, 10]", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.setSelection([arcaTarget, { kind: "piece", id: "p-suelo000" }]);
      runtime.applyGizmoDelta({ dscale: 2 }, true);
      const [a, p] = calls.at(-1)!.changes;
      expect(a!.scale).toBeCloseTo(2);
      expect(p!.scale).toBeCloseTo(2);
      expect(a!.x).toBeCloseTo(2.6); // no se mueven
      runtime.applyGizmoDelta({ dscale: 1000 }, true);
      expect(calls.at(-1)!.changes[0]!.scale).toBe(10);
      runtime.applyGizmoDelta({ dscale: 0.0001 }, true);
      expect(calls.at(-1)!.changes[0]!.scale).toBe(0.1);
      runtime.destroy();
    });

    it("`x`, `y` quedan dentro de la habitación y `h` no baja de 0", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.setSelection([arcaTarget]);
      runtime.applyGizmoDelta({ dx: 100, dy: -100, dh: -5 }, true);
      let c = calls.at(-1)!.changes[0]!;
      expect(c.x).toBe(4);
      expect(c.y).toBe(0);
      expect(c.h).toBe(0);
      runtime.applyGizmoDelta({ dx: -100, dy: 100 }, true);
      c = calls.at(-1)!.changes[0]!;
      expect(c.x).toBe(0);
      expect(c.y).toBe(4);
      runtime.destroy();
    });

    it("los spawns mueven y giran; las antorchas solo se mueven", async () => {
      const model = toRuntimeModel(makeRoom3D());
      const room = {
        ...model.subroomsById.sala!,
        lighting: [...model.subroomsById.sala!.lighting, { type: "torch" as const, x: 3, y: 3, h: 1.6 }],
      };
      const { runtime } = await start({ ...model, subrooms: [room], subroomsById: { sala: room } });
      const calls = transforms(runtime);
      runtime.setSelection([
        { kind: "spawn", id: "spawn-1" },
        { kind: "torch", index: 1 },
      ]);
      runtime.setSnap({ move: 0, yaw: 0 });
      runtime.applyGizmoDelta({ dx: 0.5, dyaw: 45, dscale: 3 }, true);
      const [spawn, torch] = calls.at(-1)!.changes;
      expect(spawn!.yaw).toBeCloseTo(135); // 90 + 45
      expect(spawn!.scale).toBe(1);
      expect(torch!.yaw).toBe(0);
      expect(torch!.scale).toBe(1);
      expect(torch!.h).toBeCloseTo(1.6);
      runtime.destroy();
    });

    it("sin selección no emite nada", async () => {
      const { runtime } = await start();
      const calls = transforms(runtime);
      runtime.applyGizmoDelta({ dx: 1 }, true);
      expect(calls).toHaveLength(0);
      runtime.destroy();
    });

    it("`applyGizmoDelta` y `simulatePointer` solo existen en headless", async () => {
      // Sin `headless` habría que montar WebGL: basta comprobar el mensaje con el modelo ya listo.
      const { runtime } = await start();
      const proto = runtime as unknown as { headless: boolean };
      proto.headless = false;
      expect(() => runtime.applyGizmoDelta({ dx: 1 })).toThrow(/headless/);
      expect(() => runtime.simulatePointer("click", 0, 0)).toThrow(/headless/);
      proto.headless = true;
      runtime.destroy();
    });
  });

  describe("navmesh visible", () => {
    it("se dibuja al activarla, se regenera tras un cambio y se quita al ocultarla", async () => {
      const { runtime, model } = await start();
      const layer = internals(runtime).editLayer;
      expect(layer.navmeshOverlay).toBeUndefined();
      runtime.setNavmeshVisible(true);
      await runtime.flushNavmesh();
      const first = layer.navmeshOverlay!;
      expect(first).toBeDefined();
      expect(first.children.length).toBe(2); // malla + aristas
      expect(first.position.y).toBeCloseTo(0.03);
      const fill = first.children[0] as THREE.Mesh;
      expect((fill.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.35);

      const extra: Piece = { id: "p-nueva0002", model: "suelo-test", x: 2.5, y: 0.5, h: 0, yaw: 0 };
      runtime.setModel(withPieces(model, [...model.subroomsById.sala!.pieces, extra]));
      await runtime.flushNavmesh();
      const second = layer.navmeshOverlay!;
      expect(second).toBeDefined();
      expect(second).not.toBe(first);

      runtime.setNavmeshVisible(false);
      expect(layer.navmeshOverlay).toBeUndefined();
      runtime.destroy();
    });
  });

  it("destroy es idempotente y retira la capa de edición de la escena", async () => {
    const { runtime } = await start();
    const layer = internals(runtime).editLayer;
    runtime.destroy();
    expect(layer.group.parent).toBeNull();
    expect(() => runtime.destroy()).not.toThrow();
  });
});
