import { expect, test } from "@playwright/test";
import { SAME_ORIGIN, signIn } from "../support/auth";
import { LOCALE, SEED, WEB_URL } from "../support/env";
import { UiPlayer } from "../support/game";

/**
 * "Todos los grupos comienzan juntos" (ticket "inicio conjunto", specs/11
 * §2.2, specs/19 §2): dos grupos de un evento (una sesión cada uno), el
 * organizador activa la opción desde el panel, ambos anfitriones ven
 * "Esperando al organizador" en vez de «Empezar», y "Comenzar todos" arranca
 * los dos a la vez.
 */

interface RoomDetail {
  latestVersion: { id: string } | null;
}

test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

test("inicio conjunto: el organizador activa la opción y arranca dos grupos a la vez", async ({
  browser,
}) => {
  const organizer = await browser.newContext();
  await signIn(organizer, SEED.creatorEmail);
  const api = organizer.request;
  const title = `E2E inicio conjunto ${Date.now()}`;

  const { eventId, codes } = await test.step(
    "crea un evento con 2 sesiones y una clave individual por sesión",
    async () => {
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
          groupingMode: "specific",
          requireConfirmation: false,
          expiryRules: [],
          // +1 para el plan mínimo de activación (una clave sin preasignar,
          // que este test no usa): las dos que se usan se generan después,
          // una por sesión.
          playersPlanned: 3,
          locale: LOCALE,
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const event = (await created.json()) as { id: string };

      const activated = await api.post(`${WEB_URL}/api/events/${event.id}/activate`, {
        headers: SAME_ORIGIN,
        data: { keyPlan: [{ type: "individual", count: 1 }] },
      });
      expect(activated.ok(), await activated.text()).toBe(true);
      const sessions = (await activated.json()) as { sessions: Array<{ id: string }> };
      expect(sessions.sessions).toHaveLength(2);

      const keys = await Promise.all(
        sessions.sessions.map((session) =>
          api
            .post(`${WEB_URL}/api/events/${event.id}/access-keys`, {
              headers: SAME_ORIGIN,
              data: { type: "individual", count: 1, sessionId: session.id },
            })
            .then(async (res) => {
              expect(res.ok(), await res.text()).toBe(true);
              const body = (await res.json()) as { items: Array<{ code: string }> };
              return body.items[0]!.code;
            }),
        ),
      );
      return { eventId: event.id, codes: keys };
    },
  );

  const panel = await organizer.newPage();
  await test.step('el organizador activa "Todos los grupos comienzan juntos" en el panel', async () => {
    await panel.goto(`events/${eventId}`);
    const dashboard = panel.getByTestId("event-dashboard");
    await expect(dashboard.getByRole("heading", { level: 1 })).toHaveText(title);
    await panel.getByRole("switch", { name: "Todos los grupos comienzan juntos" }).click();
    await expect(panel.getByRole("button", { name: "Comenzar todos" })).toBeVisible();
  });

  const guestA = await browser.newContext();
  const guestB = await browser.newContext();
  const ana = new UiPlayer(await guestA.newPage(), "Ana");
  const bruno = new UiPlayer(await guestB.newPage(), "Bruno");

  await test.step("cada anfitrión ve «Esperando al organizador» en vez de «Empezar»", async () => {
    await ana.page.goto(`redeem?code=${encodeURIComponent(codes[0]!)}`);
    await ana.page.getByLabel("Nombre").fill("Ana");
    await ana.page.getByRole("button", { name: "Entrar en la partida" }).click();
    await expect(ana.session).toBeVisible({ timeout: 30_000 });

    await bruno.page.goto(`redeem?code=${encodeURIComponent(codes[1]!)}`);
    await bruno.page.getByLabel("Nombre").fill("Bruno");
    await bruno.page.getByRole("button", { name: "Entrar en la partida" }).click();
    await expect(bruno.session).toBeVisible({ timeout: 30_000 });

    await expect(ana.page.getByTestId("lobby-waiting-organizer")).toBeVisible();
    await expect(bruno.page.getByTestId("lobby-waiting-organizer")).toBeVisible();
    await expect(ana.page.getByTestId("game-start")).toHaveCount(0);
    await expect(bruno.page.getByTestId("game-start")).toHaveCount(0);

    await ana.markReady();
    await bruno.markReady();
  });

  await test.step('"Comenzar todos" arranca los dos grupos a la vez', async () => {
    await panel.getByRole("button", { name: "Comenzar todos" }).click();
    await ana.enterMapAfterStart();
    await bruno.enterMapAfterStart();
  });

  await test.step("el panel refleja las dos sesiones jugando", async () => {
    const dashboard = panel.getByTestId("event-dashboard");
    await expect(dashboard).toContainText("2 activas de 2", { timeout: 30_000 });
  });

  await guestA.close();
  await guestB.close();
  await organizer.close();
});
