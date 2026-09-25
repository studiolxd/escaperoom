import { decodeRle } from "@escaperoom/editor/room-doc";
import type { PuzzleDefinition, RoomPackage } from "@escaperoom/shared/schemas";

/**
 * Guion del test de paridad (ticket 4.8, specs/22 §3.3): la secuencia de
 * llamadas que haría un agente para construir «La Maldición del Rey Aldric»
 * ENTERA solo con el toolset del MCP, a partir del fixture
 * `docs/reference/roompackage-rey-aldric.v1.json`. Cada entidad se envía tal y
 * como está en el fixture; el guion solo decide el ORDEN y, donde hay
 * referencias cruzadas, un alta en dos pasos (`replace: true`).
 *
 * El validador incremental de 4.4 rechaza toda mutación que introduce ❌
 * nuevos, así que el agente construye "de la fuente al sumidero", en el orden
 * en que se juega la sala (Salón → Bodega → Catacumbas):
 *
 * - una entidad no puede referenciar otra que aún no existe (`references`);
 * - un puzzle, puerta o regla no puede quedar inalcanzable (`dead_ends`).
 *
 * Donde dos entidades se referencian mutuamente (el puzzle `unlocks` la puerta
 * y la puerta tiene `lockedBy` el puzzle; el `code_lock` lista sus `hints` y
 * cada pista apunta a su `puzzleId`), el agente da de alta una de ellas sin la
 * referencia y, cuando existe la otra, la sustituye por la versión completa.
 */

export type ScriptStep = {
  tool: string;
  args: Record<string, unknown>;
  /** Etiqueta legible del paso para los mensajes de error del test. */
  label: string;
};

type Collection = "objects" | "items" | "puzzles" | "rules" | "dialogs" | "hints";

/** Una entidad del fixture por id (falla si el guion cita un id que no existe). */
function entity<C extends Collection>(pkg: RoomPackage, collection: C, id: string) {
  const found = (pkg[collection] as Array<{ id: string }>).find((entry) => entry.id === id);
  if (!found) throw new Error(`El fixture no tiene ${collection}[${id}]`);
  return structuredClone(found) as RoomPackage[C][number];
}

