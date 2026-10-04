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

declare global {
  interface Window {
    /** Expuesto por `GameSessionShell` solo para E2E — ver `clickObjectOnCanvas`. */
    __escaperoomGame?: {
      getObjectScreenFraction: (objectId: string) => { x: number; y: number } | undefined;
      isObjectInteractive: (objectId: string) => boolean;
    };
  }
}

/** El mismo RoomPackage que sirven web y colyseus-server (`room-rey-aldric`). */
export const REY_ALDRIC: RoomPackage = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "docs/reference/roompackage-rey-aldric.v1.json"), "utf8"),
) as RoomPackage;

/** Nombre visible (es) de un objeto de Rey Aldric, tal como lo muestra el menú contextual. */
function objectName(objectId: string): string {
  const object = REY_ALDRIC.objects.find((candidate) => candidate.id === objectId);
  const name = object?.name?.es?.text;
  if (!name) throw new Error(`Objeto sin nombre en español: ${objectId}`);
  return name;
}

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

  /**
   * Marca "Listo" en el lobby (C-13): lo exige `start_game` antes de dejar
   * empezar. Sin pack generado (`pnpm pack:build`, .gitignore — el caso de
   * un clon limpio o CI) no hay ningún `character-option-*` que elegir: el
   * selector ni se monta y el propio servidor asigna el maniquí de reserva
   * (`lobby-panel.tsx`), así que "¡Vamos!" ya sale habilitado solo.
   */
  async markReady(): Promise<void> {
    const options = this.page.locator('[data-testid^="character-option-"]:not([disabled])');
    if (
      await options
        .first()
        .isVisible({ timeout: 2_000 })
        .catch(() => false)
    ) {
      // El radio real es `sr-only` (oculto); es su <label> visible quien
      // recibe el clic real (y lo reenvía al radio por debajo), así que se
      // clica la etiqueta en vez del radio directamente. El primero LIBRE
      // (no `disabled`, ya lo tiene otro jugador conectado).
      await options.first().locator("xpath=ancestor::label[1]").click();
    }
    await this.page.getByTestId("lobby-ready").click();
  }

  /**
   * Tras «Empezar» (encargo lobby-diseño): cierra la introducción de la sala
   * si la hay, espera a su 3-2-1 (3 s, sin botón de saltar) y a entrar al
   * mapa en fase de juego.
   */
  async enterMapAfterStart(): Promise<void> {
    await expect(this.session).not.toHaveAttribute("data-stage", "lobby", { timeout: 15_000 });
    const intro = this.page.getByTestId("game-intro-continue");
    if (await intro.isVisible().catch(() => false)) await intro.click();
    await expect(this.session).toHaveAttribute("data-stage", "map", { timeout: 15_000 });
    await expect(this.session).toHaveAttribute("data-phase", "playing");
  }

  /**
   * A partir de aquí, los diálogos de lore (cuadro, brasero, pergamino…) y el
   * panel de imagen de inspección (`show_image`, retratos/tapiz/vasijas) se
   * cierran solos cuando tapan el mundo, como haría una persona al seguir.
   * Ojo: el handler de Playwright también corre antes de cada aserción.
   */
  async dismissDialogsWhenBlocking(): Promise<void> {
    // Dos handlers independientes (uno por testid: Playwright exige que el
    // locator de un handler resuelva a un único elemento, así que no se
    // pueden combinar con `.or()` cuando los dos pueden estar visibles a la
    // vez). Pueden dispararse casi a la vez (varios objetos otorgan ítem +
    // diálogo de lore seguidos): el `catch` ignora que el otro handler ya
    // haya cerrado/desmontado el elemento antes de que este llegue a clicar.
    await this.page.addLocatorHandler(
      this.page.getByTestId("game-dialog"),
      async (dialog) => {
        const imagePanel = this.page.getByTestId("game-image-panel");
        if (await imagePanel.isVisible().catch(() => false)) {
          await imagePanel
            .getByRole("button", { name: "Close" })
            .click({ timeout: 2_000 })
            .catch(() => undefined);
          return;
        }
        await dialog.click({ timeout: 2_000 }).catch(() => undefined);
      },
      { noWaitAfter: true },
    );
    await this.page.addLocatorHandler(
      this.page.getByTestId("game-image-panel"),
      async (imagePanel) => {
        await imagePanel
          .getByRole("button", { name: "Close" })
          .click({ timeout: 2_000 })
          .catch(() => undefined);
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
   * Clic directo sobre el objeto en el canvas isométrico: la partida real no
   * tiene lista de botones por objeto (`ObjectsBar`, solo en el playtest),
   * así que el sitio exacto sale de `window.__escaperoomGame` (expuesto por
   * `GameSessionShell` solo para esto, `getObjectScreenFraction`) como
   * fracción (0–1) del lienzo, resuelta a píxel contra su tamaño real en
   * pantalla. Reintenta mientras el objeto no esté en la sala visible
   * (p. ej. justo tras cruzar a otra sala).
   */
  private async clickObjectOnCanvas(objectId: string, waitInteractive = true): Promise<void> {
    const canvas = this.page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    // Espera a que el objeto responda al clic: un objeto recién revelado (la
    // llave tras inspeccionar el cuadro) llega por el servidor un instante
    // después, y mientras está oculto no tiene zona de clic ni un punto
    // opaco donde clicar.
    const fraction = await this.page.waitForFunction(
      ([id, interactive]) =>
        (interactive && !window.__escaperoomGame?.isObjectInteractive(id as string)
          ? null
          : window.__escaperoomGame?.getObjectScreenFraction(id as string)) ?? null,
      [objectId, waitInteractive] as const,
      { timeout: 15_000 },
    );
    let point = (await fraction.jsonValue()) as { x: number; y: number };
    const box = await canvas.boundingBox();
    if (!box) throw new Error("El canvas del juego no tiene tamaño en pantalla.");
    if (await this.page.locator("[data-dimension='3d']").count()) {
      point = await this.freeCanvasPoint(objectId, point, box);
    }
    await this.page.mouse.click(box.x + point.x * box.width, box.y + point.y * box.height);
  }

  /**
   * Solo 3D: el objeto puede quedar bajo un panel de la interfaz (jugadores, chat, inventario…),
   * y entonces el clic no llega al canvas. Si el punto no es el `<canvas>` (`elementFromPoint`),
   * se gira la cámara arrastrando (como una persona) alternando de lado y se vuelve a pedir el
   * punto al runtime, hasta un tope de intentos.
   */
  private async freeCanvasPoint(
    objectId: string,
    first: { x: number; y: number },
    box: { x: number; y: number; width: number; height: number },
  ): Promise<{ x: number; y: number }> {
    const MAX_ATTEMPTS = 12;
    const isCanvasAt = (p: { x: number; y: number }) =>
      this.page.evaluate(
        ([px, py]) => document.elementFromPoint(px as number, py as number)?.tagName === "CANVAS",
        [box.x + p.x * box.width, box.y + p.y * box.height],
      );
    let point: { x: number; y: number } | undefined = first;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Sentido del giro (+1/-1) que acerca el objeto al centro de la pantalla; se invierte si
    // el último giro lo aleja o lo saca de plano (se vuelve atrás con el giro contrario).
    let direction = point.x < 0.5 ? 1 : -1;
    const drag = async (dx: number) => {
      await this.page.mouse.move(cx, cy);
      await this.page.mouse.down();
      await this.page.mouse.move(cx + dx, cy, { steps: 6 });
      await this.page.mouse.up();
      await this.page.waitForTimeout(400); // la cámara sigue al avatar con un pequeño retardo
    };
    const readPoint = () =>
      this.page.evaluate((id) => window.__escaperoomGame?.getObjectScreenFraction(id), objectId);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (point && (await isCanvasAt(point))) return point;
      const before: { x: number; y: number } | undefined = point;
      await drag(direction * 40);
      point = await readPoint();
      const worse =
        !point || (before !== undefined && Math.abs(point.x - 0.5) > Math.abs(before.x - 0.5));
      if (worse) {
        direction = -direction;
        await drag(direction * 40); // deshace el giro
        point = await readPoint();
      }
    }
    throw new Error(
      `«${objectId}» queda siempre bajo la interfaz o fuera de plano tras ${MAX_ATTEMPTS} giros de cámara: no hay punto del canvas donde clicar.`,
    );
  }

  /**
   * Clic en el objeto → acción del menú contextual. Si en esa celda hay
   * varios objetos apilados (bodega (3,0): mural, ranura y compartimento),
   * el clic acierta al de encima y el menú ofrece los demás por su nombre:
   * se elige el pedido, como haría una persona.
   */
  private async objectAction(objectId: string, action: string): Promise<void> {
    await this.clickObjectOnCanvas(objectId);
    await expect(this.page.getByRole("button", { name: "Cancelar", exact: true })).toBeVisible();
    const here = this.page.getByRole("group", { name: "Objetos en este sitio" });
    if (await here.isVisible()) {
      const choice = here.getByRole("button", { name: objectName(objectId), exact: true });
      if ((await choice.getAttribute("aria-pressed")) !== "true") await choice.click();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
    }
    await this.page.getByRole("button", { name: action, exact: true }).click();
  }

  /**
   * Comprueba que un objeto en estado `"oculto"` (p. ej. la llave del suelo
   * antes de revelar el cuadro) NO abre el menú contextual al clicarlo — la
   * zona de clic se desactiva mientras esté oculto (revisión en vivo).
   * El punto clicado cae sobre el objeto y fuera de cualquier otro objeto
   * clicable (`getObjectScreenFraction`), y el menú se abriría al llegar el
   * avatar, no en el acto: se deja caminar antes de comprobar que no hay
   * menú (un `not.toBeVisible` inmediato pasaba siempre).
   */
  async expectNotInteractable(objectId: string): Promise<void> {
    await this.clickObjectOnCanvas(objectId, false);
    await this.page.waitForTimeout(3_000);
    await expect(
      this.page.getByRole("button", { name: "Cancelar", exact: true }),
    ).not.toBeVisible();
  }

  async inspect(objectId: string): Promise<void> {
    await this.objectAction(objectId, "Inspeccionar");
  }

  /**
   * Se sube a una placa de presión (`simultaneous_plates`): clic en la placa →
   * el avatar camina hasta quedar sobre su celda y se abre su menú, que se
   * cierra con «Cancelar» sin moverse (la placa se acciona mientras alguien
   * esté encima, sin botones ni panel).
   */
  async standOn(objectId: string): Promise<void> {
    await this.clickObjectOnCanvas(objectId);
    const cancel = this.page.getByRole("button", { name: "Cancelar", exact: true });
    await expect(cancel).toBeVisible();
    await cancel.click();
  }

  /**
   * Recoge un objeto caído en el suelo (la llave del cuadro, el yesquero, la
   * antorcha apagada): su menú ofrece solo «Recoger» + «Cancelar», sin
   * «Inspeccionar» ni «Usar objeto».
   */
  async pickUp(objectId: string): Promise<void> {
    await this.objectAction(objectId, "Recoger");
  }

  /**
   * "Abrir panel" ya no existe como botón del menú (revisión en vivo,
   * quitado): "Inspeccionar" ya abre el panel del puzzle asociado al objeto
   * (`useGameHud.inspect`), así que abrir su panel es simplemente
   * inspeccionarlo.
   */
  async openPanel(objectId: string): Promise<void> {
    await this.inspect(objectId);
  }

  /** «Usar objeto…» sobre `objectId` y elegir `itemName` en el selector. */
  async useItemOn(objectId: string, itemName: string): Promise<void> {
    await this.objectAction(objectId, "Usar objeto…");
    await this.page.getByRole("button", { name: itemName, exact: true }).click();
  }

  /** X del `Dialog` estándar (124345b: ya no hay botón "Cerrar" a medida). */
  async closePanel(): Promise<void> {
    await this.page.locator('[data-slot="dialog-close"]').first().click();
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
    // X del `Dialog` estándar (124345b: ya no hay botón "Cerrar" a medida).
    await overlay.locator('[data-slot="dialog-close"]').click();
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

  /**
   * Cruza una puerta ABIERTA por su id de objeto (p. ej. `puerta-bodega`):
   * clic directo en el canvas — al llegar, `useGameHud.onWorldEvent` detecta
   * que es una puerta abierta y la cruza sola (`enterRoom`), sin menú
   * contextual (el clic normal nunca alcanza la baldosa de la puerta por sí
   * solo; solo `walkTo`, autoritativo en el servidor, la cruza de verdad).
   * Espera a que la propia puerta deje de estar en la sala visible (la
   * escena ya cambió de sala) antes de devolver el control. El HUD ya no
   * muestra el nombre de la sala actual (c105a4c, "sin cabecera fija"): los
   * tests verifican la sala de destino inspeccionando un objeto suyo con
   * `inspect`/`openPanel`.
   */
  async goTo(doorObjectId: string): Promise<void> {
    await this.clickObjectOnCanvas(doorObjectId);
    await this.page.waitForFunction(
      (id) => window.__escaperoomGame?.getObjectScreenFraction(id) === undefined,
      doorObjectId,
      { timeout: 15_000 },
    );
  }

  /**
   * Puzzles que el servidor ha dado por resueltos. El HUD ya no muestra el
   * contador «Puzzles» (revisión en vivo, #185): se lee del
   * `data-solved-puzzles` de `game-session`, que sale del mismo snapshot.
   */
  async expectSolvedAtLeast(count: number): Promise<void> {
    await expect
      .poll(async () => Number(await this.session.getAttribute("data-solved-puzzles")))
      .toBeGreaterThanOrEqual(count);
  }
}

/**
 * Salas 3D: la cámara va detrás del avatar y a veces deja un objeto fuera de plano (pegada a un muro,
 * de espaldas…). Como haría una persona, se arrastra el ratón para girarla hasta verlo.
 */
export async function rotateCameraUntilVisible(page: Page, objectId: string): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("El canvas del juego no tiene tamaño en pantalla.");
  for (let turn = 0; turn < 12; turn += 1) {
    const fraction = await page.evaluate(
      (id) => window.__escaperoomGame?.getObjectScreenFraction(id) ?? null,
      objectId,
    );
    if (fraction && fraction.x > 0.1 && fraction.x < 0.9 && fraction.y > 0.1 && fraction.y < 0.9) {
      return;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
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

/**
 * Comprueba que las `cols·rows` celdas del tablero (`data-slot="sliding-board"
 * > *`, en el mismo orden row-major que pinta `SlidingPanel`) ocupan de
 * verdad una rejilla 2D visible: todas las celdas miden lo mismo (alto y
 * ancho) y las filas quedan a alturas (`y`) distintas y crecientes, no todas
 * apiladas en una (regresión: "solo se ve la última fila del mural" — el
 * `size-16` + `h-auto` de cada ficha dejaba `h-auto` ganar la altura, que sin
 * texto colapsa a ~0px; solo la fila con el hueco, sin `h-auto`, tenía alto
 * real). Una celda de 2px de alto pasaría un check que solo mirase "> 0", así
 * que compara cada celda contra el tamaño de la mayor.
 */
export async function expectSlidingBoardLaidOutAsGrid(
  page: Page,
  cols: number,
  rows: number,
): Promise<void> {
  const cells = page.locator('[data-slot="sliding-board"] > *');
  await expect(cells).toHaveCount(cols * rows);
  const boxes = await cells.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );

  const expectedHeight = Math.max(...boxes.map((box) => box.height));
  const expectedWidth = Math.max(...boxes.map((box) => box.width));
  expect(expectedHeight).toBeGreaterThan(8);
  for (const box of boxes) {
    expect(box.height).toBeGreaterThan(expectedHeight * 0.9);
    expect(box.width).toBeGreaterThan(expectedWidth * 0.9);
  }

  const rowTops = Array.from({ length: rows }, (_, row) => boxes[row * cols]!.y);
  const distinctRowTops = new Set(rowTops.map((y) => Math.round(y)));
  expect(distinctRowTops.size).toBe(rows);
  for (let row = 1; row < rows; row += 1) {
    expect(rowTops[row]).toBeGreaterThan(rowTops[row - 1]!);
  }

  const colLefts = Array.from({ length: cols }, (_, col) => boxes[col]!.x);
  const distinctColLefts = new Set(colLefts.map((x) => Math.round(x)));
  expect(distinctColLefts.size).toBe(cols);
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
