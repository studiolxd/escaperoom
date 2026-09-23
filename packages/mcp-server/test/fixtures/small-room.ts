import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect } from "vitest";
import { call, type ToolCall } from "./client";

/**
 * Guion de una sala pequeña ("La cripta del alquimista", 2 habitaciones)
 * construida SOLO con el toolset de estructura/contenido (4.2), como lo haría
 * un agente: fase A (create_room, define_subrooms, set_map, paint_tiles) y
 * fase B (define_item, add_object, add_puzzle, add_dialog, add_hint).
 */
export const SMALL_ROOM_META = {
  title: "La cripta del alquimista",
  theme: "medieval",
  languages: ["es", "en"],
  defaultLanguage: "es",
  difficulty: 1,
  players: { min: 1, max: 2 },
  description: "Una sala corta para probar el MCP del creador.",
  estimatedMinutes: 20,
} as const;

export const LAB = "laboratorio";
export const CRYPT = "cripta";

async function ok(client: Client, name: string, args: Record<string, unknown>): Promise<ToolCall> {
  const result = await call(client, name, args);
  expect(result.isError, `${name}: ${result.text}`).toBe(false);
  expect(result.text.startsWith(`✅ ${name}`)).toBe(true);
  return result;
}

const es = (text: string) => ({ es: { text } });
const esEn = (esText: string, enText: string) => ({ es: { text: esText }, en: { text: enText } });

/** Construye la sala por MCP y devuelve su `roomId`. */
export async function buildSmallRoom(client: Client): Promise<string> {
  const created = await ok(client, "create_room", { meta: SMALL_ROOM_META });
  const roomId = String(created.structured?.roomId);

  // Fase A — estructura
  await ok(client, "define_subrooms", {
    roomId,
    subrooms: [
      { id: LAB, name: "Laboratorio", bounds: { x: 0, y: 0, w: 10, h: 8 } },
      { id: CRYPT, name: "Cripta", bounds: { x: 10, y: 0, w: 8, h: 6 } },
    ],
  });
  await ok(client, "set_map", {
    roomId,
    tileset: "medieval-v1",
    size: { cols: 10, rows: 8 },
    layers: [{ name: "ground", rle: [80, 1] }],
    subroomIds: [LAB],
  });
  const cryptFloor = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) cryptFloor.push({ x, y, tile: 2 });
  await ok(client, "paint_tiles", { roomId, subroomId: CRYPT, layer: "ground", cells: cryptFloor });
  await ok(client, "paint_tiles", {
    roomId,
    subroomId: CRYPT,
    layer: "walls",
    cells: [0, 1, 2, 3, 4, 5, 6, 7].map((x) => ({ x, y: 0, tile: 7 })),
  });

  // Fase B — contenido
  await ok(client, "define_item", {
    roomId,
    item: { id: "llave-cripta", name: esEn("Llave de la cripta", "Crypt key"), icon: "icon-llave" },
  });
  await ok(client, "add_object", {
    roomId,
    object: {
      id: "cofre-lab",
      roomId: LAB,
      type: "cofre",
      position: { x: 3, y: 2 },
      sprite: "cofre",
      states: { cerrado: "cofre-cerrado", abierto: "cofre-abierto" },
      initialState: "cerrado",
      interactable: true,
    },
  });
  await ok(client, "add_object", {
    roomId,
    object: {
      id: "puerta-cripta",
      roomId: LAB,
      type: "puerta",
      position: { x: 9, y: 4 },
      sprite: "puerta",
      states: { cerrada: "puerta-cerrada", abierta: "puerta-abierta" },
      initialState: "cerrada",
      lockedBy: "llave-cripta",
      interactable: true,
      leadsTo: CRYPT,
    },
  });
  await ok(client, "add_puzzle", {
    roomId,
    puzzle: {
      id: "p-cofre",
      type: "code_lock",
      layer: "panel",
      roomId: LAB,
      position: { x: 3, y: 2 },
      requiresSolved: [],
      grantsItems: ["llave-cripta"],
      unlocks: [],
      length: 3,
      code: "314",
    },
  });
  await ok(client, "add_dialog", {
    roomId,
    dialog: {
      id: "d-intro",
      text: esEn("El alquimista os espera abajo.", "The alchemist awaits below."),
    },
  });
  await ok(client, "add_hint", {
    roomId,
    hint: {
      puzzleId: "p-cofre",
      tier: 1,
      text: es("Contad los frascos de cada estante."),
      cost: 1,
    },
  });
  return roomId;
}
