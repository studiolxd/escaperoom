import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { PipesPuzzleDefinition, RoomPackage } from "@escaperoom/shared/schemas";
import { createPipesState, slidingNeighborIndices } from "@escaperoom/shared/templates";
import { REPO_ROOT } from "./env";

/**
 * Un jugador de la partida en red dirigido **solo por la UI**: botones de
 * objeto, menú de acciones, selector de ítems, inventario y los paneles de
 * cada plantilla (`components/game-session`, `components/puzzles`). No toca
 * el protocolo: cada intención sale del cliente web por el WebSocket real.
 *
 * Los textos son los de `messages/es.json` (la suite corre en `es`).
 */

/** El mismo RoomPackage que sirven web y colyseus-server (`room-rey-aldric`). */
export const REY_ALDRIC: RoomPackage = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "docs/reference/roompackage-rey-aldric.v1.json"), "utf8"),
) as RoomPackage;

export const ROOM_NAMES = {
  bodega: "La Bodega de los Vinos Encantados",
  catacumbas: "Las Catacumbas del Rey",
} as const;

/**
 * Ritmo de persona en los paneles: la `GameRoom` admite 2 `puzzle_attempt`/s
 * por puzzle (specs/11 §9, ticket 6.3) y descarta el resto con `RATE_LIMITED`.
 * Un jugador real no voltea ni gira más rápido; el test tampoco.
 */
const ATTEMPT_SPACING_MS = 550;

export class UiPlayer {
  private lastAttemptAt = 0;

  constructor(
    readonly page: Page,
    readonly name: string,
  ) {}

  /** Clic que envía un `puzzle_attempt`, respetando el límite por puzzle. */
  async attemptClick(target: Locator): Promise<void> {
    const wait = this.lastAttemptAt + ATTEMPT_SPACING_MS - Date.now();
    if (wait > 0) await this.page.waitForTimeout(wait);
    await target.click();
    this.lastAttemptAt = Date.now();
  }

  get session(): Locator {
    return this.page.getByTestId("game-session");
  }

  /** Pantalla de nombre → «Crear partida» / «Unirme». */
  async enterName(): Promise<void> {
    const join = this.page.getByTestId("game-join");
    await expect(join).toBeVisible();
    await join.getByRole("textbox").fill(this.name);
    await this.page.getByTestId("game-enter").click();
    await expect(this.session).toBeVisible({ timeout: 30_000 });
  }

  /** Marca "Listo" en el lobby (C-13): lo exige `start_game` antes de dejar empezar. */
  async markReady(): Promise<void> {
    await this.page.getByTestId("lobby-ready").click();
  }

  /** Cierra el diálogo abierto (intro, lore): mientras está, el mundo no acepta clics. */
  async closeDialog(): Promise<void> {
    const dialog = this.page.getByTestId("game-dialog");
    await expect(dialog).toBeVisible();
    await dialog.click();
    await expect(dialog).toBeHidden();
  }

  /**
   * A partir de aquí, los diálogos de lore (cuadro, brasero, pergamino…) y el
   * panel de imagen de inspección (`show_image`, retratos/tapiz/vasijas) se
   * cierran solos cuando tapan el mundo, como haría una persona al seguir.
   * Ojo: el handler de Playwright también corre antes de cada aserción.
   */
  async dismissDialogsWhenBlocking(): Promise<void> {
    // El panel de imagen (`show_image`) es un overlay de shadcn/ui por
    // encima del diálogo de lore: si los dos están abiertos a la vez, el
    // handler de `game-dialog` no puede clicar a través del panel de
    // imagen, así que lo cierra primero (Escape) antes de intentarlo.
    await this.page.addLocatorHandler(
      this.page.getByTestId("game-dialog"),
      async (dialog) => {
        const imagePanel = this.page.getByTestId("game-image-panel");
        if (await imagePanel.isVisible().catch(() => false)) {
          await this.page.keyboard.press("Escape");
          return;
        }
        await dialog.click();
      },
      { noWaitAfter: true },
    );
    await this.page.addLocatorHandler(
      this.page.getByTestId("game-image-panel"),
      async () => {
        await this.page.keyboard.press("Escape");
      },
      { noWaitAfter: true },
    );
  }