/** Guion completo: fase A (estructura), B (contenido), C (lógica) en orden de juego. */
export function aldricScript(pkg: RoomPackage): {
  createRoom: ScriptStep;
  steps: (roomId: string) => ScriptStep[];
} {
  const { meta } = pkg;
  const createRoom: ScriptStep = {
    tool: "create_room",
    label: "create_room",
    args: {
      meta: {
        title: meta.title,
        theme: meta.theme,
        languages: meta.languages,
        defaultLanguage: meta.defaultLanguage,
        difficulty: meta.difficulty,
        players: meta.players,
        description: meta.description,
        estimatedMinutes: meta.estimatedMinutes,
      },
    },
  };

  const steps = (roomId: string): ScriptStep[] => {
    const out: ScriptStep[] = [];
    const push = (tool: string, label: string, args: Record<string, unknown>) =>
      out.push({ tool, label, args: { roomId, ...args } });

    const item = (id: string) => push("define_item", id, { item: entity(pkg, "items", id) });
    const dialog = (id: string) => push("add_dialog", id, { dialog: entity(pkg, "dialogs", id) });
    const hint = (id: string) => push("add_hint", id, { hint: entity(pkg, "hints", id) });
    const rule = (id: string) => push("add_rule", id, { rule: entity(pkg, "rules", id) });
    const object = (id: string, replace = false) =>
      push("add_object", `${id}${replace ? " (completo)" : ""}`, {
        object: entity(pkg, "objects", id),
        ...(replace ? { replace } : {}),
      });
    const puzzle = (id: string, replace = false) =>
      push("add_puzzle", `${id}${replace ? " (completo)" : ""}`, {
        puzzle: entity(pkg, "puzzles", id),
        ...(replace ? { replace } : {}),
      });
    /** Primer alta de un puzzle con parte de su config (la que aún no se puede referenciar). */
    const puzzleDraft = (id: string, patch: (p: PuzzleDefinition) => PuzzleDefinition) =>
      push("add_puzzle", `${id} (parcial)`, { puzzle: patch(entity(pkg, "puzzles", id)) });
    const withoutUnlocks = (p: PuzzleDefinition) => ({ ...p, unlocks: [] });
    const withoutHints = (p: PuzzleDefinition) => {
      const rest = { ...p } as PuzzleDefinition & { hints?: string[] };
      delete rest.hints;
      return rest as PuzzleDefinition;
    };

    // ── Fase A — estructura ────────────────────────────────────────────────
    push("define_subrooms", "habitaciones", {
      subrooms: pkg.map.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        bounds: { x: 0, y: 0, w: room.grid.cols, h: room.grid.rows },
        spawnPoints: room.spawnPoints,
      })),
    });
    for (const room of pkg.map.rooms) {
      // El suelo, en RLE con set_map; el resto de capas, a pincel (paint_tiles).
      const [ground, ...rest] = room.layers;
      push("set_map", `mapa ${room.id}`, {
        tileset: pkg.map.tileset,
        size: room.grid,
        layers: ground ? [ground] : [],
        subroomIds: [room.id],
      });
      for (const layer of rest) {
        const cells = decodeRle(layer.rle, room.grid.cols * room.grid.rows)
          .map((tile, i) => ({ x: i % room.grid.cols, y: Math.floor(i / room.grid.cols), tile }))
          .filter((cell) => cell.tile !== 0);
        push("paint_tiles", `${layer.name} ${room.id}`, {
          subroomId: room.id,
          layer: layer.name,
          cells,
        });
      }
    }

    // ── Fase B — catálogo: inventario y textos (sin dependencias) ─────────
    for (const { id } of pkg.items) item(id);
    for (const { id } of pkg.dialogs) dialog(id);

    // ── Salón del Trono ───────────────────────────────────────────────────
    for (const id of ["trono", "cuadro-aurelio", "retrato-2", "retrato-3", "retrato-4"]) object(id);
    for (const id of ["tapiz-dragones", "armario", "brasero", "estatua-izq", "estatua-der"]) {
      object(id);
    }
    object("placa-izq");
    object("placa-der");
    rule("r-inicio");
    puzzle("p-llave-cuadro");
    rule("r-inspeccionar-cuadro");
    rule("r-imagen-cuadro");
    rule("r-inspeccionar-retrato-2");
    rule("r-inspeccionar-retrato-3");
    rule("r-inspeccionar-retrato-4");
    rule("r-inspeccionar-tapiz-dragones");
    rule("r-revelar-cuadro");
    rule("r-abrir-armario");
    // La mesa de combinar: de momento solo la receta cuyos ingredientes ya se
    // obtienen (yesquero + vela del armario). La llave de plata y la compuerta
    // de oro llegan en la Bodega y las Catacumbas.
    puzzleDraft("p-combina", (p) => {
      if (p.type !== "combine_items") throw new Error("p-combina debe ser combine_items");
      return { ...p, unlocks: [], recipes: p.recipes.slice(0, 1) };
    });
    rule("r-encender-brasero");
    // Candado del arca ↔ sus pistas; puzzle ↔ arca que abre.
    puzzleDraft("p-candado-arca", (p) => withoutUnlocks(withoutHints(p)));
    hint("hint-arca-1");
    hint("hint-arca-2");
    object("arca-candado");
    puzzle("p-candado-arca", true);
    rule("r-abrir-arca");
    rule("r-leer-pergamino");
    // Placas ↔ puerta de la Bodega.
    puzzleDraft("p-placas-estatuas", withoutUnlocks);
    object("puerta-bodega");
    puzzle("p-placas-estatuas", true);
    rule("r-placas-resueltas");

    // ── Bodega de los Vinos Encantados ────────────────────────────────────
    for (const id of ["mural-ranura", "compartimento-plata", "barril-espejo"]) object(id);
    object("mirilla-a");
    object("mirilla-b");
    puzzle("p-mural-vendimia");
    object("mural-vendimia");
    rule("r-mural-resuelto");
    rule("r-caliz-en-ranura");
    rule("r-recoger-caliz");
    puzzle("p-copas-memoria");
    object("mesa-catas");
    rule("r-copas-resueltas");
    puzzleDraft("p-reja-mirillas", withoutUnlocks);
    object("reja-escalera");
    puzzle("p-reja-mirillas", true);

    // ── Catacumbas del Rey ────────────────────────────────────────────────
    object("sarcofago");
    object("altar");
    object("vasijas");
    rule("r-entrar-catacumbas");
    rule("r-inspeccionar-sarcofago");
    rule("r-inspeccionar-vasijas");
    rule("r-imagen-vasijas");
    object("compuerta-oro");
    // Ya hay llave de plata (mural) y compuerta: la mesa de combinar completa.
    puzzle("p-combina", true);
    puzzle("p-canal-agua");
    object("canal-entrada");
    rule("r-canal-resuelto");
    puzzleDraft("p-sello-final", (p) => withoutUnlocks(withoutHints(p)));
    for (const id of ["hint-sello-1", "hint-sello-2", "hint-sello-3"]) hint(id);
    object("relicario");
    puzzle("p-sello-final", true);
    // ── Decoración e iluminación de cada habitación ───────────────────────
    // Al final: las antorchas gobernadas por un objeto (la del brasero) lo
    // necesitan ya dado de alta.
    for (const room of pkg.map.rooms) {
      push("decorate_subroom", `decoración y luces ${room.id}`, {
        subroomId: room.id,
        decorations: structuredClone(room.decorations),
        lighting: structuredClone(room.lighting),
      });
    }
    // ── Fase C — victoria y reloj ─────────────────────────────────────────
    rule("r-sello-resuelto");
    rule("r-aviso-10min");
    rule("r-tiempo-agotado");
    return out;
  };

  return { createRoom, steps };
}
