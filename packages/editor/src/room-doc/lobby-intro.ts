import * as Y from "yjs";
import {
  DEFAULT_LOBBY_ROOM_ID,
  DEFAULT_LOBBY_ROOM_NAME,
  LOBBY_ROOM_KIND,
  MAX_GRID_DIMENSION,
  MAX_INTRO_MEDIA_REF_LENGTH,
  MAX_INTRO_TEXT_LENGTH,
  buildDefaultLobbyRoom,
  type RoomIntro,
  type SubRoom,
  type SubRoomKind,
  type TileLayer,
} from "@escaperoom/shared/schemas";
import type { YLocalizedText } from "../i18n-fields/localized-text";
import { getRoomLanguages } from "../i18n-fields/room-languages";
import { RoomDocError, assertFreeId, subRoom, usedIds } from "./commands";
import { ROOM_DOC_KEYS, collection, nextOrder } from "./doc-model";
import {
  INTRO_KEY,
  buildIntroRecord,
  buildRoomMap,
  buildSubRoomRecord,
  readIntroRecord,
} from "./serialize";

/**
 * Sala de espera (lobby) e introducción de la sala en el doc Yjs (encargo
 * lobby-diseño, specs/09 §"Lobby e introducción"). El lobby es una habitación
 * más del mapa con `kind: "lobby"`: se pinta y se decora en el lienzo como
 * cualquier otra, pero sin pruebas, puertas ni objetos que den ítems (lo
 * impide el validador, `checkLobbyRoom`). Sin lobby diseñado, la partida usa
 * el generado (`withLobbyRoom`). Los mismos comandos los usan el editor y el
 * MCP (`define_subrooms` con `kind`, `set_room_intro`).
 */

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

/** Id de la habitación marcada como lobby en el doc (la primera en orden), o `undefined`. */
export function findLobbyRoomId(doc: Y.Doc): string | undefined {
  return buildRoomMap(doc).rooms.find((room) => room.kind === LOBBY_ROOM_KIND)?.id;
}

/**
 * Marca (`"lobby"`) o desmarca (`undefined`) una habitación como sala de
 * espera. Rechaza un segundo lobby y convertir en lobby la única habitación
 * (la partida necesita al menos una de juego). Marcar una habitación con
 * pruebas o puertas se permite: el validador explica qué hay que quitar.
 */
export function setSubRoomKind(doc: Y.Doc, roomId: string, kind: SubRoomKind | undefined): void {
  doc.transact(() => {
    const room = subRoom(doc, roomId);
    if (kind === undefined) {
      room.delete("kind");
      return;
    }
    const current = findLobbyRoomId(doc);
    if (current !== undefined && current !== roomId) {
      throw new RoomDocError(
        "LOBBY_CONFLICT",
        `Ya hay una sala de espera («${current}»): quítale el tipo lobby antes de marcar «${roomId}».`,
      );
    }
    if (collection(doc, "subrooms").size <= 1) {
      throw new RoomDocError(
        "LOBBY_CONFLICT",
        `«${roomId}» es la única habitación: la sala de espera no puede ser la única, añade antes una habitación de juego.`,
      );
    }
    room.set("kind", kind);
  });
}

export type AddLobbyRoomInput = {
  /** Id de la habitación; por defecto `lobby` (o `lobby-2`… si está ocupado). */
  id?: string;
  /** Nombre visible (dato del mapa); por defecto «Sala de espera». */
  name?: string;
  cols: number;
  rows: number;
};

/** Tamaño mínimo de la sala de espera (muros + una fila/columna donde aparecer). */
export const MIN_LOBBY_DIMENSION = 3;

