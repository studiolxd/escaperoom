import { describe, expect, it } from "vitest";
import { toRuntimeModel, type RuntimeModel } from "../../src/loader";
import { RoomRuntime3D } from "../../src/three";
import type { WorldSceneEvent } from "../../src/phaser/world-events";
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

function model3D(): RuntimeModel {
  const model = toRuntimeModel(makeRoom3D());
  model.objectsById.arca = { ...model.objectsById.arca!, useItemIds: ["llave"] };
  return model;
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

  it("con otro ítem emite `interact-direct`", async () => {
    const { runtime, events } = await start();
    runtime.walkToObject("arca", "moneda");
    run(runtime, () => events.length > 0);
    expect(events).toEqual([{ type: "interact-direct", objectId: "arca" }]);
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
});
