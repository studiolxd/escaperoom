import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  EditToolController,
  RoomDocError,
  addRoomLanguage,
  createRule,
  decodeRle,
  docToRoomPackage,
  roomDocToPackage,
  encodeRowRle,
  ensureLocalizedField,
  eraseTiles,
  fillTiles,
  getTile,
  initRoomDoc,
  lineCells,
  moveObject,
  observeRoomDoc,
  paintTiles,
  placeObject,
  proposeObjectId,
  readObject,
  removeObject,
  renameObject,
  roomPackageToDoc,
  setLocalizedValue,
} from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture: RoomPackage = parseRoomPackage(
  JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
);

function aldricDoc(): Y.Doc {
  return roomPackageToDoc(fixture);
}

/** Réplica por updates binarios (lo que viaja por el WebSocket de edición). */
function replicate(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

function layerTiles(pkg: RoomPackage, roomId: string, layer: string): number[] {
  const room = pkg.map.rooms.find((r) => r.id === roomId);
  const rle = room?.layers.find((l) => l.name === layer)?.rle ?? [];
  return decodeRle(rle, (room?.grid.cols ?? 0) * (room?.grid.rows ?? 0));
}

describe("RLE por filas", () => {
  it("codifica sin que una racha cruce el final de fila y decodifica a la misma rejilla", () => {
    const tiles = [1, 1, 1, 1, 2, 2, 0, 0, 0];
    const rle = encodeRowRle(tiles, 3);
    expect(rle).toEqual([3, 1, 1, 1, 2, 2, 3, 0]);
    expect(decodeRle(rle, 9)).toEqual(tiles);
  });

  it("reproduce exactamente el RLE de todas las capas del fixture", () => {
    for (const room of fixture.map.rooms) {
      for (const layer of room.layers) {
        const tiles = decodeRle(layer.rle, room.grid.cols * room.grid.rows);
        expect(encodeRowRle(tiles, room.grid.cols)).toEqual(layer.rle);
      }
    }
  });
});

describe("RoomPackage ⇄ doc Yjs — ida y vuelta", () => {
  it("el fixture del Rey Aldric sale idéntico del doc (sin pérdida)", () => {
    const pkg = roomDocToPackage(aldricDoc());
    expect(pkg).toEqual(fixture);
    // Y sigue cumpliendo el contrato.
    expect(parseRoomPackage(pkg)).toEqual(fixture);
  });

  it("conserva el orden de los arrays y el RLE byte a byte", () => {
    const pkg = roomDocToPackage(aldricDoc());
    expect(JSON.stringify(pkg.map)).toBe(JSON.stringify(fixture.map));
    expect(pkg.objects.map((o) => o.id)).toEqual(fixture.objects.map((o) => o.id));
    expect(pkg.dialogs.map((d) => d.id)).toEqual(fixture.dialogs.map((d) => d.id));
    expect(pkg.hints.map((h) => h.id)).toEqual(fixture.hints.map((h) => h.id));
    expect(pkg.puzzles.map((p) => p.id)).toEqual(fixture.puzzles.map((p) => p.id));
    expect(pkg.rules.map((r) => r.id)).toEqual(fixture.rules.map((r) => r.id));
  });

  it("sobrevive a la réplica por updates binarios y a una segunda ida y vuelta", () => {
    const replica = replicate(aldricDoc());
    expect(roomDocToPackage(replica)).toEqual(fixture);
    const again = roomPackageToDoc(roomDocToPackage(replica));
    expect(roomDocToPackage(again)).toEqual(fixture);
  });

  it("sirve de serializador al validador del editor (3.7)", () => {
    const doc = aldricDoc();
    expect(docToRoomPackage(doc, roomDocToPackage)).toEqual({ ok: true, pkg: fixture });
  });

  it("roomPackageToDoc sustituye el contenido previo del doc", () => {
    const doc = aldricDoc();
    placeObject(doc, { roomId: "bodega", sprite: "arca", position: { x: 3, y: 3 } });
    roomPackageToDoc(fixture, doc);
    expect(roomDocToPackage(doc)).toEqual(fixture);
  });

  it("es compatible con las porciones de 3.10 (textos) y 3.6 (reglas)", () => {
    const doc = aldricDoc();
    addRoomLanguage(doc, "en");
    const intro = ensureLocalizedField(doc, "dialogs", "d-intro");
    setLocalizedValue(intro, "en", "Prophecy…");
    createRule(doc, { id: "r-nueva", trigger: { type: "on_game_start" } });

    const pkg = roomDocToPackage(doc);
    expect(pkg.meta.languages).toEqual(["es", "en"]);
    expect(pkg.dialogs.find((d) => d.id === "d-intro")?.text.en?.text).toBe("Prophecy…");
    expect(pkg.rules.at(-1)?.id).toBe("r-nueva");
    // Un diálogo creado desde 3.10 (sin `order`) va al final.
    ensureLocalizedField(doc, "dialogs", "aaa-nuevo", { es: { text: "Hola" } });
    expect(roomDocToPackage(doc).dialogs.at(-1)?.id).toBe("aaa-nuevo");
  });

  it("observeRoomDoc avisa una vez por transacción, también ante cambios remotos", () => {
    const doc = aldricDoc();
    const remote = replicate(doc);
    let calls = 0;
    const stop = observeRoomDoc(doc, () => calls++);
    fillTiles(doc, "bodega", "decor", { x: 0, y: 0 }, 21);
    expect(calls).toBe(1);
    moveObject(remote, "trono", { x: 9, y: 2 });
    sync(remote, doc);
    expect(calls).toBe(2);
    stop();
    paintTiles(doc, "bodega", "ground", [{ x: 1, y: 1 }], 3);
    expect(calls).toBe(2);
  });
});

describe("comandos de pintado", () => {
  it("pincel: pinta celdas de una capa e ignora las de fuera de la rejilla", () => {
    const doc = aldricDoc();
    const changed = paintTiles(
      doc,
      "salon-trono",
      "ground",
      [
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 99, y: 0 },
      ],
      3,
    );
    expect(changed).toBe(2);
    const pkg = roomDocToPackage(doc);
    const before = layerTiles(fixture, "salon-trono", "ground");
    const after = layerTiles(pkg, "salon-trono", "ground");
    const diff = after.flatMap((t, i) => (t !== before[i] ? [i] : []));
    expect(diff).toEqual([3 * 20 + 2, 3 * 20 + 3]);
    expect(after[3 * 20 + 2]).toBe(3);
    expect(parseRoomPackage(pkg).map.rooms).toHaveLength(3);
  });

  it("pintar en la capa de decoración la crea detrás de las existentes", () => {
    const doc = aldricDoc();
    paintTiles(doc, "bodega", "decor", [{ x: 4, y: 4 }], 21);
    const room = roomDocToPackage(doc).map.rooms.find((r) => r.id === "bodega");
    expect(room?.layers.map((l) => l.name)).toEqual(["ground", "walls", "decor"]);
    expect(getTile(doc, "bodega", "decor", { x: 4, y: 4 })).toBe(21);
  });

  it("borrador: vacía la celda (tile 0) sin tocar otras capas", () => {
    const doc = aldricDoc();
    expect(getTile(doc, "salon-trono", "walls", { x: 0, y: 0 })).toBe(10);
    expect(eraseTiles(doc, "salon-trono", "walls", [{ x: 0, y: 0 }])).toBe(1);
    expect(getTile(doc, "salon-trono", "walls", { x: 0, y: 0 })).toBe(0);
    expect(getTile(doc, "salon-trono", "ground", { x: 0, y: 0 })).toBe(1);
    const walls = layerTiles(roomDocToPackage(doc), "salon-trono", "walls");
    expect(walls[0]).toBe(0);
    expect(walls[1]).toBe(10);
  });

  it("relleno: sustituye solo la región 4-conexa del mismo tile", () => {
    const doc = new Y.Doc();
    initRoomDoc(doc, {
      id: "r1",
      title: "Prueba",
      language: "es",
      room: { id: "sala-1", name: "Sala", cols: 5, rows: 4 },
    });
    // Una pared vertical en x = 2 divide el suelo en dos regiones.
    paintTiles(
      doc,
      "sala-1",
      "ground",
      [0, 1, 2, 3].map((y) => ({ x: 2, y })),
      10,
    );
    const painted = fillTiles(doc, "sala-1", "ground", { x: 0, y: 0 }, 3);
    expect(painted).toBe(8);
    expect(layerTiles(roomDocToPackage(doc), "sala-1", "ground")).toEqual([
      3, 3, 10, 1, 1, 3, 3, 10, 1, 1, 3, 3, 10, 1, 1, 3, 3, 10, 1, 1,
    ]);
    // Rellenar con el mismo tile no cambia nada.
    expect(fillTiles(doc, "sala-1", "ground", { x: 0, y: 0 }, 3)).toBe(0);
    // Rellenar la capa vacía de decoración cubre toda la habitación.
    expect(fillTiles(doc, "sala-1", "decor", { x: 4, y: 3 }, 22)).toBe(20);
  });

  it("dos pestañas pintando la misma celda convergen a un único valor", () => {
    const a = aldricDoc();
    const b = replicate(a);
    paintTiles(a, "bodega", "ground", [{ x: 5, y: 5 }], 3);
    paintTiles(b, "bodega", "ground", [{ x: 5, y: 5 }], 1);
    paintTiles(b, "bodega", "ground", [{ x: 6, y: 5 }], 3);
    sync(a, b);
    expect(roomDocToPackage(a)).toEqual(roomDocToPackage(b));
    const tiles = layerTiles(roomDocToPackage(a), "bodega", "ground");
    expect(tiles).toHaveLength(18 * 12);
    expect(tiles[5 * 18 + 6]).toBe(3);
  });
});

