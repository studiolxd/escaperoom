import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { toRuntimeModel, type RuntimeModel } from "../../src/loader";
import { RoomRuntime3D } from "../../src/three";
import type { ScenePlayer } from "../../src/phaser/room-scene";
import type { WorldSceneEvent } from "../../src/phaser/world-events";
import { makeRoom3D } from "../fixtures/room-3d";

// Sin red ni WebGL: la carga del GLB se simula con un espía que falla (se queda la caja).
const instantiateModel = vi.hoisted(() => vi.fn((...args: [url: string]) => Promise.reject(new Error(`sin red: ${args[0]}`))));
vi.mock("../../src/three/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/three/assets")>()),
  instantiateModel,
}));

/** `parent` mínimo: el modo headless no toca el DOM. */
function fakeParent(): HTMLElement {
  return {
    clientWidth: 1280,
    clientHeight: 720,
    appendChild: () => undefined,
    removeChild: () => undefined,
  } as unknown as HTMLElement;
}

function model3D(): RuntimeModel {
  const model = toRuntimeModel(makeRoom3D());
  model.objectsById.arca = { ...model.objectsById.arca!, useItemIds: ["llave"] };
  return model;
}

/** Modelo con una segunda habitación vacía, para los cambios de sala del observador. */
function twoRoomModel(): RuntimeModel {
  const model = model3D();
  model.subroomsById.otra = { ...model.subroomsById.sala!, id: "otra", name: "Otra", objects: [] };
  return model;
}

function player(id: string, roomId: string, extra: Partial<ScenePlayer> = {}): ScenePlayer {
  return { id, name: id, roomId, x: 1, y: 1, tint: "#ff0000", characterId: "", connected: true, ...extra };
}

async function start(options: ConstructorParameters<typeof RoomRuntime3D>[2] = {}) {
  const runtime = new RoomRuntime3D(fakeParent(), model3D(), { headless: true, ...options });
  const events: WorldSceneEvent[] = [];
  runtime.onWorldEvent((e) => events.push(e));
  await runtime.ready;
  // Lejos del arca (2,6 m) para que haga falta caminar.
  runtime.placeAvatar(0.6, 0.6, 0, 0);
  return { runtime, events };
}

/** Avanza hasta que `done` sea cierto (máx. 10 s simulados). */
function run(runtime: RoomRuntime3D, done: () => boolean, dt = 1 / 30): void {
  for (let i = 0; i < 300 && !done(); i++) runtime.tick(dt);
}