function freeLobbyId(doc: Y.Doc): string {
  const taken = usedIds(doc);
  if (!taken.has(DEFAULT_LOBBY_ROOM_ID)) return DEFAULT_LOBBY_ROOM_ID;
  for (let n = 2; ; n += 1) {
    const candidate = `${DEFAULT_LOBBY_ROOM_ID}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Tile de la primera celda no vacía de una capa RLE (`0` si está vacía). */
function firstTile(layer: TileLayer | undefined): number {
  if (!layer) return 0;
  for (let i = 1; i < layer.rle.length; i += 2) {
    if (layer.rle[i] !== 0) return layer.rle[i]!;
  }
  return 0;
}

function sparseRle(cells: Set<number>, tile: number, size: number): number[] {
  const rle: number[] = [];
  let i = 0;
  while (i < size) {
    const filled = cells.has(i);
    let j = i;
    while (j < size && cells.has(j) === filled) j += 1;
    rle.push(j - i, filled ? tile : 0);
    i = j;
  }
  return rle;
}

/**
 * Sala de espera de `cols × rows` con el mismo aspecto que el lobby por
 * defecto (`buildDefaultLobbyRoom`): suelo y muros de la habitación inicial,
 * muros en la fila superior y la columna izquierda, su luz ambiente y un
 * punto de aparición por jugador (hasta 8) cerca del centro.
 */
export function buildLobbyRoom(
  doc: Y.Doc,
  input: { id: string; name: string; cols: number; rows: number },
): SubRoom {
  const players = doc.getMap<unknown>(ROOM_DOC_KEYS.meta).get("players") as
    { max?: unknown } | undefined;
  const maxPlayers = typeof players?.max === "number" ? players.max : 4;
  const base = buildDefaultLobbyRoom(buildRoomMap(doc), maxPlayers);
  const { cols, rows } = input;
  const size = cols * rows;
  const [groundLayer, wallsLayer] = base.layers;
  const layers: TileLayer[] = [];
  const floor = firstTile(groundLayer);
  if (groundLayer && floor !== 0) layers.push({ name: groundLayer.name, rle: [size, floor] });
  const wall = firstTile(wallsLayer);
  if (wallsLayer && wall !== 0) {
    const cells = new Set<number>();
    for (let x = 0; x < cols; x += 1) cells.add(x);
    for (let y = 0; y < rows; y += 1) cells.add(y * cols);
    layers.push({ name: wallsLayer.name, rle: sparseRle(cells, wall, size) });
  }

  // Puntos de aparición dentro del suelo libre (x ≥ 1, y ≥ 1), sin repetir celda.
  const count = base.spawnPoints.length;
  const spawnPoints: SubRoom["spawnPoints"] = [];
  const centerX = Math.floor(cols / 2);
  const centerY = Math.max(1, Math.floor(rows / 2));
  const seen = new Set<string>();
  const clampX = (x: number) => Math.min(cols - 1, Math.max(1, x));
  const clampY = (y: number) => Math.min(rows - 1, Math.max(1, y));
  const offsets = [0, -1, 1, -2, 2, -3, 3, 4, -4, 5];
  outer: for (const dy of [0, 1, -1, 2, -2]) {
    for (const dx of offsets) {
      if (spawnPoints.length >= count) break outer;
      const x = clampX(centerX + dx);
      const y = clampY(centerY + dy);
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spawnPoints.push({ id: `spawn-${spawnPoints.length + 1}`, x, y });
    }
  }

  return {
    id: input.id,
    name: input.name,
    kind: LOBBY_ROOM_KIND,
    grid: { cols, rows },
    layers,
    decorations: [],
    spawnPoints,
    lighting: base.lighting,
  };
}

/**
 * Crea la sala de espera como una habitación nueva del mapa (al final: la
 * habitación inicial sigue siendo la primera de juego), con suelo, muros y
 * puntos de aparición por defecto para decorarla después en el lienzo.
 * Devuelve su id. Rechaza un segundo lobby.
 */
export function addLobbyRoom(doc: Y.Doc, input: AddLobbyRoomInput): string {
  const { cols, rows } = input;
  for (const [axis, value] of [
    ["cols", cols],
    ["rows", rows],
  ] as const) {
    if (!Number.isInteger(value) || value < MIN_LOBBY_DIMENSION || value > MAX_GRID_DIMENSION) {
      throw new RoomDocError(
        "INVALID_VALUE",
        `El tamaño de la sala de espera («${axis}» = ${value}) debe ser un entero entre ${MIN_LOBBY_DIMENSION} y ${MAX_GRID_DIMENSION}`,
      );
    }
  }
  const current = findLobbyRoomId(doc);
  if (current !== undefined) {
    throw new RoomDocError(
      "LOBBY_CONFLICT",
      `Ya hay una sala de espera («${current}»): solo puede haber una.`,
    );
  }
  const id = input.id ?? freeLobbyId(doc);
  const name = input.name?.trim() || DEFAULT_LOBBY_ROOM_NAME;
  doc.transact(() => {
    assertFreeId(doc, id);
    const room = buildLobbyRoom(doc, { id, name, cols, rows });
    const subrooms = collection(doc, "subrooms");
    subrooms.set(id, buildSubRoomRecord(room, nextOrder(subrooms)));
  });
  return id;
}

// ---------------------------------------------------------------------------
// Introducción
// ---------------------------------------------------------------------------

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(ROOM_DOC_KEYS.meta);
}

function assertLanguages(doc: Y.Doc, locales: readonly string[], field: string): void {
  const { languages } = getRoomLanguages(doc);
  const unknown = locales.filter((locale) => !languages.includes(locale));
  if (unknown.length > 0) {
    throw new RoomDocError(
      "UNKNOWN_LANGUAGE",
      `${field} usa idiomas no declarados en la sala (${unknown.join(", ")}); idiomas de la sala: ${languages.join(", ") || "ninguno"}`,
    );
  }
}

function assertMediaRef(ref: string, field: string): void {
  if (typeof ref !== "string" || ref.trim().length === 0) {
    throw new RoomDocError("INVALID_VALUE", `${field} está vacío`);
  }
  if (ref.length > MAX_INTRO_MEDIA_REF_LENGTH) {
    throw new RoomDocError(
      "INVALID_VALUE",
      `${field} supera ${MAX_INTRO_MEDIA_REF_LENGTH} caracteres`,
    );
  }
}

/**
 * Fija (o quita, con `null`) la introducción de la sala. Texto: al menos un
 * idioma, todos declarados y dentro de `MAX_INTRO_TEXT_LENGTH`. Vídeo: una
 * referencia de medio (`media:<uuid>`, la que devuelve la subida) y
 * subtítulos WebVTT opcionales por idioma declarado. Sustituye la anterior
 * entera (cambiar de texto a vídeo descarta el texto).
 */
export function setRoomIntro(doc: Y.Doc, intro: RoomIntro | null): void {
  if (intro === null) {
    doc.transact(() => metaMap(doc).delete(INTRO_KEY));
    return;
  }
  if (intro.type === "text") {
    const locales = Object.keys(intro.text);
    if (locales.length === 0) {
      throw new RoomDocError(
        "UNKNOWN_LANGUAGE",
        "El texto de la introducción no tiene ningún idioma",
      );
    }
    assertLanguages(doc, locales, "El texto de la introducción");
    for (const [locale, entry] of Object.entries(intro.text)) {
      if (entry.text.length > MAX_INTRO_TEXT_LENGTH) {
        throw new RoomDocError(
          "INVALID_VALUE",
          `El texto de la introducción en «${locale}» tiene ${entry.text.length} caracteres (máximo ${MAX_INTRO_TEXT_LENGTH})`,
        );
      }
    }
  } else {
    assertMediaRef(intro.video, "El vídeo de la introducción");
    const subtitles = intro.subtitles ?? {};
    assertLanguages(doc, Object.keys(subtitles), "Los subtítulos de la introducción");
    for (const [lang, ref] of Object.entries(subtitles)) {
      assertMediaRef(ref, `Los subtítulos «${lang}» de la introducción`);
    }
  }
  doc.transact(() => metaMap(doc).set(INTRO_KEY, buildIntroRecord(intro)));
}

/** Introducción de la sala como `RoomIntro` (limitada a los idiomas declarados), o `undefined`. */
export function readRoomIntro(doc: Y.Doc): RoomIntro | undefined {
  return readIntroRecord(metaMap(doc).get(INTRO_KEY), getRoomLanguages(doc).languages);
}

/**
 * Texto localizado de una introducción de tipo texto (el `YLocalizedText`
 * vivo del doc, para editarlo con el campo localizado del editor), o
 * `undefined` si la introducción no es de texto.
 */
export function getRoomIntroText(doc: Y.Doc): YLocalizedText | undefined {
  const record = metaMap(doc).get(INTRO_KEY);
  if (!(record instanceof Y.Map) || record.get("type") !== "text") return undefined;
  const text = record.get("text");
  return text instanceof Y.Map ? (text as YLocalizedText) : undefined;
}

/**
 * Fija (o quita, con `null`) los subtítulos WebVTT de un idioma de la
 * introducción de vídeo. Solo toca ese idioma: dos creadores que suben
 * subtítulos de idiomas distintos a la vez no se pisan.
 */
export function setRoomIntroSubtitles(doc: Y.Doc, lang: string, ref: string | null): void {
  doc.transact(() => {
    const record = metaMap(doc).get(INTRO_KEY);
    if (!(record instanceof Y.Map) || record.get("type") !== "video") {
      throw new RoomDocError(
        "INVALID_VALUE",
        "La introducción no es un vídeo: sube antes el vídeo para añadirle subtítulos",
      );
    }
    if (ref === null) {
      const current = record.get("subtitles");
      if (current instanceof Y.Map) current.delete(lang);
      return;
    }
    assertLanguages(doc, [lang], "Los subtítulos de la introducción");
    assertMediaRef(ref, `Los subtítulos «${lang}» de la introducción`);
    let subtitles = record.get("subtitles");
    if (!(subtitles instanceof Y.Map)) {
      subtitles = new Y.Map<string>();
      record.set("subtitles", subtitles);
    }
    (subtitles as Y.Map<string>).set(lang, ref);
  });
}