describe("comandos de objetos", () => {
  it("propone ids legibles y únicos al colocar", () => {
    const doc = aldricDoc();
    expect(proposeObjectId(doc, "arca", "salon-trono")).toBe("arca-trono");
    expect(proposeObjectId(doc, "Barril Suelto", "bodega")).toBe("barril-suelto-bodega");
    expect(proposeObjectId(doc, "Cáliz de Oro", "bodega")).toBe("caliz-de-oro-bodega");
    expect(proposeObjectId(doc, "trono", "salon-trono")).toBe("trono-2");
    const id = placeObject(doc, {
      roomId: "salon-trono",
      sprite: "arca",
      position: { x: 4, y: 4 },
    });
    expect(id).toBe("arca-trono");
    expect(proposeObjectId(doc, "arca", "salon-trono")).toBe("arca-trono-2");
  });

  it("colocar crea un WorldObject válido al final de la lista", () => {
    const doc = aldricDoc();
    placeObject(doc, { roomId: "salon-trono", sprite: "arca", position: { x: 4, y: 4 } });
    const pkg = parseRoomPackage(roomDocToPackage(doc));
    expect(pkg.objects).toHaveLength(fixture.objects.length + 1);
    expect(pkg.objects.at(-1)).toEqual({
      id: "arca-trono",
      roomId: "salon-trono",
      type: "decorativo",
      position: { x: 4, y: 4 },
      sprite: "arca",
      states: {},
      initialState: "",
      interactable: true,
    });
  });

  it("rechaza colocar fuera de la rejilla o con un id repetido o no legible", () => {
    const doc = aldricDoc();
    const place = (id: string | undefined, x: number) =>
      placeObject(doc, { roomId: "bodega", sprite: "arca", position: { x, y: 1 }, id });
    expect(() => place(undefined, 18)).toThrow(RoomDocError);
    expect(() => place("trono", 1)).toThrow(/Ya existe/);
    expect(() => place("Arca Trono", 1)).toThrow(/no es un id válido/);
    expect(roomDocToPackage(doc).objects).toHaveLength(fixture.objects.length);
  });

  it("arrastrar mueve el objeto (también a otra habitación) y valida la celda", () => {
    const doc = aldricDoc();
    expect(moveObject(doc, "trono", { x: 10, y: 1 })).toBe(false);
    expect(moveObject(doc, "trono", { x: 11, y: 2 })).toBe(true);
    expect(readObject(doc, "trono")?.position).toEqual({ x: 11, y: 2 });
    expect(() => moveObject(doc, "trono", { x: 30, y: 2 })).toThrow(/fuera/);
    moveObject(doc, "trono", { x: 3, y: 3 }, "bodega");
    expect(readObject(doc, "trono")).toMatchObject({ roomId: "bodega", position: { x: 3, y: 3 } });
    // El resto del objeto no cambia.
    expect(readObject(doc, "trono")).toEqual({
      ...fixture.objects[0],
      roomId: "bodega",
      position: { x: 3, y: 3 },
    });
  });

  it("renombrar solo se permite si nada referencia el id; borrar lo quita", () => {
    const doc = aldricDoc();
    const id = placeObject(doc, { roomId: "bodega", sprite: "arca", position: { x: 2, y: 2 } });
    renameObject(doc, id, "arca-vinos");
    expect(readObject(doc, id)).toBeUndefined();
    expect(readObject(doc, "arca-vinos")?.position).toEqual({ x: 2, y: 2 });
    // El orden de alta se conserva.
    expect(roomDocToPackage(doc).objects.at(-1)?.id).toBe("arca-vinos");
    // `brasero` lo usan reglas y la luz de la antorcha.
    expect(() => renameObject(doc, "brasero", "brasero-2")).toThrow(/se usa en/);
    removeObject(doc, "arca-vinos");
    expect(roomDocToPackage(doc)).toEqual(fixture);
  });
});

