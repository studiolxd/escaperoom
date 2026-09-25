import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SAME_ORIGIN, signIn } from "../support/auth";
import { LOCALE, SEED, WEB_URL } from "../support/env";
import { UiPlayer } from "../support/game";

/**
 * `event-flow.spec.ts` (specs/22 §3.3): organizador crea evento → claves en
 * lote → exporta el PDF → un contexto **sin cuenta** canjea una clave desde el
 * destino del QR de la tarjeta (`/{locale}/redeem?code=…`) → juega parcialmente
 * → el panel del organizador (otro contexto, ya abierto) refleja el progreso
 * en vivo.
 *
 * El organizador es el creador sembrado, autor del Rey Aldric: su evento es
 * autoventa (sin checkout, que llega con Stripe en 5.1). Crear el evento y
 * generar las claves no tiene UI todavía: se hace por la API REST, con la
 * sesión del organizador, igual que lo haría esa UI.
 */

interface RoomDetail {
  latestVersion: { id: string } | null;
}

interface AccessKeyItem {
  code: string;
  type: string;
  status: string;
}

// Cada test abre sus propios contextos (jugadores, organizador, pestañas):
// se cierran siempre, también si falla, para no dejar partidas vivas que
// resten CPU al siguiente.
test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

test("evento: claves en lote, PDF, canje sin cuenta y progreso en el panel del organizador", async ({
  browser,
}) => {
  const organizer = await browser.newContext({ acceptDownloads: true });
  await signIn(organizer, SEED.creatorEmail);
  const api = organizer.request;
  const title = `E2E evento ${Date.now()}`;

  const { eventId, codes } =
    await test.step("crea el evento y lo activa con un lote de claves", async () => {
      const room = await api.get(`${WEB_URL}/api/rooms/${SEED.reyAldricRoomId}`);
      expect(room.ok()).toBe(true);
      const versionId = ((await room.json()) as RoomDetail).latestVersion?.id;
      expect(versionId).toBeTruthy();

      const created = await api.post(`${WEB_URL}/api/events`, {
        headers: SAME_ORIGIN,
        data: {
          roomVersionId: versionId,
          title,
          maxSimultaneousSessions: 2,
          groupingMode: "random",
          requireConfirmation: false,
          expiryRules: [],
          playersPlanned: 8,
          locale: LOCALE,
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const event = (await created.json()) as { id: string; activatable?: boolean };

      const activated = await api.post(`${WEB_URL}/api/events/${event.id}/activate`, {
        headers: SAME_ORIGIN,
        data: { keyPlan: [{ type: "batch", count: 6 }] },
      });
      expect(activated.ok(), await activated.text()).toBe(true);

      const keys = await api.get(`${WEB_URL}/api/events/${event.id}/access-keys?limit=50`);
      expect(keys.ok()).toBe(true);
      const items = ((await keys.json()) as { items: AccessKeyItem[] }).items;
      expect(items).toHaveLength(6);
      expect(items.every((key) => key.type === "batch")).toBe(true);
      return { eventId: event.id, codes: items.map((key) => key.code) };
    });

  const panel = await organizer.newPage();
  await test.step("el panel del organizador muestra el evento y exporta el PDF de claves", async () => {
    await panel.goto(`events/${eventId}`);
    const dashboard = panel.getByTestId("event-dashboard");
    await expect(dashboard.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(dashboard.locator("dd").first()).toHaveText("6");
    await expect(panel.getByTestId("event-session-row")).toHaveCount(2);

    await panel.getByRole("button", { name: "Exportar claves (PDF)" }).click();
    const [download] = await Promise.all([
      panel.waitForEvent("download"),
      panel.getByRole("link", { name: "Descargar el PDF de claves" }).click(),
    ]);
    const pdf = readFileSync(await download.path());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  const guest = await browser.newContext();
  const player = new UiPlayer(await guest.newPage(), "Invitada");
  await test.step("un invitado sin cuenta canjea la clave desde el enlace del QR", async () => {
    const me = await guest.request.get(`${WEB_URL}/api/me`);
    expect(me.ok()).toBe(false);
    await player.page.goto(`redeem?code=${encodeURIComponent(codes[0]!)}`);
    await expect(player.page.getByLabel("Clave")).toHaveValue(codes[0]!);
    await player.page.getByLabel("Tu nombre").fill("Invitada");
    await player.page.getByRole("button", { name: "Entrar en la partida" }).click();
    await expect(player.page).toHaveURL(/\/play\?session=[\w-]+#joinToken=/u);
    await expect(player.session).toBeVisible({ timeout: 30_000 });
    await expect(player.page.getByTestId("game-players")).toContainText("Invitada");
  });

  await test.step("juega parcialmente (pasos 1–5 del Rey Aldric)", async () => {
    await player.page.getByTestId("game-start").click();
    await expect(player.session).toHaveAttribute("data-phase", "playing");
    await player.closeDialog();
    await player.dismissDialogsWhenBlocking();
    await player.inspect("cuadro-aurelio");
    await player.expectItems("Llave de bronce");
    await player.useItemOn("armario", "Llave de bronce");
    await player.combine(["Yesquero", "Vela"], "Antorcha encendida");
    await player.inspect("brasero");
    await player.openPanel("arca-candado");
    await player.typeCode("4732");
    await player.expectItems("Cáliz real", "Pergamino de los vinos");
    await player.expectSolvedAtLeast(2);
  });

  await test.step("el panel (ya abierto) refleja el progreso del grupo en vivo", async () => {
    const dashboard = panel.getByTestId("event-dashboard");
    await expect(dashboard).toContainText("1 activas de 2", { timeout: 30_000 });
    const playing = panel.getByTestId("event-session-row").filter({ hasText: "Jugando" });
    await expect(playing).toHaveCount(1, { timeout: 30_000 });
    await expect
      .poll(
        async () => Number(await playing.getByRole("progressbar").getAttribute("aria-valuenow")),
        {
          timeout: 30_000,
        },
      )
      .toBeGreaterThanOrEqual(2);
    await expect(dashboard.locator("dd").nth(3)).toHaveText("1");
  });

  await guest.close();
  await organizer.close();
});
