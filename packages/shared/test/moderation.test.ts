import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  ANONYMOUS_ACTOR,
  addBusinessDays,
  collectModerationTexts,
  computeStrikeConsequences,
  createInMemoryModerationStore,
  createInMemoryPublishedAssetStorage,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPublishStore,
  createLocalContentPrecheck,
  createModerationService,
  createRoomDraftService,
  createRoomPublishService,
  createUnavailablePublishAssetSource,
  ModerationError,
  RoomPublishError,
  slaDueAt,
  type Actor,
  type RoomPackageSerializer,
} from "../src/services";

const ROOM = "11111111-1111-4111-8111-111111111111";
const ROOM_2 = "22222222-2222-4222-8222-222222222222";
const ROOM_3 = "33333333-3333-4333-8333-333333333333";
const REVIEW = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";

const actor = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });
const autora = actor("autora");
const jugadora = actor("jugadora");
const otra = actor("otra");
const mod = actor("mod");

/** Lunes 5 de enero de 2026, 10:00 UTC. */
const MONDAY = new Date("2026-01-05T10:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function setup(opts: { start?: Date; random?: () => number } = {}) {
  let clock = (opts.start ?? MONDAY).getTime();
  const now = () => new Date(clock);
  const store = createInMemoryModerationStore({
    moderatorIds: [mod.userId],
    rooms: [
      {
        id: ROOM,
        authorId: autora.userId,
        status: "published",
        title: "Rey Aldric",
        latestVersionId: VERSION,
      },
      { id: ROOM_2, authorId: autora.userId, status: "unlisted", title: "Segunda" },
      { id: ROOM_3, authorId: autora.userId, status: "published", title: "Tercera" },
    ],
    reviews: [{ id: REVIEW, roomId: ROOM, userId: jugadora.userId, text: "reseña" }],
    userIds: [otra.userId],
    now,
  });
  const service = createModerationService({ store, now, random: opts.random });
  return {
    store,
    service,
    advance(ms: number) {
      clock += ms;
    },
    now,
  };
}

async function modError(promise: Promise<unknown>): Promise<ModerationError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ModerationError);
  return err as ModerationError;
}

const reportRoom = (category: string, roomId = ROOM, reason = "Motivo del reporte") => ({
  targetType: "room",
  targetId: roomId,
  category,
  reason,
});

