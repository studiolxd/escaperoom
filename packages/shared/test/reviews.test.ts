import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  createInMemoryReviewStore,
  createReviewService,
  parseReviewInput,
  ReviewError,
  type Actor,
} from "../src/services";

const actor = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });

function setup() {
  let tick = 0;
  const store = createInMemoryReviewStore({
    rooms: [{ roomId: "sala", authorId: "autora" }],
    eligible: ["ana:sala", "bruno:sala", "autora:sala"],
    users: { ana: "Ana", bruno: "Bruno" },
    // Reloj que avanza: el orden por edición es determinista.
    now: () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)),
  });
  return { store, reviews: createReviewService({ store }) };
}

describe("reviewService.upsertReview", () => {
  it("crea, edita y no duplica (una reseña por usuario y sala)", async () => {
    const { reviews } = setup();
    const first = await reviews.upsertReview(actor("ana"), "sala", {
      rating: 4,
      text: "Muy buena",
    });
    expect(first).toMatchObject({
      created: true,
      review: { roomId: "sala", rating: 4, text: "Muy buena", authorDisplayName: "Ana" },
      ratingAvg: 4,
      ratingCount: 1,
    });

    const edited = await reviews.upsertReview(actor("ana"), "sala", { rating: 2 });
    expect(edited.created).toBe(false);
    expect(edited.review.id).toBe(first.review.id);
    expect(edited.review).toMatchObject({ rating: 2, text: null });
    expect(edited.review.createdAt).toBe(first.review.createdAt);
    expect(edited.review.updatedAt > first.review.updatedAt).toBe(true);
    expect(edited).toMatchObject({ ratingAvg: 2, ratingCount: 1 });

    const list = await reviews.listReviews(ANONYMOUS_ACTOR, "sala");
    expect(list.items).toHaveLength(1);
  });

  it("media y recuento con varios usuarios", async () => {
    const { reviews } = setup();
    await reviews.upsertReview(actor("ana"), "sala", { rating: 5 });
    const res = await reviews.upsertReview(actor("bruno"), "sala", { rating: 2 });
    expect(res).toMatchObject({ ratingAvg: 3.5, ratingCount: 2 });
    const list = await reviews.listReviews(ANONYMOUS_ACTOR, "sala");
    expect(list).toMatchObject({ ratingAvg: 3.5, ratingCount: 2, nextCursor: null });
    // Más recientes (por edición) primero.
    expect(list.items.map((r) => r.authorDisplayName)).toEqual(["Bruno", "Ana"]);
  });

  it("solo quien ha jugado o comprado; nunca el autor; nunca anónimos", async () => {
    const { reviews, store } = setup();
    await expect(
      reviews.upsertReview(ANONYMOUS_ACTOR, "sala", { rating: 5 }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(reviews.upsertReview(actor("carla"), "sala", { rating: 5 })).rejects.toMatchObject(
      { code: "REVIEW_NOT_ALLOWED" },
    );
    await expect(
      reviews.upsertReview(actor("autora"), "sala", { rating: 5 }),
    ).rejects.toMatchObject({
      code: "REVIEW_NOT_ALLOWED",
      message: "No puedes reseñar tu propia sala",
    });
    expect(await reviews.getViewerState(actor("carla"), "sala")).toEqual({
      canReview: false,
      reason: "not_played",
      review: null,
    });

    store.markEligible("carla", "sala");
    await reviews.upsertReview(actor("carla"), "sala", { rating: 3 });
    expect(await reviews.getViewerState(actor("carla"), "sala")).toMatchObject({
      canReview: true,
      reason: "ok",
      review: { rating: 3 },
    });
    expect(await reviews.getViewerState(ANONYMOUS_ACTOR, "sala")).toMatchObject({
      reason: "anonymous",
    });
  });

  it("sala fuera de catálogo: ROOM_NOT_FOUND al listar y al reseñar", async () => {
    const { reviews } = setup();
    await expect(reviews.listReviews(ANONYMOUS_ACTOR, "otra")).rejects.toMatchObject({
      code: "ROOM_NOT_FOUND",
    });
    await expect(reviews.upsertReview(actor("ana"), "otra", { rating: 5 })).rejects.toMatchObject({
      code: "ROOM_NOT_FOUND",
    });
  });

  it("pagina las reseñas con cursor", async () => {
    const { reviews, store } = setup();
    for (const user of ["u1", "u2", "u3"]) {
      store.markEligible(user, "sala");
      await reviews.upsertReview(actor(user), "sala", { rating: 4 });
    }
    const first = await reviews.listReviews(ANONYMOUS_ACTOR, "sala", { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await reviews.listReviews(ANONYMOUS_ACTOR, "sala", {
      limit: "2",
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    await expect(
      reviews.listReviews(ANONYMOUS_ACTOR, "sala", { cursor: "basura" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("parseReviewInput — validación y filtro de lenguaje (specs/17 §3)", () => {
  it("valoración en medios puntos, entre 1 y 5", () => {
    for (const rating of [0, 0.5, 6, 1.2, 4.3, "5", null, undefined]) {
      expect(() => parseReviewInput({ rating }), String(rating)).toThrow(ReviewError);
    }
    expect(parseReviewInput({ rating: 1 })).toEqual({ rating: 1, text: null });
    expect(parseReviewInput({ rating: 4.5 })).toEqual({ rating: 4.5, text: null });
    expect(parseReviewInput({ rating: 2.5 })).toEqual({ rating: 2.5, text: null });
    expect(parseReviewInput({ rating: 5 })).toEqual({ rating: 5, text: null });
  });

  it("desinfecta el texto y deja null si queda vacío", () => {
    expect(parseReviewInput({ rating: 5, text: "  <b>Genial</b>\n\n sala " })).toEqual({
      rating: 5,
      text: "Genial sala",
    });
    expect(parseReviewInput({ rating: 5, text: "   " }).text).toBeNull();
    expect(() => parseReviewInput({ rating: 5, text: 42 })).toThrow(ReviewError);
    expect(() => parseReviewInput({ rating: 5, text: "a".repeat(2001) })).toThrow(
      /como mucho 2000/,
    );
  });

  it("rechaza lenguaje de la lista del filtro (bloquea enviar)", () => {
    expect(() => parseReviewInput({ rating: 1, text: "El autor es un idiota" })).toThrow(
      expect.objectContaining({ code: "CONTENT_REJECTED" }),
    );
    expect(() => parseReviewInput({ rating: 1, text: "Qué 1d10ta" })).toThrow(ReviewError);
  });
});
