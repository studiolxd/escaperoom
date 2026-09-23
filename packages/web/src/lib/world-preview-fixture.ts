/**
 * `RoomPackage` mínimo para la previsualización del sistema de objetos (ticket
 * 1.3). No sustituye al fixture canónico del Rey Aldric: es una sala de demo que
 * ejercita lo que 1.3 añade — estados con animación, brillo/inspección,
 * diálogos es/en con fallback y un objeto con inventario interno
 * (`distribution`) y un panel asociado.
 *
 * Vive solo en el servidor: el Server Component de la ruta lo valida con el
 * loader puro y proyecta el modelo para el cliente.
 */

const COLS = 10;
const ROWS = 8;

/** RLE fila-major a partir de una rejilla de ids de tile. */
function rleFromGrid(grid: number[][]): number[] {
  const rle: number[] = [];
  for (const row of grid) {
    for (const tileId of row) {
      if (rle.length > 0 && rle[rle.length - 2] === tileId) {
        rle[rle.length - 1] = (rle[rle.length - 1] ?? 0) + 1;
      } else {
        rle.push(1, tileId);
      }
    }
  }
  return rle;
}

function groundLayer(): number[] {
  return rleFromGrid(Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 1)));
}

function wallsLayer(): number[] {
  const grid = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) =>
      x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 10 : 0,
    ),
  );
  return rleFromGrid(grid);
}

export function worldPreviewPackage(): unknown {
  return {
    meta: {
      id: "room-world-preview",
      title: "Objetos interactuables (demo 1.3)",
      authorId: "org-escaperoom",
      version: "1.0.0",
      packageFormat: "roompackage/v1",
      theme: "medieval",
      description:
        "Sala de demo: pasa el cursor por los objetos para ver el brillo, pulsa Espacio o clic para inspeccionar y abre el cofre para ver su inventario interno.",
      languages: ["es", "en"],
      defaultLanguage: "es",
      estimatedMinutes: 5,
      difficulty: 1,
      players: { min: 1, max: 4 },
      assetsManifest: "r2://assets/packs/world-preview/manifest.json",
    },
    map: {
      tileset: "world-preview",
      rooms: [
        {
          id: "sala-demo",
          name: "Sala de demo",
          grid: { cols: COLS, rows: ROWS },
          layers: [
            { name: "ground", rle: groundLayer() },
            { name: "walls", rle: wallsLayer() },
          ],
          decorations: [
            { sprite: "alfombra", x: 4, y: 4 },
            { sprite: "estandarte", x: 1, y: 1 },
          ],
          spawnPoints: [
            { id: "spawn-1", x: 3, y: 4 },
            { id: "spawn-2", x: 4, y: 3 },
            { id: "spawn-3", x: 5, y: 4 },
            { id: "spawn-4", x: 4, y: 5 },
          ],
          lighting: [
            { type: "ambient", color: "#101827", intensity: 0.45 },
            { type: "torch", x: 3, y: 6, objectId: "brasero" },
          ],
        },
      ],
    },
    objects: [
      {
        id: "cuadro",
        roomId: "sala-demo",
        type: "escondite",
        position: { x: 2, y: 1 },
        sprite: "cuadro-rey",
        states: { closed: "cuadro-rey", open: "cuadro-rey-torcido" },
        initialState: "closed",
        interactable: true,
        hidingSpot: { contains: "llave-bronce" },
      },
      {
        id: "cofre",
        roomId: "sala-demo",
        type: "cajon",
        position: { x: 7, y: 2 },
        sprite: "cofre-cerrado",
        states: {
          closed: "cofre-cerrado",
          open: { sprite: "cofre-abierto", animation: "slide_up" },
        },
        initialState: "closed",
        interactable: true,
        inventory: ["llave-bronce", "moneda", "antorcha"],
        distribution: "first_click",
      },
      {
        id: "palanca",
        roomId: "sala-demo",
        type: "mecanismo",
        position: { x: 7, y: 5 },
        sprite: "palanca",
        states: { off: "palanca", on: "palanca-on" },
        initialState: "off",
        interactable: true,
      },
      {
        id: "brasero",
        roomId: "sala-demo",
        type: "mecanismo",
        position: { x: 3, y: 6 },
        sprite: "brasero-apagado",
        states: { unlit: "brasero-apagado", lit: "brasero-encendido" },
        initialState: "unlit",
        interactable: true,
      },
      {
        id: "trono",
        roomId: "sala-demo",
        type: "decorativo",
        position: { x: 4, y: 1 },
        sprite: "trono",
        states: {},
        initialState: "",
        interactable: false,
      },
    ],
    items: [
      {
        id: "llave-bronce",
        name: { es: { text: "Llave de bronce" }, en: { text: "Bronze key" } },
        icon: "icon-llave-bronce",
      },
      {
        id: "moneda",
        name: { es: { text: "Moneda antigua" }, en: { text: "Ancient coin" } },
        icon: "icon-moneda",
      },
      {
        id: "antorcha",
        name: { es: { text: "Antorcha encendida" }, en: { text: "Lit torch" } },
        icon: "icon-antorcha",
      },
    ],
    puzzles: [
      {
        id: "p-palanca",
        type: "code_lock",
        layer: "panel",
        roomId: "sala-demo",
        requiresSolved: [],
        grantsItems: [],
        unlocks: [],
        length: 4,
        code: "4732",
        maxAttempts: 5,
        lockoutSec: 30,
      },
    ],
    rules: [
      {
        id: "r-inspeccionar-cuadro",
        priority: 0,
        once: false,
        trigger: { type: "on_interact", objectId: "cuadro" },
        conditions: [],
        actions: [{ type: "show_dialog", dialogId: "d-cuadro" }],
      },
      {
        id: "r-inspeccionar-cofre",
        priority: 0,
        once: false,
        trigger: { type: "on_interact", objectId: "cofre" },
        conditions: [],
        actions: [{ type: "show_dialog", dialogId: "d-cofre" }],
      },
      {
        id: "r-palanca",
        priority: 0,
        once: false,
        trigger: { type: "on_interact", objectId: "palanca" },
        conditions: [],
        actions: [
          { type: "show_dialog", dialogId: "d-palanca" },
          { type: "open_panel_puzzle", puzzleId: "p-palanca" },
        ],
      },
      {
        id: "r-encender-brasero",
        priority: 0,
        once: false,
        trigger: { type: "on_interact", objectId: "brasero" },
        conditions: [{ type: "item_in_inventory", itemId: "antorcha", consumed: true }],
        actions: [
          { type: "set_object_state", objectId: "brasero", state: "lit" },
          { type: "show_dialog", dialogId: "d-brasero" },
        ],
      },
    ],
    dialogs: [
      {
        id: "d-cuadro",
        text: {
          es: { text: "El retrato del Rey Aurelio. El cuadro cruje ligeramente…" },
          en: { text: "The portrait of King Aurelius. The frame creaks softly…" },
        },
      },
      {
        id: "d-cofre",
        text: {
          es: { text: "Un cofre de roble con refuerzos de hierro." },
          en: { text: "An oak chest bound with iron." },
        },
      },
      {
        id: "d-palanca",
        text: {
          es: { text: "Una palanca oxidada con cuatro muescas." },
          en: { text: "A rusted lever with four notches." },
        },
      },
      {
        id: "d-brasero",
        text: { es: { text: "El brasero arde: entre las llamas se insinúa el número 3." } },
      },
    ],
    hints: [],
  };
}