  /** Deja de cerrar diálogos (la pantalla de resultados tapa el último, y está bien). */
  async stopDismissingDialogs(): Promise<void> {
    await this.page.removeLocatorHandler(this.page.getByTestId("game-dialog"));
    await this.page.removeLocatorHandler(this.page.getByTestId("game-image-panel"));
  }

  /**
   * Botón del objeto en la lista «Objetos». Localizado por `data-testid`, no
   * por su texto visible: desde F-27 (auditoría 2026-09-24) el texto es el
   * nombre localizado del objeto (o un genérico), nunca su id técnico.
   */
  private objectButton(objectId: string): Locator {
    return this.page.getByTestId(`game-object-${objectId}`);
  }

  /** Clic en el objeto → acción del menú contextual. */
  private async objectAction(objectId: string, action: string): Promise<void> {
    await this.objectButton(objectId).click();
    await this.page.getByRole("button", { name: action, exact: true }).click();
  }

  async inspect(objectId: string): Promise<void> {
    await this.objectAction(objectId, "Inspeccionar");
  }

  async openPanel(objectId: string): Promise<void> {
    await this.objectAction(objectId, "Abrir panel");
  }

  /** «Usar objeto…» sobre `objectId` y elegir `itemName` en el selector. */
  async useItemOn(objectId: string, itemName: string): Promise<void> {
    await this.objectAction(objectId, "Usar objeto…");
    await this.page.getByRole("button", { name: itemName, exact: true }).click();
  }

  async closePanel(): Promise<void> {
    await this.page.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  }

  async expectItems(...itemNames: string[]): Promise<void> {
    const inventory = this.page.getByTestId("game-inventory");
    for (const item of itemNames) await expect(inventory).toContainText(item);
  }

  /** Inventario (panel de combinación): selecciona los ítems y pulsa «Combinar». */
  async combine(itemNames: string[], expected: string): Promise<void> {
    await this.page.getByTestId("game-open-inventory").click();
    const overlay = this.page.getByTestId("game-inventory-overlay");
    await expect(overlay.getByRole("button", { name: "Combinar" })).toBeVisible();
    for (const item of itemNames) {
      await overlay.getByRole("option", { name: item, exact: true }).click();
    }
    await overlay.getByRole("button", { name: "Combinar" }).click();
    await expect(overlay).toContainText(`Has creado: ${expected}`);
    await overlay.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(overlay).toBeHidden();
    await this.expectItems(expected);
  }

  /** Teclado de un candado numérico: dígito a dígito y «Abrir». */
  async typeCode(code: string): Promise<void> {
    const panel = this.page.getByRole("region", { name: "Candado numérico" });
    await expect(panel).toBeVisible();
    for (const digit of code) {
      await panel.getByRole("button", { name: `Dígito ${digit}`, exact: true }).click();
    }
    await panel.getByRole("button", { name: "Abrir", exact: true }).click();
  }

  /** «Ir a {sala}»: el botón de la puerta abierta camina hasta ella y cruza. */
  async goTo(roomName: string): Promise<void> {
    await this.page.getByRole("button", { name: `Ir a ${roomName}`, exact: true }).click();
    await expect(this.page.getByTestId("game-room")).toContainText(roomName);
  }

  /** Objetos que el servidor ha dado por resueltos (contador «Puzzles» del HUD). */
  async expectSolvedAtLeast(count: number): Promise<void> {
    await expect
      .poll(async () => {
        const text = await this.page
          .getByTestId("game-inventory")
          .locator("xpath=..")
          .locator("dd")
          .textContent();
        return Number(text?.split("/")[0] ?? 0);
      })
      .toBeGreaterThanOrEqual(count);
  }
}

// — Plantillas que exigen «pensar»: el test razona sobre lo que ve el DOM ——