describe("reportes y despublicación automática (specs/17 §5.1)", () => {
  it("un reporte crítico despublica la sala al instante y la deja en cola con severidad crítica y SLA de 1 h", async () => {
    const { service, store } = setup();
    const { report, created } = await service.report(jugadora, reportRoom("minor_safety"));

    expect(created).toBe(true);
    expect(store.rooms.get(ROOM)?.status).toBe("removed");
    expect(report).toMatchObject({
      severity: "critical",
      status: "pending",
      source: "user_report",
      targetUserId: autora.userId,
      roomVersionId: VERSION,
      actionTaken: "unpublish",
      autoActioned: true,
      roomStatusBefore: "published",
    });
    expect(report.slaDueAt.getTime() - MONDAY.getTime()).toBe(HOUR);

    const queue = await service.listQueue(mod);
    expect(queue.map((q) => q.report.id)).toEqual([report.id]);
    expect(queue[0]!.overdue).toBe(false);

    // Cuenta del creador congelada mientras se revisa (§5.1 paso 2).
    expect(await service.publishBlocker(autora.userId)).toMatchObject({ code: "ACCOUNT_FROZEN" });
  });

  it("el moderador restaura (falso positivo): la sala vuelve a su estado previo y se descongela la cuenta", async () => {
    const { service, store } = setup();
    const { report } = await service.report(jugadora, {
      ...reportRoom("illegal_content", ROOM_2),
    });
    expect(store.rooms.get(ROOM_2)?.status).toBe("removed");

    const res = await service.resolveReport(mod, report.id, {
      status: "dismissed",
      resolutionNote: "Falso positivo",
    });
    expect(res.report).toMatchObject({
      status: "dismissed",
      actionTaken: "none",
      reviewedBy: mod.userId,
    });
    expect(res.strike).toBeNull();
    expect(store.rooms.get(ROOM_2)?.status).toBe("unlisted");
    expect(await service.publishBlocker(autora.userId)).toBeNull();

    // Ya resuelto: un segundo moderador no puede volver a resolverlo.
    const again = await modError(service.resolveReport(mod, report.id, { status: "actioned" }));
    expect(again.code).toBe("ALREADY_REVIEWED");
  });

  it("el moderador confirma un crítico: la sala sigue retirada y el creador queda baneado sin strikes previos", async () => {
    const { service, store } = setup();
    const { report } = await service.report(jugadora, reportRoom("minor_safety"));
    const res = await service.resolveReport(mod, report.id, { status: "actioned" });

    expect(res.report).toMatchObject({ status: "actioned", actionTaken: "unpublish" });
    expect(res.strike).toMatchObject({ severity: "critical", consequence: "ban" });
    expect(res.standing?.status).toBe("banned");
    expect(store.rooms.get(ROOM)?.status).toBe("removed");
    expect(await service.publishBlocker(autora.userId)).toMatchObject({ code: "CREATOR_BANNED" });
  });

  it("con dos críticos pendientes, descartar uno no restaura la sala: el otro hereda el estado previo", async () => {
    const { service, store } = setup();
    const first = await service.report(jugadora, reportRoom("minor_safety"));
    const second = await service.report(otra, reportRoom("illegal_content"));
    expect(second.report.actionTaken).toBeNull();

    await service.resolveReport(mod, first.report.id, { status: "dismissed" });
    expect(store.rooms.get(ROOM)?.status).toBe("removed");
    expect(store.reports.get(second.report.id)).toMatchObject({
      actionTaken: "unpublish",
      roomStatusBefore: "published",
    });

    await service.resolveReport(mod, second.report.id, { status: "dismissed" });
    expect(store.rooms.get(ROOM)?.status).toBe("published");
  });

  it("un reporte no crítico no toca la sala; repetirlo mientras sigue pendiente devuelve el mismo", async () => {
    const { service, store } = setup();
    const a = await service.report(jugadora, reportRoom("spam"));
    const b = await service.report(jugadora, reportRoom("spam"));
    expect(a.report.severity).toBe("normal");
    expect(store.rooms.get(ROOM)?.status).toBe("published");
    expect(b).toMatchObject({ created: false, report: { id: a.report.id } });
  });

  it("un reporte crítico sobre una reseña la oculta; descartarlo la vuelve a mostrar", async () => {
    const { service, store } = setup();
    const { report } = await service.report(otra, {
      targetType: "review",
      targetId: REVIEW,
      category: "minor_safety",
      reason: "Datos de un menor",
    });
    expect(report).toMatchObject({ targetUserId: jugadora.userId, actionTaken: "hide" });
    expect(store.reviews.get(REVIEW)?.hiddenAt).not.toBeNull();

    await service.resolveReport(mod, report.id, { status: "dismissed" });
    expect(store.reviews.get(REVIEW)?.hiddenAt).toBeNull();
  });

  it("confirmar un reporte de reseña la oculta (sin strike: los strikes son de creadores)", async () => {
    const { service, store } = setup();
    const { report } = await service.report(otra, {
      targetType: "review",
      targetId: REVIEW,
      category: "offensive_language",
      reason: "Insultos",
    });
    const res = await service.resolveReport(mod, report.id, { status: "actioned" });
    expect(res.report.actionTaken).toBe("hide");
    expect(res.strike).toBeNull();
    expect(store.reviews.get(REVIEW)?.hiddenAt).not.toBeNull();
  });

  it("reportar a un usuario: avisar es la acción por defecto", async () => {
    const { service } = setup();
    const { report } = await service.report(jugadora, {
      targetType: "user",
      targetId: otra.userId,
      category: "harassment",
      reason: "Acoso en su perfil",
    });
    expect(report).toMatchObject({ severity: "high", targetUserId: otra.userId });
    const res = await service.resolveReport(mod, report.id, { status: "actioned" });
    expect(res.report.actionTaken).toBe("warn");
    const bad = await modError(
      service.report(jugadora, { ...reportRoom("spam"), targetType: "user", targetId: "nadie" }),
    );
    expect(bad.code).toBe("NOT_FOUND");
  });

  it("sin motivo → REPORT_REASON_REQUIRED; sin sesión → UNAUTHORIZED; sala en borrador → NOT_FOUND", async () => {
    const { service, store } = setup();
    expect((await modError(service.report(jugadora, reportRoom("spam", ROOM, "  ")))).code).toBe(
      "REPORT_REASON_REQUIRED",
    );
    expect((await modError(service.report(ANONYMOUS_ACTOR, reportRoom("spam")))).code).toBe(
      "UNAUTHORIZED",
    );
    store.rooms.get(ROOM_3)!.status = "draft";
    expect((await modError(service.report(jugadora, reportRoom("spam", ROOM_3)))).code).toBe(
      "NOT_FOUND",
    );
    expect(
      (await modError(service.report(jugadora, { ...reportRoom("spam"), category: "sampling" })))
        .code,
    ).toBe("VALIDATION_ERROR");
  });
});

