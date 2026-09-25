import type {
  CatalogRoom,
  Review,
  ReviewListResult,
  ReviewViewerState,
} from "@escaperoom/shared/services";
import { Suspense } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CATALOG_PATH, roomPath } from "@/lib/catalog-seo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { languageName } from "./language-name";
import { RatingSummary } from "./rating-summary";
import { ReviewForm } from "./review-form";
import { RoomCoverUpload } from "./room-cover-upload";
import { RoomPrice } from "./room-card";
import { StarRating } from "./star-rating";

function ReviewItem({ review }: { review: Review }) {
  const t = useTranslations("RoomDetail");
  const format = useFormatter();
  return (
    <li className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0">
      <div className="flex items-center gap-2 text-sm">
        <span aria-label={t("stars", { rating: review.rating })}>
          <StarRating value={review.rating} />
        </span>
        <span className="font-medium">{review.authorDisplayName}</span>
        <time dateTime={review.updatedAt} className="text-xs text-muted-foreground">
          {format.dateTime(new Date(review.updatedAt), { dateStyle: "medium" })}
        </time>
      </div>
      {review.text ? <p className="text-sm">{review.text}</p> : null}
    </li>
  );
}

function ReviewsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

/**
 * La lista y la paginación son lo único que depende de `reviewsPromise`
 * (F-20): el resto de la ficha (portada, datos, formulario de reseña) no
 * espera a que resuelva.
 */
async function ReviewsList({
  roomId,
  locale,
  reviewsPromise,
}: {
  roomId: string;
  locale: string;
  reviewsPromise: Promise<ReviewListResult>;
}) {
  const [t, { items: reviews, nextCursor: reviewsNextCursor }] = await Promise.all([
    getTranslations({ locale, namespace: "RoomDetail" }),
    reviewsPromise,
  ]);

  return (
    <>
      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noReviews")}</p>
      ) : (
        <ul>
          {reviews.map((review) => (
            <ReviewItem key={review.id} review={review} />
          ))}
        </ul>
      )}
      {reviewsNextCursor ? (
        <Link
          href={{ pathname: roomPath(roomId), query: { reviews: reviewsNextCursor } }}
          className="text-sm underline-offset-4 hover:underline"
        >
          {t("moreReviews")} →
        </Link>
      ) : null}
    </>
  );
}

/** Detalle SSR de una sala del catálogo: ficha, reseñas y formulario de reseña. */
export function RoomDetailView({
  room,
  locale,
  reviewsPromise,
  viewer,
  coverImageUrl,
  isAuthor,
}: {
  room: CatalogRoom;
  locale: string;
  reviewsPromise: Promise<ReviewListResult>;
  viewer: ReviewViewerState;
  coverImageUrl: string | null;
  isAuthor: boolean;
}) {
  const t = useTranslations("RoomDetail");
  const tc = useTranslations("Catalog");

  const facts: Array<[string, React.ReactNode]> = [
    [t("difficulty"), tc(`difficulty${room.difficulty}`)],
    [t("duration"), tc("minutes", { minutes: room.estimatedMinutes })],
    [t("players"), tc("playersRange", { min: room.players.min, max: room.players.max })],
    [t("languages"), room.languages.map((code) => languageName(code, locale)).join(", ")],
    [t("price"), <RoomPrice key="price" room={room} />],
    [t("author"), room.authorDisplayName],
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 bg-background px-4 py-8 text-foreground">
      <Link href={CATALOG_PATH} className="text-sm underline-offset-4 hover:underline">
        ← {t("back")}
      </Link>

      <div
        className="relative isolate flex aspect-[21/9] w-full flex-col justify-end overflow-hidden rounded-xl bg-muted"
        data-slot="room-cover"
      >
        {coverImageUrl ? (
          // F-37: portada = candidata a LCP de la página. `fetchPriority`
          // adelanta su descubrimiento; `width`/`height` (en la proporción
          // del contenedor, 21:9) reservan el hueco y evitan el salto de
          // layout aunque el objeto final lo decida `object-cover`. La URL
          // firmada es de un bucket externo (`storage.getSignedReadUrl`),
          // sin `next/image` porque no está en `images.remotePatterns`.
          <img
            src={coverImageUrl}
            alt={room.title}
            width={1260}
            height={540}
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0" data-slot="room-cover-placeholder" />
        )}
        {isAuthor ? <RoomCoverUpload roomId={room.id} /> : null}

        <div className="relative z-10 flex flex-col gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 text-white">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-black/40 px-2 py-1 backdrop-blur">
              {t("version", { semver: room.latestVersion.semver })}
            </span>
            {room.saleEvents ? (
              <span className="rounded-full bg-black/40 px-2 py-1 backdrop-blur">
                {t("saleEvents")}
              </span>
            ) : null}
          </div>
          <h1 className="text-3xl font-semibold" lang={room.defaultLanguage}>
            {room.title}
          </h1>
          <RatingSummary ratingAvg={room.ratingAvg} ratingCount={room.ratingCount} />
        </div>
      </div>

      <p className="whitespace-pre-line" lang={room.defaultLanguage}>
        {room.description}
      </p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-border p-4 text-sm sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <Button asChild size="lg" className="w-fit">
        <Link href="/redeem">{t("playCta")}</Link>
      </Button>

      <section aria-labelledby="reviews-heading" className="flex flex-col gap-3">
        <h2 id="reviews-heading" className="text-xl font-semibold">
          {t("reviewsHeading")}
        </h2>
        <ReviewForm roomId={room.id} initial={viewer} />
        <Suspense fallback={<ReviewsSkeleton />}>
          <ReviewsList roomId={room.id} locale={locale} reviewsPromise={reviewsPromise} />
        </Suspense>
      </section>
    </main>
  );
}
