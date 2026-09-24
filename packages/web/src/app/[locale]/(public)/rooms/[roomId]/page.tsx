import {
  ANONYMOUS_ACTOR,
  CatalogError,
  ReviewError,
  type CatalogRoom,
  type ReviewListResult,
  type ReviewService,
} from "@escaperoom/shared/services";
import { storage } from "@escaperoom/kit/storage";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { RoomDetailView } from "@/components/catalog/room-detail";
import {
  buildRoomJsonLd,
  buildRoomMetadata,
  localizedUrl,
  roomPath,
  serializeJsonLd,
} from "@/lib/catalog-seo";
import { resolveActorFromHeaders } from "@/server/context";
import { getCatalogService, getReviewService } from "@/server/services";

type Props = {
  params: Promise<{ locale: string; roomId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Detalle de catálogo, deduplicado entre `generateMetadata` y la página. */
const loadRoom = cache(async (roomId: string): Promise<CatalogRoom | null> => {
  try {
    return await getCatalogService().getRoom(ANONYMOUS_ACTOR, roomId);
  } catch (error) {
    if (error instanceof CatalogError && error.code === "ROOM_NOT_FOUND") return null;
    throw error;
  }
});

/** Un cursor de reseñas inválido no rompe la página: se listan sin filtrar. */
async function listReviews(
  reviewService: ReviewService,
  roomId: string,
  cursor: string | null,
): Promise<ReviewListResult> {
  try {
    return await reviewService.listReviews(ANONYMOUS_ACTOR, roomId, { cursor, limit: 10 });
  } catch (error) {
    if (!(error instanceof ReviewError && error.code === "VALIDATION_ERROR")) throw error;
    return reviewService.listReviews(ANONYMOUS_ACTOR, roomId, { limit: 10 });
  }
}

/**
 * Metadata indexable de la sala: título con sufijo por locale, descripción de
 * la sala, canónica y `hreflang` a los 6 locales de la UI.
 */
export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale, roomId } = await params;
  const room = await loadRoom(roomId);
  if (!room) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: "RoomDetail" });
  return buildRoomMetadata(room, locale, (title) => t("metaTitle", { title }));
}

/**
 * Detalle público de una sala (SSR, ticket 5.3): ficha, reseñas paginadas,
 * formulario de reseña según el visitante y datos estructurados JSON-LD
 * (`Product` + `Game` con `aggregateRating`).
 */
export default async function RoomDetailPage({ params, searchParams }: Props) {
  const { locale, roomId } = await params;
  setRequestLocale(locale);
  const room = await loadRoom(roomId);
  if (!room) notFound();

  const rawCursor = (await searchParams).reviews;
  const reviewsCursor = typeof rawCursor === "string" ? rawCursor : null;
  const reviewService = getReviewService();
  const headersList = await headers();

  // Las tres ramas son independientes entre sí: en serie sumaban su latencia
  // (F-29). `getViewerState` sigue encadenado tras `resolveActorFromHeaders`
  // porque necesita el actor ya resuelto.
  //
  // Las reseñas se resuelven aquí (no se difieren detrás del `Suspense` de
  // verdad) porque el JSON-LD incluye hasta 5 reseñas como `review` (rich
  // result de Google); diferirlas dejaría el script sin esas reseñas o
  // obligaría a duplicar la consulta. El `Suspense` de `RoomDetailView`
  // sigue aislando el renderizado de la lista igualmente.
  const [reviews, { actor, viewer }, coverImageUrl] = await Promise.all([
    listReviews(reviewService, roomId, reviewsCursor),
    resolveActorFromHeaders(headersList).then(async (resolvedActor) => ({
      actor: resolvedActor,
      viewer: await reviewService.getViewerState(resolvedActor, roomId),
    })),
    room.coverImageKey ? storage.getSignedReadUrl(room.coverImageKey) : Promise.resolve(null),
  ]);

  const jsonLd = buildRoomJsonLd(room, localizedUrl(locale, roomPath(room.id)), reviews.items);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <RoomDetailView
        room={room}
        locale={locale}
        reviewsPromise={Promise.resolve(reviews)}
        viewer={viewer}
        coverImageUrl={coverImageUrl}
        isAuthor={actor.userId === room.authorId}
      />
    </>
  );
}