describe("cola: SLA y prioridad (specs/17 §4)", () => {
  it("SLA por severidad en días laborables", () => {
    const friday = new Date("2026-01-09T12:00:00Z");
    expect(slaDueAt("critical", friday).toISOString()).toBe("2026-01-09T13:00:00.000Z");
    expect(slaDueAt("high", friday).toISOString()).toBe("2026-01-12T12:00:00.000Z");
    expect(slaDueAt("normal", friday).toISOString()).toBe("2026-01-16T12:00:00.000Z");
    expect(slaDueAt("low", friday).toISOString()).toBe("2026-01-23T12:00:00.000Z");
    expect(addBusinessDays(new Date("2026-01-10T09:00:00Z"), 1).toISOString()).toBe(
      "2026-01-12T09:00:00.000Z",
    );
  });

  it("ordena por severidad → evento activo → volumen de reportes → antigüedad, y marca los vencidos", async () => {
    const { service, store, advance } = setup();
    const low = await service.report(jugadora, reportRoom("taste", ROOM_3));
    advance(1000);
    const normalOld = await service.report(jugadora, reportRoom("spam", ROOM_2));
    advance(1000);
    const normalBusy = await service.report(jugadora, reportRoom("quality", ROOM));
    await service.report(otra, reportRoom("quality", ROOM));
    advance(1000);
    const high = await service.report(jugadora, {
      targetType: "user",
      targetId: otra.userId,
      category: "harassment",
      reason: "Acoso",
    });

    let queue = await service.listQueue(mod);
    expect(queue[0]!.report.id).toBe(high.report.id);
    // Entre normales: más reportes sobre la misma sala primero.
    expect(queue.map((q) => q.report.id).indexOf(normalBusy.report.id)).toBeLessThan(
      queue.map((q) => q.report.id).indexOf(normalOld.report.id),
    );
    expect(queue.at(-1)!.report.id).toBe(low.report.id);

    // Un evento activo en la otra sala la adelanta dentro de su severidad.
    store.activeEventRoomIds.add(ROOM_2);
    queue = await service.listQueue(mod, { severity: "normal" });
    expect(queue[0]).toMatchObject({ report: { id: normalOld.report.id }, activeEvent: true });

    advance(2 * DAY);
    queue = await service.listQueue(mod);
    expect(queue.find((q) => q.report.id === high.report.id)!.overdue).toBe(true);
    expect(queue.find((q) => q.report.id === low.report.id)!.overdue).toBe(false);
  });
});

