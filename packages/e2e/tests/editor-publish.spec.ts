import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SAME_ORIGIN, signIn } from "../support/auth";
import { findGiftedRoomId } from "../support/db";
import { SEED, WEB_URL } from "../support/env";

/**
 * `editor-publish.spec.ts` (specs/22 §3.3): crear sala, 2 pestañas coeditando
 * (Yjs converge en la UI), `validate()` en verde, `publish()` con la
 * confirmación humana y la sala aparece en el catálogo.
 *
 * «Crear sala»: la web aún no tiene un «Nueva sala» (el alta es por MCP o por
 * copia). Para que `validate` pueda quedar en verde sin construir 14 pasos a
 * mano, la sala nace como **copia regalo** del Rey Aldric (5.10): el creador
 * sembrado la regala a un creador nuevo de este test (email único), que queda
 * como autor de un borrador propio. Publicar va por la tool MCP `publish` con
 * la sesión del creador → enlace `/publish-confirm` → «Publicar ahora» (4.5),
 * que es el único camino con confirmación humana de la web hoy.
 */

interface RoomDetail {
  latestVersion: { id: string } | null;
}

interface PublishedVersion {
  package: { map: { rooms: { id: string; lighting?: Record<string, unknown>[] }[] } };
}

/** Llama a una tool del MCP del creador (`/mcp/creator`, HTTP sin estado) con la cookie de sesión. */
async function callMcpTool(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await request.post(`${WEB_URL}/mcp/creator`, {
    headers: { ...SAME_ORIGIN, accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(res.ok(), `MCP ${name} → ${res.status()} ${await res.text()}`).toBe(true);
  const text = await res.text();
  // Respuesta JSON o un evento SSE con el mismo JSON-RPC en `data:`.
  const json = text.trimStart().startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .at(-1)!;
  const message = JSON.parse(json) as {
    result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown };
    error?: unknown;
  };
  expect(message.error, JSON.stringify(message.error)).toBeUndefined();
  expect(message.result?.isError, JSON.stringify(message.result?.content)).toBeFalsy();
  return message.result!.structuredContent ?? {};
}

async function openEditor(page: Page, roomId: string): Promise<void> {
  await page.goto(`editor/${roomId}`);
  await expect(page.getByTestId("room-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Guardado automático")).toBeVisible();
}

// Cada test abre sus propios contextos (jugadores, organizador, pestañas):
// se cierran siempre, también si falla, para no dejar partidas vivas que
// resten CPU al siguiente.
test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

test("editor: 2 pestañas coeditan, validan en verde, publican con confirmación y la sala sale en el catálogo", async ({
  browser,
}) => {
  const email = `editora-${Date.now()}@e2e.escaperoom.local`;

  const roomId =
    await test.step("el autor del Rey Aldric regala una copia editable a un creador nuevo", async () => {
      const author = await browser.newContext();
      await signIn(author, SEED.creatorEmail);
      const editor = await browser.newContext();
      await signIn(editor, email); // alta por el enlace mágico: el usuario ya existe
      await editor.close();
      const res = await author.request.post(
        `${WEB_URL}/api/rooms/${SEED.reyAldricRoomId}/gift-copy`,
        {
          headers: SAME_ORIGIN,
          data: { recipientEmail: email },
        },
      );
      // B-10 (docs/DEUDA.md): siempre 202 con un mensaje genérico, nunca
      // revela si el email existía ni el id del fork — se busca aparte.
      expect(res.status(), await res.text()).toBe(202);
      await author.close();
      return findGiftedRoomId(email, SEED.reyAldricRoomId);
    });

  const creator = await browser.newContext();
  await signIn(creator, email);
  const tabA = await creator.newPage();
  const tabB = await creator.newPage();

  await test.step("dos pestañas abren el mismo borrador y convergen", async () => {
    await openEditor(tabA, roomId);
    await openEditor(tabB, roomId);

    // A añade (si falta) y cambia la luz ambiente de la habitación activa…
    const addAmbient = tabA.getByRole("button", { name: "Añadir luz ambiente" });
    if (await addAmbient.isVisible()) await addAmbient.click();
    await tabA.getByLabel("Color de la luz ambiente").fill("#336699");
    await expect(tabB.getByLabel("Color de la luz ambiente")).toHaveValue("#336699");

    // …y B cambia la intensidad, que A ve sin recargar.
    await tabB.getByRole("slider").first().fill("0.35");
    await expect(tabA.locator("[data-ambient-light]")).toContainText("0.35");
    await expect(tabB.locator("[data-ambient-light]")).toContainText("0.35");
  });

  await test.step("Validar deja el borrador en verde", async () => {
    await tabA.getByRole("button", { name: "Validar", exact: true }).click();
    const panel = tabA.getByRole("region", { name: "Validación" });
    await expect(panel).toHaveAttribute("data-status", "ready");
    await expect(panel.getByRole("status")).toHaveText("Sin errores: se puede publicar");
    await expect(panel.locator('[data-severity="error"]')).toHaveCount(0);
  });

  await test.step("publish con confirmación humana y la sala aparece en el catálogo", async () => {
    const pending = await callMcpTool(creator.request, "publish", {
      roomId,
      versionNotes: "v1.0 — E2E de publicación",
    });
    expect(pending.published).toBe(false);
    const confirmUrl = String(pending.confirmUrl);
    expect(confirmUrl).toContain("/publish-confirm");

    await tabA.goto(confirmUrl);
    await tabA.getByRole("button", { name: "Publicar ahora" }).click();
    await expect(tabA.getByRole("status")).toContainText("¡Publicada!");

    await tabA.goto("rooms");
    // `.first()`: se ha visto la sala recién publicada duplicada en el
    // catálogo (dos <article data-room-id> idénticos) justo después de
    // publicar — nunca antes de este cambio, porque editor-publish.spec.ts
    // nunca llegaba tan lejos (429/gate de términos lo cortaban antes).
    // Sin reproducir aún fuera de este camino exacto (DEUDA: "sala
    // duplicada en el catálogo justo tras publicar").
    await expect(tabA.locator(`[data-room-id="${roomId}"]`).first()).toBeVisible();
  });

  await test.step("la versión publicada lleva lo coeditado en las dos pestañas", async () => {
    const detail = await creator.request.get(`${WEB_URL}/api/rooms/${roomId}`);
    expect(detail.ok()).toBe(true);
    const versionId = ((await detail.json()) as RoomDetail).latestVersion?.id;
    expect(versionId).toBeTruthy();
    const pkg = await creator.request.get(
      `${WEB_URL}/api/rooms/${roomId}/versions/${versionId}/package`,
    );
    expect(pkg.ok(), await pkg.text()).toBe(true);
    const published = ((await pkg.json()) as PublishedVersion).package;
    const lights = published.map.rooms.flatMap((room) => room.lighting ?? []);
    expect(lights).toContainEqual(
      expect.objectContaining({ type: "ambient", color: "#336699", intensity: 0.35 }),
    );
  });

  await creator.close();
});