describe("controlador de herramientas (eventos del runtime → doc)", () => {
  const down = (x: number, y: number, objectId?: string) =>
    ({ phase: "down", cell: { x, y }, ...(objectId ? { objectId } : {}) }) as const;
  const move = (x: number, y: number) => ({ phase: "move", cell: { x, y } }) as const;
  const up = (x: number, y: number) => ({ phase: "up", cell: { x, y } }) as const;

  it("pincel: un trazo pinta las celdas intermedias aunque el puntero salte", () => {
    const doc = aldricDoc();
    const tools = new EditToolController(doc, { roomId: "bodega" });
    tools.selectTile(3, "ground");
    expect(tools.getState().tool).toBe("brush");
    tools.pointer(down(1, 1));
    tools.pointer(move(4, 1));
    tools.pointer(up(4, 1));
    tools.pointer(move(8, 8)); // sin trazo activo no pinta
    for (let x = 1; x <= 4; x++) expect(getTile(doc, "bodega", "ground", { x, y: 1 })).toBe(3);
    expect(getTile(doc, "bodega", "ground", { x: 8, y: 8 })).toBe(2);
  });

  it("borrador y relleno sobre la capa activa", () => {
    const doc = aldricDoc();
    const tools = new EditToolController(doc, { roomId: "salon-trono" });
    tools.setLayer("walls");
    tools.setTool("eraser");
    tools.pointer(down(0, 0));
    tools.pointer(move(2, 0));
    tools.pointer(up(2, 0));
    expect([0, 1, 2].map((x) => getTile(doc, "salon-trono", "walls", { x, y: 0 }))).toEqual([
      0, 0, 0,
    ]);
    tools.selectTile(21, "decor");
    tools.setTool("fill");
    tools.pointer(down(5, 5));
    const decor = layerTiles(roomDocToPackage(doc), "salon-trono", "decor");
    expect(decor.every((t) => t === 21)).toBe(true);
  });

  it("colocar desde la palette crea el objeto con id propuesto y lo selecciona", () => {
    const doc = aldricDoc();
    const tools = new EditToolController(doc, { roomId: "salon-trono" });
    tools.selectSprite("arca");
    tools.pointer(down(4, 5));
    tools.pointer(up(4, 5));
    expect(tools.getState()).toMatchObject({
      tool: "place",
      selectedObjectId: "arca-trono",
      lastPlacedId: "arca-trono",
    });
    expect(readObject(doc, "arca-trono")?.position).toEqual({ x: 4, y: 5 });
    // Fuera de la rejilla no coloca nada.
    tools.pointer(down(40, 5));
    expect(roomDocToPackage(doc).objects).toHaveLength(fixture.objects.length + 1);
  });

  it("seleccionar y arrastrar: previsualiza sin tocar el doc y confirma al soltar", () => {
    const doc = aldricDoc();
    const tools = new EditToolController(doc, { roomId: "salon-trono" });
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u));

    // Se agarra el trono (10,1) pulsando en la celda (10,0) de su sprite.
    tools.pointer(down(10, 0, "trono"));
    tools.pointer(move(12, 1));
    expect(tools.getState().drag).toMatchObject({ objectId: "trono", cell: { x: 12, y: 2 } });
    expect(readObject(doc, "trono")?.position).toEqual({ x: 10, y: 1 });
    expect(updates).toHaveLength(0);
    tools.pointer(up(12, 1));
    expect(tools.getState().drag).toBeUndefined();
    expect(tools.getState().selectedObjectId).toBe("trono");
    expect(readObject(doc, "trono")?.position).toEqual({ x: 12, y: 2 });
    expect(updates).toHaveLength(1);
  });

  it("un clic sin mover solo selecciona; clic en vacío deselecciona; Supr borra", () => {
    const doc = aldricDoc();
    const tools = new EditToolController(doc, { roomId: "salon-trono" });
    tools.pointer(down(10, 0, "trono"));
    tools.pointer(up(10, 0));
    expect(readObject(doc, "trono")?.position).toEqual({ x: 10, y: 1 });
    expect(tools.getState().selectedObjectId).toBe("trono");
    tools.pointer(down(5, 5));
    expect(tools.getState().selectedObjectId).toBeUndefined();
    tools.pointer(down(10, 0, "trono"));
    tools.pointer(up(10, 0));
    tools.deleteSelection();
    expect(readObject(doc, "trono")).toBeUndefined();
    expect(tools.getState().selectedObjectId).toBeUndefined();
  });

  it("un arrastre fuera de la rejilla se queda en la última celda válida", () => {
    const doc = aldricDoc();
    const tools = new EditToolController(doc, { roomId: "salon-trono" });
    tools.pointer(down(10, 1, "trono"));
    tools.pointer(move(19, 1));
    tools.pointer(move(25, 1));
    tools.pointer(up(25, 1));
    expect(readObject(doc, "trono")?.position).toEqual({ x: 19, y: 1 });
  });

  it("un comando que falla deja el error (con código traducible) en el estado", () => {
    const tools = new EditToolController(aldricDoc(), { roomId: "no-existe" });
    tools.selectTile(3);
    tools.pointer(down(1, 1));
    expect(tools.getState().error?.code).toBe("UNKNOWN_ROOM");
    tools.setTool("select");
    expect(tools.getState().error).toBeUndefined();
  });

  it("notifica a los suscriptores (useSyncExternalStore)", () => {
    const tools = new EditToolController(aldricDoc(), { roomId: "bodega" });
    let calls = 0;
    const stop = tools.subscribe(() => calls++);
    tools.setTool("fill");
    tools.setLayer("decor");
    stop();
    tools.setTool("select");
    expect(calls).toBe(2);
  });
});

describe("sala nueva", () => {
  it("initRoomDoc crea un esqueleto válido solo si el doc está vacío", () => {
    const doc = new Y.Doc();
    expect(initRoomDoc(doc, { id: "r-nueva", title: "Mi sala", language: "es" })).toBe(true);
    const pkg = parseRoomPackage(roomDocToPackage(doc));
    expect(pkg.meta).toMatchObject({ id: "r-nueva", title: "Mi sala", languages: ["es"] });
    expect(pkg.map.rooms).toHaveLength(1);
    expect(pkg.map.rooms[0]?.layers[0]).toEqual({
      name: "ground",
      rle: Array(20)
        .fill(0)
        .flatMap((_, i) => (i % 2 === 0 ? [12] : [1])),
    });
    expect(initRoomDoc(doc, { id: "otra", title: "Otra", language: "en" })).toBe(false);
    expect(roomDocToPackage(doc).meta.id).toBe("r-nueva");
  });

  it("lineCells interpola en diagonal", () => {
    expect(lineCells({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });
});