describe("strikes con consecuencias escalonadas (specs/17 §6)", () => {
  async function confirm(
    s: ReturnType<typeof setup>,
    category: string,
    roomId: string,
    reporter = jugadora,
  ) {
    const { report } = await s.service.report(reporter, reportRoom(category, roomId));
    return s.service.resolveReport(mod, report.id, { status: "actioned" });
  }

  it("1º aviso, 2º suspensión de 14 días, 3º ban (en 90 días)", async () => {
    const s = setup();
    const first = await confirm(s, "spam", ROOM);
    expect(first.strike).toMatchObject({ severity: "normal", consequence: "warning" });
    expect(first.report.actionTaken).toBe("warn");
    expect(first.standing?.status).toBe("warned");
    expect(await s.service.publishBlocker(autora.userId)).toBeNull();

    s.advance(10 * DAY);
    const second = await confirm(s, "harassment", ROOM_2);
    expect(second.strike?.consequence).toBe("suspension");
    expect(second.report.actionTaken).toBe("unpublish");
    expect(s.store.rooms.get(ROOM_2)?.status).toBe("removed");
    const blocker = await s.service.publishBlocker(autora.userId);
    expect(blocker).toMatchObject({ code: "CREATOR_SUSPENDED" });
    expect(blocker!.until!.getTime()).toBe(s.now().getTime() + 14 * DAY);

    // La suspensión dura 14 días.
    s.advance(15 * DAY);
    expect(await s.service.publishBlocker(autora.userId)).toBeNull();

    const third = await confirm(s, "copyright", ROOM_3);
    expect(third.strike?.consequence).toBe("ban");
    expect(third.standing?.status).toBe("banned");
    // El ban no caduca con los strikes.
    s.advance(365 * DAY);
    expect(await s.service.publishBlocker(autora.userId)).toMatchObject({ code: "CREATOR_BANNED" });
  });

  it("los strikes caducan a los 90 días sin reincidencia", async () => {
    const s = setup();
    await confirm(s, "spam", ROOM);
    s.advance(91 * DAY);
    expect((await s.service.standing(autora)).status).toBe("good");
    const again = await confirm(s, "spam", ROOM_2);
    expect(again.strike?.consequence).toBe("warning");
  });

  it("un reporte bajo confirmado no genera strike", async () => {
    const s = setup();
    const res = await confirm(s, "taste", ROOM);
    expect(res.strike).toBeNull();
  });

  it("reincidencia: con un strike alto vigente, un nuevo reporte alto retira la sala mientras se revisa", async () => {
    const s = setup();
    await confirm(s, "harassment", ROOM);
    const { report } = await s.service.report(otra, reportRoom("sexual_content", ROOM_3));
    expect(report).toMatchObject({
      severity: "high",
      actionTaken: "unpublish",
      autoActioned: true,
    });
    expect(s.store.rooms.get(ROOM_3)?.status).toBe("removed");
  });

  it("computeStrikeConsequences ignora los revocados y los de fuera de la ventana", () => {
    const at = (d: number) => new Date(MONDAY.getTime() + d * DAY);
    const strikes = [
      { id: "a", severity: "normal" as const, createdAt: at(0), revokedAt: null },
      { id: "b", severity: "high" as const, createdAt: at(10), revokedAt: at(20) },
      { id: "c", severity: "normal" as const, createdAt: at(30), revokedAt: null },
      { id: "d", severity: "normal" as const, createdAt: at(200), revokedAt: null },
    ];
    expect(Object.fromEntries(computeStrikeConsequences(strikes))).toEqual({
      a: "warning",
      c: "suspension",
      d: "warning",
    });
  });
});