/** Tablero del puzle deslizante tal como lo pinta el panel (0 = hueco). */
async function readSlidingBoard(page: Page): Promise<number[]> {
  return page
    .locator('[data-slot="sliding-board"] > *')
    .evaluateAll((cells) =>
      cells.map((cell) =>
        cell.getAttribute("data-slot") === "sliding-blank"
          ? 0
          : Number(cell.getAttribute("data-tile")),
      ),
    );
}

function encode(board: readonly number[]): number {
  return board.reduce((key, tile) => key * 10 + tile, 0);
}

/** BFS sobre el tablero visible: índices de las piezas a pulsar hasta ordenarlo. */
export function solveSliding(tiles: number[], cols: number, rows: number): number[] {
  const goal = encode([...Array.from({ length: cols * rows - 1 }, (_, i) => i + 1), 0]);
  const start = encode(tiles);
  const previous = new Map<number, { from: number; move: number } | null>([[start, null]]);
  const boards = new Map<number, number[]>([[start, tiles.slice()]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const key = queue[head]!;
    if (key === goal) break;
    const board = boards.get(key)!;
    boards.delete(key);
    const blank = board.indexOf(0);
    for (const index of slidingNeighborIndices({ cols, rows }, blank)) {
      const candidate = board.slice();
      candidate[blank] = candidate[index]!;
      candidate[index] = 0;
      const candidateKey = encode(candidate);
      if (previous.has(candidateKey)) continue;
      previous.set(candidateKey, { from: key, move: index });
      boards.set(candidateKey, candidate);
      queue.push(candidateKey);
    }
  }
  const moves: number[] = [];
  for (let step = previous.get(goal); step; step = previous.get(step.from)) {
    moves.unshift(step.move);
  }
  return moves;
}

/** Paso 7: el mural pieza a pieza, pulsando cada pieza y esperando a que el servidor la mueva. */
export async function solveMural(player: UiPlayer): Promise<void> {
  const { page } = player;
  const board = page.locator('[data-slot="sliding-board"]');
  await expect(board).toBeVisible();
  const moves = solveSliding(await readSlidingBoard(page), 3, 3);
  expect(moves.length).toBeGreaterThan(0);
  for (const index of moves) {
    const before = await readSlidingBoard(page);
    const tile = before[index]!;
    await player.attemptClick(board.getByRole("button", { name: `Pieza ${tile}`, exact: true }));
    // El panel solo cambia cuando llega la vista nueva del servidor.
    await expect.poll(() => readSlidingBoard(page).then((b) => b.indexOf(tile))).not.toBe(index);
  }
}

/**
 * Paso 10: memoria de copas con dos jugadores turnándose. Un jugador solo ve
 * el símbolo de la **primera** carta de cada turno (en un fallo la segunda
 * vuelve boca abajo en la misma vista), así que la estrategia es la de una
 * persona: voltear primero una carta desconocida y buscar su pareja si ya se
 * vio; si no, otra desconocida.
 */
export async function solveMemory(players: UiPlayer[]): Promise<void> {
  const known = new Map<string, string>();
  for (let turn = 0; turn < 24; turn += 1) {
    const player = players[turn % players.length]!;
    const { page } = player;
    const board = page.getByRole("listbox", { name: "Tablero de memoria" });
    await expect(board).toBeVisible();
    const cards = await board.locator("[data-card-id]").evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute("data-card-id")!,
        matched: el.getAttribute("data-matched") === "true",
      })),
    );
    const hidden = cards.filter((card) => !card.matched).map((card) => card.id);
    if (hidden.length === 0) return;

    const knownPair = hidden
      .flatMap((a) =>
        hidden
          .filter((b) => b !== a && known.has(a) && known.get(a) === known.get(b))
          .map((b) => [a, b] as const),
      )
      .at(0);
    const first = knownPair?.[0] ?? hidden.find((id) => !known.has(id)) ?? hidden[0]!;
    const firstCard = board.locator(`[data-card-id="${first}"]`);
    await player.attemptClick(firstCard);
    await expect(firstCard).toHaveAttribute("data-flipped", "true");
    const symbol = (await firstCard.locator('[data-slot="memory-symbol"]').textContent())!.trim();
    known.set(first, symbol);

    const second =
      knownPair?.[1] ??
      hidden.find((id) => id !== first && known.get(id) === symbol) ??
      hidden.find((id) => id !== first && !known.has(id)) ??
      hidden.find((id) => id !== first)!;
    await player.attemptClick(board.locator(`[data-card-id="${second}"]`));
    // Fin de turno: pareja (emparejadas), fallo (boca abajo) o tablero resuelto
    // (el panel se cierra solo con `puzzle_solved`).
    let outcome = "";
    await expect
      .poll(async () => {
        if ((await board.count()) === 0) return (outcome = "solved");
        const matched = await firstCard.getAttribute("data-matched", { timeout: 1_000 });
        const flipped = await firstCard.getAttribute("data-flipped", { timeout: 1_000 });
        if (matched === "true") return (outcome = "match");
        if (flipped === "false") return (outcome = "mismatch");
        return "";
      })
      .not.toBe("");
    if (outcome === "solved") return;
    if (outcome === "match") known.set(second, symbol);
  }
  throw new Error("La memoria de copas no se resolvió en 24 turnos.");
}

