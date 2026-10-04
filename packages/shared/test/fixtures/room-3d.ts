import { parseRoomPackage, type RoomPackage } from "../../src/schemas";

/**
 * Paquete 3D mínimo para los tests del modo 3D (encargo 7.1a): una habitación
 * de 4×4 m, cuatro piezas de suelo, un objeto con `transform`, un spawn con
 * `h` y `yaw`, sin puzles. Los modelos son propios (`world3d.models`), así
 * que no dependen del catálogo del pack (todavía vacío).
 */
export function makeRoom3D(): RoomPackage {
  return parseRoomPackage({
    meta: {
      id: "room-3d-minima",
      title: "Sala 3D mínima",
      authorId: "autora",
      version: "1.0.0",
      packageFormat: "roompackage/v1",
      theme: "medieval",
      description: "Sala de prueba del modo 3D",
      languages: ["es"],
      defaultLanguage: "es",
      estimatedMinutes: 2,
      timeLimitMinutes: 10,
      difficulty: 1,
      players: { min: 1, max: 1 },
      assetsManifest: "r2://assets/packs/medieval-v1/manifest.json",
      dimension: "3d",
    },
    map: {
      tileset: "medieval-v1",
      rooms: [
        {
          id: "sala",
          name: "Sala",
          grid: { cols: 4, rows: 4 },
          layers: [],
          decorations: [],
          spawnPoints: [{ id: "spawn-1", x: 1.5, y: 1.5, h: 0, yaw: 90 }],
          lighting: [{ type: "ambient", color: "#ffffff", intensity: 1 }],
        },
      ],
    },
    objects: [
      {
        id: "arca",
        roomId: "sala",
        type: "arca",
        position: { x: 3, y: 2 },
        transform: { x: 2.6, y: 2.2, h: 0, yaw: 180 },
        sprite: "arca-test",
        states: { closed: "arca-test" },
        initialState: "closed",
        interactable: true,
      },
    ],
    items: [],
    puzzles: [],
    rules: [
      {
        id: "r-fin",
        priority: 10,
        once: true,
        trigger: { type: "on_interact", objectId: "arca" },
        conditions: [],
        actions: [{ type: "end_game", result: "victory" }],
      },
    ],
    dialogs: [],
    hints: [],
    world3d: {
      rooms: {
        sala: {
          pieces: [
            { id: "p-suelo000", model: "suelo-test", x: 0.5, y: 0.5, h: 0, yaw: 0 },
            { id: "p-suelo001", model: "suelo-test", x: 1.5, y: 0.5, h: 0, yaw: 0 },
            { id: "p-suelo002", model: "suelo-test", x: 0.5, y: 1.5, h: 0, yaw: 0 },
            { id: "p-suelo003", model: "suelo-test", x: 1.5, y: 1.5, h: 0, yaw: 0 },
          ],
        },
      },
      models: {
        "suelo-test": {
          ref: "upload:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          label: "Suelo de prueba",
          size: { w: 1, d: 1, hgt: 0.1 },
          colliders: [{ type: "box", cx: 0, cy: 0, ch: -0.05, sx: 1, sy: 1, sh: 0.1 }],
          clips: [],
        },
        "arca-test": {
          ref: "upload:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "Arca de prueba",
          size: { w: 1, d: 0.6, hgt: 0.6 },
          colliders: [{ type: "box", cx: 0, cy: 0, ch: 0.3, sx: 1, sy: 0.6, sh: 0.6 }],
          clips: ["abrir"],
        },
      },
    },
  });
}