describe("apelaciones (specs/17 §7)", () => {
  it("se crea, un moderador la estima y se revierte la acción: sala reincorporada y strike levantado", async () => {
    const s = setup();
    await s.service.resolveReport(
      mod,
      (await s.service.report(jugadora, reportRoom("spam", ROOM_3))).report.id,
      { status: "actioned" },
    );
    s.advance(DAY);
    const { report } = await s.service.report(jugadora, reportRoom("harassment", ROOM_2));
    const resolved = await s.service.resolveReport(mod, report.id, { status: "actioned" });
    expect(resolved.standing?.status).toBe("suspended");
    expect(s.store.rooms.get(ROOM_2)?.status).toBe("removed");

    const appeal = await s.service.appealRoom(autora, ROOM_2, {
      reason: "Es un personaje de ficción, no acoso a nadie real",
    });
    expect(appeal).toMatchObject({
      status: "pending",
      roomId: ROOM_2,
      contentReportId: report.id,
      strikeId: resolved.strike!.id,
    });
    expect(appeal.slaDueAt.getTime()).toBe(slaDueAt("normal", s.now()).getTime());
    expect((await s.service.listAppeals(mod)).map((a) => a.id)).toEqual([appeal.id]);

    // Una segunda apelación sobre lo mismo se rechaza.
    const dup = await modError(
      s.service.appealRoom(autora, ROOM_2, { reason: "Otra vez la misma apelación" }),
    );
    expect(dup.code).toBe("APPEAL_ALREADY_PENDING");

    const res = await s.service.resolveAppeal(mod, appeal.id, {
      decision: "overturned",
      resolutionNote: "Contexto de ficción",
    });
    expect(res.appeal).toMatchObject({ status: "overturned", reviewedBy: mod.userId });
    expect(s.store.rooms.get(ROOM_2)?.status).toBe("unlisted");
    expect(s.store.reports.get(report.id)?.status).toBe("dismissed");
    expect(s.store.strikes.get(resolved.strike!.id)?.revokedAt).not.toBeNull();
    // Queda un solo strike vigente: vuelve a aviso y se levanta la suspensión.
    expect(res.standing.status).toBe("warned");
    expect(await s.service.publishBlocker(autora.userId)).toBeNull();

    const twice = await modError(s.service.resolveAppeal(mod, appeal.id, { decision: "upheld" }));
    expect(twice.code).toBe("ALREADY_REVIEWED");
  });

  it("desestimada (`upheld`): todo se mantiene", async () => {
    const s = setup();
    const { report } = await s.service.report(jugadora, reportRoom("harassment", ROOM));
    await s.service.resolveReport(mod, report.id, { status: "actioned" });
    const appeal = await s.service.appealRoom(autora, ROOM, {
      reason: "No estoy de acuerdo con esto",
    });
    const res = await s.service.resolveAppeal(mod, appeal.id, { decision: "upheld" });
    expect(res.appeal.status).toBe("upheld");
    expect(s.store.rooms.get(ROOM)?.status).toBe("removed");
    expect(res.standing.status).toBe("warned");
  });

  it("lo crítico no se apela; sin acción no hay nada que apelar; solo el autor apela su sala", async () => {
    const s = setup();
    expect(
      (await modError(s.service.appealRoom(autora, ROOM, { reason: "Nada que apelar aquí" }))).code,
    ).toBe("NOTHING_TO_APPEAL");
    const { report } = await s.service.report(jugadora, reportRoom("minor_safety"));
    await s.service.resolveReport(mod, report.id, { status: "actioned" });
    expect(
      (await modError(s.service.appealRoom(autora, ROOM, { reason: "Por favor revisadlo" }))).code,
    ).toBe("APPEAL_NOT_ALLOWED");
    expect(
      (await modError(s.service.appealAccount(autora, { reason: "Por favor revisadlo" }))).code,
    ).toBe("APPEAL_NOT_ALLOWED");
    expect(
      (await modError(s.service.appealRoom(otra, ROOM, { reason: "No soy la autora" }))).code,
    ).toBe("FORBIDDEN");
  });

  it("apelación de cuenta: estimarla revoca el strike que causó la suspensión", async () => {
    const s = setup();
    for (const [category, roomId] of [
      ["spam", ROOM],
      ["quality", ROOM_3],
    ] as const) {
      const { report } = await s.service.report(jugadora, reportRoom(category, roomId));
      await s.service.resolveReport(mod, report.id, { status: "actioned" });
    }
    expect((await s.service.standing(autora)).status).toBe("suspended");
    const appeal = await s.service.appealAccount(autora, {
      reason: "La segunda sala ya está corregida",
    });
    expect(appeal.roomId).toBeNull();
    const res = await s.service.resolveAppeal(mod, appeal.id, { decision: "overturned" });
    expect(res.standing.status).toBe("warned");
    expect(
      (await modError(s.service.appealAccount(autora, { reason: "Ya no estoy suspendida" }))).code,
    ).toBe("NOTHING_TO_APPEAL");
  });

  it("nadie resuelve su propia apelación", async () => {
    const s = setup();
    const store = createInMemoryModerationStore({
      moderatorIds: [autora.userId],
      rooms: [{ id: ROOM, authorId: autora.userId, status: "published", title: "x" }],
    });
    const service = createModerationService({ store, now: s.now });
    const { report } = await service.report(jugadora, reportRoom("harassment"));
    await service.resolveReport(autora, report.id, { status: "actioned" });
    const appeal = await service.appealRoom(autora, ROOM, { reason: "Me apelo a mí misma" });
    expect(
      (await modError(service.resolveAppeal(autora, appeal.id, { decision: "overturned" }))).code,
    ).toBe("FORBIDDEN");
  });
});