/** Fragmentos que muestra el panel de mirillas de este jugador, por índice. */
export async function readSplitFragments(player: UiPlayer): Promise<Record<number, string>> {
  const slots = player.page.locator('[data-slot="split-clue-visible"][data-visible="true"]');
  await expect(slots.first()).toBeVisible();
  const entries = await slots.evaluateAll((els) =>
    els.map((el) => [Number(el.getAttribute("data-index")), el.getAttribute("aria-label")!]),
  );
  return Object.fromEntries(entries) as Record<number, string>;
}

/** Introduce la combinación en la paleta de símbolos y pulsa «Comprobar». */
export async function submitSymbols(player: UiPlayer, symbols: string[]): Promise<void> {
  for (const symbol of symbols) {
    await player.page.getByRole("button", { name: `Símbolo ${symbol}`, exact: true }).click();
  }
  await player.page.getByRole("button", { name: "Comprobar", exact: true }).click();
}

/**
 * Paso 12: abre la compuerta (usa la llave de oro) y orienta cada pieza hacia
 * la solución de la plantilla, un clic por cuarto de vuelta. El jugador real
 * «prueba» hasta que el agua llega; el test usa el testigo determinista.
 */
export async function solveCanal(player: UiPlayer): Promise<void> {
  const { page } = player;
  const board = page.locator('[data-slot="pipes-board"]');
  await expect(board).toBeVisible();
  const gate = board.locator('[data-gate="closed"]');
  await player.attemptClick(gate);
  await expect(board.locator('[data-gate="open"]')).toHaveCount(1);

  const def = REY_ALDRIC.puzzles.find(
    (puzzle) => puzzle.id === "p-canal-agua",
  ) as PipesPuzzleDefinition;
  const witness = createPipesState(def).solution;
  const cells = await board.locator('[data-rotatable="true"]').evaluateAll((els) =>
    els.map((el) => ({
      index: Number(el.getAttribute("data-cell")),
      rotation: Number(el.getAttribute("data-rotation")),
    })),
  );
  // Con el agua en el altar el servidor resuelve y el panel se cierra solo.
  const done = async (): Promise<boolean> =>
    (await board.count()) === 0 || (await board.getAttribute("data-connected")) === "true";
  for (const cell of cells) {
    const turns = (((witness[cell.index]! - cell.rotation) % 4) + 4) % 4;
    const button = board.locator(`[data-cell="${cell.index}"]`);
    for (let turn = 1; turn <= turns; turn += 1) {
      if (await done()) return;
      await player.attemptClick(button);
      const expected = String((cell.rotation + turn) % 4);
      await expect
        .poll(
          async () => (await done()) || (await button.getAttribute("data-rotation")) === expected,
        )
        .toBe(true);
    }
  }
  expect(await done(), "el agua no llegó al altar tras orientar todas las piezas").toBe(true);
}