describe("RoomRuntime3D (headless)", () => {
  it("rechaza un modelo 2D", () => {
    const model = { ...model3D(), dimension: "2d" } as RuntimeModel;
    expect(() => new RoomRuntime3D(fakeParent(), model, { headless: true })).toThrow(
      "RoomRuntime3D solo admite salas 3D",
    );
  });

  it("tras `ready` coloca el avatar en el spawn de la habitación inicial", async () => {
    const runtime = new RoomRuntime3D(fakeParent(), model3D(), { headless: true });
    expect(runtime.avatarPose).toBeUndefined();
    await runtime.ready;
    expect(runtime.currentRoomId).toBe("sala");
    const pose = runtime.avatarPose!;
    expect(pose.x).toBeCloseTo(1.5, 0);
    expect(pose.y).toBeCloseTo(1.5, 0);
    expect(pose.yaw).toBe(90);
    runtime.destroy();
  });

  it("caminar hacia un objeto acaba emitiendo `interact`", async () => {
    const { runtime, events } = await start();
    const before = runtime.avatarCell!;
    runtime.walkToObject("arca");
    expect(events).toEqual([]); // aún lejos
    run(runtime, () => events.length > 0);
    expect(events).toEqual([{ type: "interact", objectId: "arca" }]);
    const after = runtime.avatarCell!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0.1);
    expect(Math.hypot(2.6 - after.x, 2.2 - after.y)).toBeLessThanOrEqual(1.75 + 0.05);
    runtime.destroy();
  });

  it("con un ítem de `useItemIds` emite `use-item`", async () => {
    const { runtime, events } = await start();
    runtime.walkToObject("arca", "llave");
    run(runtime, () => events.length > 0);
    expect(events).toEqual([{ type: "use-item", itemId: "llave", objectId: "arca" }]);
    runtime.destroy();
  });

  it("con cualquier otro ítem emite igualmente `use-item` (el HUD decide)", async () => {
    const { runtime, events } = await start();
    runtime.walkToObject("arca", "moneda");
    run(runtime, () => events.length > 0);
    expect(events).toEqual([{ type: "use-item", itemId: "moneda", objectId: "arca" }]);
    runtime.destroy();
  });

  it("si ya está junto al objeto emite de inmediato", async () => {
    const { runtime, events } = await start();
    runtime.placeAvatar(1.6, 1.6, 0, 0);
    runtime.walkToObject("arca");
    expect(events).toEqual([{ type: "interact", objectId: "arca" }]);
    runtime.destroy();
  });

  it("`setObjectState(id, \"oculto\")` quita la interactividad", async () => {
    const { runtime, events } = await start();
    expect(runtime.isObjectInteractive("arca")).toBe(true);
    runtime.setObjectState("arca", "oculto");
    expect(runtime.isObjectInteractive("arca")).toBe(false);
    runtime.walkToObject("arca");
    run(runtime, () => false, 1 / 30);
    expect(events).toEqual([]);
    runtime.setObjectState("arca", "closed");
    expect(runtime.isObjectInteractive("arca")).toBe(true);
    runtime.destroy();
  });

  it("un objeto inexistente no es interactivo", async () => {
    const { runtime } = await start();
    expect(runtime.isObjectInteractive("no-existe")).toBe(false);
    runtime.destroy();
  });

  it("`inspectObject` emite `interact`", async () => {
    const { runtime, events } = await start();
    runtime.inspectObject("arca");
    expect(events).toEqual([{ type: "interact", objectId: "arca" }]);
    runtime.destroy();
  });

  it("con `emitAvatarMoves`, caminar emite `avatar-move` con `h` y `yaw`, uno cada 100 ms como mucho", async () => {
    const { runtime, events } = await start({ emitAvatarMoves: true });
    runtime.walkTo({ x: 1.6, y: 1.6, h: 0 });
    const dt = 1 / 60;
    const stamps: number[] = [];
    let clock = 0;
    let seen = 0;
    for (let i = 0; i < 120; i++) {
      runtime.tick(dt);
      clock += dt * 1000;
      while (seen < events.length) {
        stamps.push(clock);
        seen++;
      }
    }
    const moves = events.filter((e) => e.type === "avatar-move");
    expect(moves.length).toBeGreaterThan(2);
    for (const move of moves) {
      expect(move).toMatchObject({ type: "avatar-move", roomId: "sala" });
      expect(typeof (move as { h?: number }).h).toBe("number");
      expect(typeof (move as { yaw?: number }).yaw).toBe("number");
    }
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(100 - 1e-6);
    }
    // Yaw: iba hacia +x/+y, no se queda en 0.
    expect((moves.at(-1) as { yaw: number }).yaw).toBeGreaterThan(0);
    runtime.destroy();
  });

  it("sin `emitAvatarMoves` no emite `avatar-move`", async () => {
    const { runtime, events } = await start();
    runtime.walkTo({ x: 1.6, y: 1.6, h: 0 });
    run(runtime, () => false);
    expect(events).toEqual([]);
    runtime.destroy();
  });

  it("con la entrada desactivada no hay movimiento ni interacción", async () => {
    const { runtime, events } = await start({ inputEnabled: false });
    const before = runtime.avatarCell!;
    runtime.walkToObject("arca");
    run(runtime, () => false);
    expect(runtime.avatarCell).toEqual(before);
    expect(events).toEqual([]);
    runtime.destroy();
  });

  it("`showRoom` de una habitación inexistente lanza", async () => {
    const { runtime } = await start();
    expect(() => runtime.showRoom("no-existe")).toThrow();
    runtime.destroy();
  });

  it("`showRoom` reconstruye la sala y llama a `onBuilt`", async () => {
    const { runtime } = await start();
    let built = false;
    runtime.showRoom("sala", () => {
      built = true;
    });
    await runtime.ready;
    await Promise.resolve();
    expect(built).toBe(true);
    expect(runtime.avatarPose!.x).toBeCloseTo(1.5, 0);
    runtime.destroy();
  });

  it("`getObjectScreenFraction` da una fracción dentro del lienzo o `undefined`", async () => {
    const { runtime } = await start();
    runtime.placeAvatar(1.5, 1.5, 0, 90); // mira a +x, hacia el arca
    runtime.tick(0.5);
    const f = runtime.getObjectScreenFraction("arca");
    expect(f).toBeDefined();
    expect(f!.x).toBeGreaterThanOrEqual(0);
    expect(f!.x).toBeLessThanOrEqual(1);
    expect(f!.y).toBeGreaterThanOrEqual(0);
    expect(f!.y).toBeLessThanOrEqual(1);
    expect(runtime.getObjectScreenFraction("no-existe")).toBeUndefined();
    runtime.destroy();
  });

  it("pinta a los remotos de la sala visible y conectados", async () => {
    const { runtime } = await start();
    runtime.setPlayers([
      { id: "p1", name: "A", roomId: "sala", x: 1, y: 1, tint: "#ff0000", characterId: "", connected: true },
      { id: "p2", name: "B", roomId: "otra", x: 1, y: 1, tint: "#00ff00", characterId: "", connected: true },
      { id: "p3", name: "C", roomId: "sala", x: 1, y: 1, tint: "#0000ff", characterId: "", connected: false },
    ]);
    runtime.tick(0.1);
    runtime.setPlayers([]);
    runtime.tick(0.1);
    runtime.destroy();
  });

  it("`destroy` es idempotente", async () => {
    const { runtime } = await start();
    runtime.destroy();
    expect(() => runtime.destroy()).not.toThrow();
  });

  describe("walkTo", () => {
    it("llama a `onArrive` al llegar y devuelve `true`", async () => {
      const { runtime } = await start();
      let arrived = 0;
      expect(runtime.walkTo({ x: 1.6, y: 1.6, h: 0 }, () => arrived++)).toBe(true);
      expect(arrived).toBe(0);
      run(runtime, () => arrived > 0);
      expect(arrived).toBe(1);
      const cell = runtime.avatarCell!;
      expect(Math.hypot(cell.x - 1.6, cell.y - 1.6)).toBeLessThan(0.2);
      run(runtime, () => false);
      expect(arrived).toBe(1);
      runtime.destroy();
    });

    it("una segunda llamada cancela la primera sin llamar a su `onArrive`", async () => {
      const { runtime } = await start();
      const calls: string[] = [];
      runtime.walkTo({ x: 1.6, y: 1.6, h: 0 }, () => calls.push("a"));
      runtime.tick(0.1);
      runtime.walkTo({ x: 0.6, y: 1.6, h: 0 }, () => calls.push("b"));
      run(runtime, () => calls.length > 0);
      run(runtime, () => false);
      expect(calls).toEqual(["b"]);
      runtime.destroy();
    });

    it("`placeAvatar` y el joystick cancelan la ruta sin llamar a `onArrive`", async () => {
      const { runtime } = await start();
      const calls: string[] = [];
      runtime.walkTo({ x: 1.6, y: 1.6, h: 0 }, () => calls.push("a"));
      runtime.placeAvatar(0.6, 0.6, 0, 0);
      run(runtime, () => false);
      runtime.walkTo({ x: 1.6, y: 1.6, h: 0 }, () => calls.push("b"));
      runtime.setMoveVector({ x: 0, y: 1 });
      runtime.tick(0.05);
      runtime.setMoveVector(null);
      run(runtime, () => false);
      expect(calls).toEqual([]);
      runtime.destroy();
    });

    it("sin ruta devuelve `false` y llama a `onArrive` de inmediato", async () => {
      const { runtime } = await start();
      let arrived = 0;
      // Fuera de la navmesh (la sala mide 2×2 m de suelo) y muy por encima.
      expect(runtime.walkTo({ x: 40, y: 40, h: 20 }, () => arrived++)).toBe(false);
      expect(arrived).toBe(1);
      expect(runtime.walkTo({ x: 40, y: 40 })).toBe(false);
      runtime.destroy();
    });

    it("sin `h` usa la altura actual del avatar", async () => {
      const { runtime } = await start();
      let arrived = false;
      expect(runtime.walkTo({ x: 1.6, y: 1.6 }, () => (arrived = true))).toBe(true);
      run(runtime, () => arrived);
      expect(arrived).toBe(true);
      runtime.destroy();
    });
  });

  describe("setMoveVector", () => {
    it("avanza hacia donde mira la cámara, emite `avatar-move` y `null` lo detiene", async () => {
      const { runtime, events } = await start({ emitAvatarMoves: true });
      // La cámara parte detrás del avatar del spawn (yaw 90 → mira a +x): arriba = +x.
      const before = runtime.avatarCell!;
      runtime.setMoveVector({ x: 0, y: 1 });
      for (let i = 0; i < 6; i++) runtime.tick(1 / 30);
      const moved = runtime.avatarCell!;
      expect(moved.x - before.x).toBeGreaterThan(0.3);
      // La cámara se recoloca al girar el avatar hacia el spawn, así que el rumbo se curva un poco.
      expect(Math.abs(moved.y - before.y)).toBeLessThan(0.15);
      expect(events.some((e) => e.type === "avatar-move")).toBe(true);

      runtime.setMoveVector(null);
      const stopped = runtime.avatarCell!;
      for (let i = 0; i < 10; i++) runtime.tick(1 / 30);
      expect(runtime.avatarCell).toEqual(stopped);
      runtime.destroy();
    });

    it("con W pulsado 5 s el yaw converge (la cámara no realimenta el giro)", async () => {
      const { runtime } = await start();
      runtime.setMoveVector({ x: 0, y: 1 });
      const yaws: number[] = [];
      for (let i = 0; i < 150; i++) {
        runtime.tick(1 / 30);
        yaws.push(runtime.avatarPose!.yaw);
      }
      const diff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
      expect(diff(yaws[149]!, yaws[120]!)).toBeLessThan(0.5);
      expect(diff(yaws[149]!, yaws[148]!)).toBeLessThan(0.05);
      runtime.destroy();
    });

    it("la velocidad es WALK_SPEED × módulo, con un mínimo de 0,3", async () => {
      const dist = async (v: { x: number; y: number }) => {
        const { runtime } = await start();
        const before = runtime.avatarCell!;
        runtime.setMoveVector(v);
        runtime.tick(0.1);
        const after = runtime.avatarCell!;
        runtime.destroy();
        return Math.hypot(after.x - before.x, after.y - before.y);
      };
      const full = await dist({ x: 0, y: 1 });
      expect(await dist({ x: 0, y: 0.5 })).toBeCloseTo(full * 0.5, 2);
      expect(await dist({ x: 0, y: 0.1 })).toBeCloseTo(full * 0.3, 2);
    });

    it("cancela la ruta y el objetivo pendiente", async () => {
      const { runtime, events } = await start();
      runtime.walkToObject("arca");
      runtime.setMoveVector({ x: 0, y: -1 });
      for (let i = 0; i < 3; i++) runtime.tick(1 / 30);
      runtime.setMoveVector(null);
      run(runtime, () => false);
      expect(events).toEqual([]);
      runtime.destroy();
    });
  });

  describe("resaltado por proximidad", () => {
    it("`onHighlightChange` avisa al acercarse y al alejarse; `interactHighlighted` emite `interact`", async () => {
      const { runtime, events } = await start();
      const seen: (string | undefined)[] = [];
      const off = runtime.onHighlightChange((id) => seen.push(id));
      runtime.tick(0.1);
      expect(runtime.highlightedObjectId).toBeUndefined();
      expect(runtime.interactHighlighted()).toBe(false);
      expect(events).toEqual([]);

      runtime.placeAvatar(1.5, 1.5, 0, 90); // mira al arca
      runtime.tick(0.1);
      runtime.tick(0.1);
      expect(runtime.highlightedObjectId).toBe("arca");
      expect(seen).toEqual(["arca"]);

      expect(runtime.interactHighlighted()).toBe(true);
      expect(events).toEqual([{ type: "interact", objectId: "arca" }]);

      runtime.placeAvatar(0.6, 0.6, 0, 0);
      runtime.tick(0.1);
      expect(runtime.highlightedObjectId).toBeUndefined();
      expect(seen).toEqual(["arca", undefined]);

      off();
      runtime.placeAvatar(1.5, 1.5, 0, 90);
      runtime.tick(0.1);
      expect(seen).toEqual(["arca", undefined]);
      runtime.destroy();
    });
  });

  describe("contorno visual", () => {
    // Estado privado: se lee/escribe por cast solo en este test (el puntero real no existe en headless).
    type Internals = {
      world: { outlined: ReadonlySet<string> };
      pointer: { x: number; y: number } | undefined;
      pickObject: () => string | undefined;
    };

    it("la proximidad cambia `highlightedObjectId` sin añadir contorno; el hover sí", async () => {
      const { runtime } = await start();
      const inner = runtime as unknown as Internals;
      runtime.placeAvatar(1.5, 1.5, 0, 90); // mira al arca
      runtime.tick(0.1);
      runtime.tick(0.1);
      expect(runtime.highlightedObjectId).toBe("arca");
      expect([...inner.world.outlined]).toEqual([]);

      inner.pointer = { x: 0, y: 0 };
      inner.pickObject = () => "arca";
      runtime.tick(0.1);
      expect([...inner.world.outlined]).toEqual(["arca"]);
      runtime.destroy();
    });
  });

  describe("colisión y oclusión de la cámara", () => {
    // Estado privado leído por cast: la cámara y el mundo no tienen API pública en headless.
    type Internals = {
      camera: THREE.PerspectiveCamera;
      rig: { focus: THREE.Vector3 };
      world: { objects: Map<string, { slot: { occlusion: number } }> };
    };
    const catalog = {
      packId: "test",
      version: "1",
      avatars: {},
      models: {
        "muro-test": {
          file: "models/muro.glb",
          category: "muro",
          label: { es: "Muro" },
          size: { w: 1, d: 1, hgt: 2 },
          colliders: [{ type: "box", cx: 0, cy: 0, ch: 1, sx: 1, sy: 1, sh: 2 }],
          snap: true,
          clips: [],
        },
      },
    } as unknown as NonNullable<ConstructorParameters<typeof RoomRuntime3D>[2]>["catalog"];

    async function startWith(obstacle: "none" | "mueble" | "muro", at?: THREE.Vector3) {
      const model = model3D();
      const room = model.subroomsById.sala!;
      const arca = model.objectsById.arca!;
      if (obstacle === "mueble" && at) {
        arca.transform = { x: at.x, y: at.z, h: at.y - 0.3, yaw: 0 };
      } else {
        arca.transform = { x: 3.4, y: 3.4, h: 0, yaw: 0 };
      }
      room.objects = [arca];
      if (obstacle === "muro" && at) {
        room.pieces = [...room.pieces, { id: "p-muro0001", model: "muro-test", x: at.x, y: at.z, h: at.y - 1, yaw: 0 }];
      }
      const runtime = new RoomRuntime3D(fakeParent(), model, { headless: true, catalog });
      await runtime.ready;
      runtime.placeAvatar(1.5, 1.5, 0, 0);
      for (let i = 0; i < 90; i++) runtime.tick(1 / 30);
      return { runtime, inner: runtime as unknown as Internals };
    }
    const gap = (i: Internals) => i.camera.position.distanceTo(i.rig.focus);

    it("un mueble entre cámara y jugador no acorta la cámara, se vuelve translúcido y se recupera", async () => {
      const free = await startWith("none");
      const mid = free.inner.rig.focus.clone().lerp(free.inner.camera.position, 0.5);
      const freeGap = gap(free.inner);
      free.runtime.destroy();

      const { runtime, inner } = await startWith("mueble", mid);
      expect(gap(inner)).toBeCloseTo(freeGap, 1);
      expect(inner.world.objects.get("arca")!.slot.occlusion).toBeCloseTo(0.3, 5);

      // Apartado el mueble, vuelve a opacidad 1.
      runtime.setObjectState("arca", "closed");
      const entry = inner.world.objects.get("arca")! as unknown as { slot: { occlusion: number; holder: THREE.Object3D } };
      entry.slot.holder.position.set(3.4, 0, 3.4);
      for (let i = 0; i < 30; i++) runtime.tick(1 / 30);
      expect(entry.slot.occlusion).toBe(1);
      runtime.destroy();
    });

    it("un muro entre cámara y jugador sí acorta la cámara", async () => {
      const free = await startWith("none");
      const mid = free.inner.rig.focus.clone().lerp(free.inner.camera.position, 0.5);
      const freeGap = gap(free.inner);
      free.runtime.destroy();

      const { runtime, inner } = await startWith("muro", mid);
      expect(gap(inner)).toBeLessThan(freeGap - 1);
      runtime.destroy();
    });
  });

  describe("observador", () => {
    async function startObserver(model = twoRoomModel()) {
      const runtime = new RoomRuntime3D(fakeParent(), model, { headless: true, observer: true });
      const events: WorldSceneEvent[] = [];
      runtime.onWorldEvent((e) => events.push(e));
      await runtime.ready;
      return { runtime, events };
    }

    it("no tiene avatar ni entrada de juego", async () => {
      const { runtime, events } = await startObserver();
      expect(runtime.avatarPose).toBeUndefined();
      expect(runtime.avatarCell).toBeUndefined();
      runtime.placeAvatar(1, 1, 0, 0);
      expect(runtime.avatarPose).toBeUndefined();
      expect(runtime.walkTo({ x: 1, y: 1, h: 0 })).toBe(false);
      runtime.walkToObject("arca");
      expect(runtime.dropItemAt("llave", 10, 10)).toBeUndefined();
      expect(runtime.interactHighlighted()).toBe(false);
      for (let i = 0; i < 30; i++) runtime.tick(1 / 30);
      expect(runtime.highlightedObjectId).toBeUndefined();
      expect(events).toEqual([]);
      runtime.destroy();
    });

    it("empieza en cámara libre en la habitación inicial", async () => {
      const { runtime } = await startObserver();
      expect(runtime.observerCamera).toEqual({ type: "free" });
      expect(runtime.currentRoomId).toBe("sala");
      runtime.destroy();
    });

    it("`follow` de un jugador que cambia de habitación hace `showRoom` y avisa", async () => {
      const { runtime } = await startObserver();
      const rooms: string[] = [];
      runtime.onObserverRoomChange((r) => rooms.push(r));
      runtime.setPlayers([player("p1", "sala")]);
      runtime.setObserverCamera({ type: "follow", playerId: "p1" });
      expect(runtime.observerCamera).toEqual({ type: "follow", playerId: "p1" });
      expect(rooms).toEqual([]);

      runtime.setPlayers([player("p1", "otra")]);
      runtime.setPlayers([player("p1", "otra")]); // no repite el aviso mientras carga
      expect(rooms).toEqual(["otra"]);
      await runtime.ready;
      await Promise.resolve();
      expect(runtime.currentRoomId).toBe("otra");
      expect(runtime.observerCamera.type).toBe("follow");
      runtime.tick(0.1);
      runtime.destroy();
    });

    it("si el jugador seguido se va o se desconecta, pasa a `free` en la habitación actual", async () => {
      const { runtime } = await startObserver();
      runtime.setPlayers([player("p1", "sala"), player("p2", "sala")]);
      runtime.setObserverCamera({ type: "follow", playerId: "p1" });
      runtime.tick(0.1);
      runtime.setPlayers([player("p1", "sala", { connected: false }), player("p2", "sala")]);
      expect(runtime.observerCamera).toEqual({ type: "free" });

      runtime.setObserverCamera({ type: "follow", playerId: "p2" });
      expect(runtime.observerCamera.type).toBe("follow");
      runtime.setPlayers([]);
      expect(runtime.observerCamera).toEqual({ type: "free" });
      expect(runtime.currentRoomId).toBe("sala");
      runtime.destroy();
    });

    it("seguir a un jugador desconocido deja la cámara libre", async () => {
      const { runtime } = await startObserver();
      runtime.setObserverCamera({ type: "follow", playerId: "nadie" });
      expect(runtime.observerCamera).toEqual({ type: "free" });
      runtime.destroy();
    });

    it("`free` con `roomId` cambia de habitación sin avisar a `onObserverRoomChange`", async () => {
      const { runtime } = await startObserver();
      const rooms: string[] = [];
      runtime.onObserverRoomChange((r) => rooms.push(r));
      runtime.setObserverCamera({ type: "free", roomId: "otra" });
      await runtime.ready;
      await Promise.resolve();
      expect(runtime.currentRoomId).toBe("otra");
      expect(runtime.observerCamera).toEqual({ type: "free", roomId: "otra" });
      expect(rooms).toEqual([]);
      runtime.destroy();
    });

    it("pinta a todos los jugadores de la sala visible, también al local", async () => {
      const { runtime } = await startObserver();
      const scene = (runtime as unknown as { scene: THREE.Scene }).scene;
      const count = () => scene.children.length;
      const base = count();
      runtime.setPlayers([player("p0", "sala"), player("p1", "sala"), player("p2", "otra")]);
      expect(count()).toBe(base + 2);
      runtime.destroy();
    });

    it("`setMoveVector` mueve la cámara libre", async () => {
      const { runtime } = await startObserver();
      const camera = (runtime as unknown as { camera: THREE.PerspectiveCamera }).camera;
      runtime.tick(0.1);
      const before = camera.position.clone();
      runtime.setMoveVector({ x: 0, y: 1 });
      for (let i = 0; i < 6; i++) runtime.tick(1 / 30);
      runtime.setMoveVector(null);
      expect(camera.position.distanceTo(before)).toBeGreaterThan(0.5);
      runtime.destroy();
    });
  });

  describe("calidad", () => {
    it("empieza en alta; `setQuality(\"low\")` la cambia y avisa una vez", async () => {
      const { runtime } = await start();
      const seen: string[] = [];
      runtime.onQualityChange((q) => seen.push(q));
      expect(runtime.quality).toBe("high");
      runtime.setQuality("low");
      runtime.setQuality("low");
      expect(runtime.quality).toBe("low");
      expect(seen).toEqual(["low"]);
      runtime.setQuality("auto");
      expect(runtime.quality).toBe("high");
      expect(seen).toEqual(["low", "high"]);
      runtime.destroy();
    });

    it("en automático baja sola con FPS bajos, una vez y sin subir", async () => {
      const { runtime } = await start();
      const seen: string[] = [];
      runtime.onQualityChange((q) => seen.push(q));
      for (let i = 0; i < 100; i++) runtime.tick(1 / 20); // 5 s: aún dentro de los 2 s de silencio + ventana
      expect(runtime.quality).toBe("high");
      for (let i = 0; i < 100; i++) runtime.tick(1 / 20);
      expect(runtime.quality).toBe("low");
      for (let i = 0; i < 200; i++) runtime.tick(1 / 60);
      expect(runtime.quality).toBe("low");
      expect(seen).toEqual(["low"]);
      runtime.destroy();
    });

    it("con una calidad fijada no baja sola", async () => {
      const { runtime } = await start();
      runtime.setQuality("high");
      for (let i = 0; i < 400; i++) runtime.tick(1 / 20);
      expect(runtime.quality).toBe("high");
      runtime.destroy();
    });

    it("no muestrea durante los 2 s siguientes a un `showRoom`", async () => {
      const { runtime } = await start();
      for (let i = 0; i < 20; i++) runtime.tick(1 / 20); // 1 s, dentro del silencio inicial
      runtime.showRoom("sala");
      await runtime.ready;
      await Promise.resolve();
      // 5 s a 20 FPS justo después: los 2 s de silencio retrasan el aviso.
      for (let i = 0; i < 100; i++) runtime.tick(1 / 20);
      expect(runtime.quality).toBe("high");
      for (let i = 0; i < 60; i++) runtime.tick(1 / 20);
      expect(runtime.quality).toBe("low");
      runtime.destroy();
    });
  });

  it("la altura visual solo se recalcula si el personaje se mueve más de 0,05 m en planta", async () => {
    const { runtime } = await start();
    runtime.tick(0.1);
    const spy = vi.spyOn(THREE.Raycaster.prototype, "intersectObject");
    const downward = () =>
      spy.mock.contexts.filter((r) => (r as THREE.Raycaster).ray.direction.y === -1).length;
    for (let i = 0; i < 30; i++) runtime.tick(1 / 30);
    expect(downward()).toBe(0);
    runtime.setMoveVector({ x: 0, y: 1 });
    for (let i = 0; i < 6; i++) runtime.tick(1 / 30);
    runtime.setMoveVector(null);
    expect(downward()).toBeGreaterThan(0);
    spy.mockRestore();
    runtime.destroy();
  });

  describe("refreshCustomModels", () => {
    it("pide la URL de los modelos propios que antes no la tenían y no recarga los que ya la tienen", async () => {
      instantiateModel.mockReset();
      instantiateModel.mockRejectedValue(new Error("sin red"));
      const urls = new Map<string, string>([["upload:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "https://x/arca.glb"]]);
      const resolveCustomModelUrl = vi.fn((ref: string) => urls.get(ref));
      const { runtime } = await start({ resolveCustomModelUrl });
      // Solo el arca tiene URL; el suelo se pinta como caja.
      expect(instantiateModel.mock.calls.map((c) => c[0])).toEqual(["https://x/arca.glb"]);

      runtime.refreshCustomModels();
      expect(instantiateModel).toHaveBeenCalledTimes(1);

      urls.set("upload:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "https://x/suelo.glb");
      runtime.refreshCustomModels();
      const requested = instantiateModel.mock.calls.map((c) => c[0]);
      expect(requested.filter((u) => u === "https://x/suelo.glb")).toHaveLength(4);
      expect(requested.filter((u) => u === "https://x/arca.glb")).toHaveLength(1);
      runtime.destroy();
    });
  });
});