describe("muestreo aleatorio (specs/17 §1, §9)", () => {
  it("encola las versiones recientes sin muestrear como reportes `sampling` de severidad baja", async () => {
    const s = setup();
    const v = (versionId: string, daysAgo: number) => ({
      roomId: ROOM,
      versionId,
      authorId: autora.userId,
      publishedAt: new Date(MONDAY.getTime() - daysAgo * DAY),
    });
    s.store.versions.push(v("v-reciente", 1), v("v-otra", 2), v("v-vieja", 30));

    const first = await s.service.sampleRecentlyPublished({ rate: 1 });
    expect(first).toEqual({ considered: 2, enqueued: 2 });
    const queue = await s.service.listQueue(mod);
    expect(queue.map((q) => q.report)).toEqual([
      expect.objectContaining({ source: "sampling", severity: "low", roomVersionId: "v-reciente" }),
      expect.objectContaining({ source: "sampling", severity: "low", roomVersionId: "v-otra" }),
    ]);
    // Idempotente: lo ya muestreado no se vuelve a encolar.
    expect(await s.service.sampleRecentlyPublished({ rate: 1 })).toEqual({
      considered: 0,
      enqueued: 0,
    });
  });

  it("con `rate` < 1 encola solo la fracción que sale en el sorteo", async () => {
    const draws = [0.1, 0.9, 0.3, 0.7];
    const s = setup({ random: () => draws.shift() ?? 1 });
    for (let i = 0; i < 4; i++) {
      s.store.versions.push({
        roomId: ROOM,
        versionId: `v${i}`,
        authorId: autora.userId,
        publishedAt: MONDAY,
      });
    }
    expect(await s.service.sampleRecentlyPublished({ rate: 0.5 })).toEqual({
      considered: 4,
      enqueued: 2,
    });
  });
});

describe("permisos: solo moderadores o administradores", () => {
  it("un usuario sin `isModerator` recibe FORBIDDEN y un anónimo UNAUTHORIZED", async () => {
    const { service } = setup();
    const { report } = await service.report(jugadora, reportRoom("spam"));
    for (const call of [
      () => service.listQueue(jugadora),
      () => service.resolveReport(autora, report.id, { status: "dismissed" }),
      () => service.listAppeals(jugadora),
      () => service.resolveAppeal(jugadora, report.id, { decision: "upheld" }),
      () => service.standing(jugadora, autora.userId),
    ]) {
      expect((await modError(call())).code).toBe("FORBIDDEN");
    }
    expect((await modError(service.listQueue(ANONYMOUS_ACTOR))).code).toBe("UNAUTHORIZED");
    expect(await service.canModerate(mod)).toBe(true);
    expect(await service.canModerate(jugadora)).toBe(false);
  });
});

// ── Pre-check y publicación ────────────────────────────────────────────────

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

describe("pre-check automático local (specs/17 §3)", () => {
  const precheck = createLocalContentPrecheck();

  it("el fixture del Rey Aldric pasa limpio y en mucho menos de 2 s", async () => {
    const texts = collectModerationTexts(reyAldric);
    expect(texts.length).toBeGreaterThan(5);
    expect(texts.map((t) => t.path)).toEqual(
      expect.arrayContaining(["meta.title", "meta.description", "dialogs[0].text.es.text"]),
    );
    const started = performance.now();
    const verdict = await precheck.check(texts);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(verdict).toMatchObject({ action: "allow", flags: [] });
  });

  it("🛑 términos graves bloquean; 🟡 lenguaje leve y datos personales solo marcan", async () => {
    expect(await precheck.check([{ path: "a", text: "Esto es p0rn0 puro" }])).toMatchObject({
      action: "block",
      flags: ["severe_language"],
    });
    expect(await precheck.check([{ path: "a", text: "¡Qué idiota el guardia!" }])).toMatchObject({
      action: "flag",
      flags: ["language"],
    });
    expect(
      await precheck.check([
        { path: "a", text: "Escríbeme a nino@example.com o al 612 345 678" },
        { path: "b", text: "El código del candado es 1492" },
      ]),
    ).toMatchObject({ action: "flag", flags: ["pii_email", "pii_phone"] });
  });
});

const ROOM_ID = "66666666-6666-4666-8666-666666666666";

const jsonSerializer: RoomPackageSerializer = (doc) => {
  const json = doc.getMap<string>("test-package").get("json");
  return json === undefined ? {} : (JSON.parse(json) as unknown);
};

function publishSetup() {
  const moderationStore = createInMemoryModerationStore({
    moderatorIds: [mod.userId],
    rooms: [{ id: ROOM_ID, authorId: autora.userId, status: "draft", title: "Rey" }],
  });
  const moderation = createModerationService({ store: moderationStore });
  const draftStore = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: autora.userId }]);
  const drafts = createRoomDraftService({ store: draftStore });
  const publishStore = createInMemoryRoomPublishStore([
    { id: ROOM_ID, authorId: autora.userId, status: "draft" },
  ]);
  const publish = createRoomPublishService({
    store: publishStore,
    drafts: draftStore,
    serializer: jsonSerializer,
    assets: createUnavailablePublishAssetSource(),
    storage: createInMemoryPublishedAssetStorage(),
    moderation,
  });
  const doc = new Y.Doc();
  const pending: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => pending.push(u));
  async function writeDraft(pkg: RoomPackage) {
    doc.getMap<string>("test-package").set("json", JSON.stringify(pkg));
    for (const update of pending.splice(0)) await drafts.appendUpdate(autora, ROOM_ID, update);
  }
  return { moderation, moderationStore, publish, publishStore, writeDraft };
}

async function publishError(promise: Promise<unknown>): Promise<RoomPublishError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RoomPublishError);
  return err as RoomPublishError;
}

describe("pre-check en la publicación (3.9 + 6.1)", () => {
  const withIntro = (text: string): RoomPackage => {
    const pkg = structuredClone(reyAldric);
    pkg.dialogs[0]!.text.es!.text = text;
    return pkg;
  };

  it("una sala limpia se publica sin señales ni reportes", async () => {
    const { publish, writeDraft, moderationStore } = publishSetup();
    await writeDraft(structuredClone(reyAldric));
    const res = await publish.publish(autora, ROOM_ID);
    expect(res.moderationFlags).toEqual([]);
    expect(moderationStore.reports.size).toBe(0);
  });

  it("🟡 publica y encola la versión con severidad normal", async () => {
    const { publish, writeDraft, moderation } = publishSetup();
    await writeDraft(withIntro("Pobre idiota, no saldrás de aquí"));
    const res = await publish.publish(autora, ROOM_ID);
    expect(res.moderationFlags).toEqual(["language"]);
    const queue = await moderation.listQueue(mod);
    expect(queue.map((q) => q.report)).toEqual([
      expect.objectContaining({
        source: "precheck",
        severity: "normal",
        roomVersionId: res.version.id,
        flags: ["language"],
      }),
    ]);
  });

  it("🛑 bloquea con un reporte apelable; estimada la apelación, ese mismo contenido publica (y queda en cola)", async () => {
    const { publish, writeDraft, moderation, moderationStore } = publishSetup();
    await writeDraft(withIntro("Un maricon custodia la puerta"));

    // En seco (`checkPublishable`) también bloquea, sin dejar rastro.
    expect((await publishError(publish.checkPublishable(autora, ROOM_ID))).code).toBe(
      "CONTENT_BLOCKED",
    );
    expect(moderationStore.reports.size).toBe(0);

    const err = await publishError(publish.publish(autora, ROOM_ID));
    expect(err.code).toBe("CONTENT_BLOCKED");
    const reportId = err.details.moderation?.reportId;
    expect(reportId).toBeTruthy();
    expect(err.details.moderation?.findings?.[0]).toMatchObject({
      path: "dialogs[0].text.es.text",
      kind: "severe_language",
    });
    expect(moderationStore.reports.get(reportId!)).toMatchObject({
      source: "precheck",
      status: "actioned",
      actionTaken: "block",
    });

    const appeal = await moderation.appealRoom(autora, ROOM_ID, {
      reason: "Es una cita histórica dentro de la ficción",
    });
    expect(appeal.contentReportId).toBe(reportId);
    await moderation.resolveAppeal(mod, appeal.id, { decision: "overturned" });

    const res = await publish.publish(autora, ROOM_ID);
    expect(res.version.semver).toBe("1.0.0");
    const queue = await moderation.listQueue(mod);
    expect(queue[0]!.report).toMatchObject({ source: "precheck", roomVersionId: res.version.id });

    // Otro contenido distinto con términos graves vuelve a bloquearse.
    await writeDraft(withIntro("Otro maricon distinto"));
    expect((await publishError(publish.publish(autora, ROOM_ID))).code).toBe("CONTENT_BLOCKED");
  });

  it("un creador suspendido o congelado no publica", async () => {
    const { publish, writeDraft, moderation, moderationStore } = publishSetup();
    await writeDraft(structuredClone(reyAldric));
    moderationStore.rooms.get(ROOM_ID)!.status = "published";
    await moderation.report(jugadora, reportRoom("illegal_content", ROOM_ID));
    const err = await publishError(publish.publish(autora, ROOM_ID));
    expect(err.code).toBe("ACCOUNT_FROZEN");
  });
});
