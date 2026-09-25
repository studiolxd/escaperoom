import type {
  CatalogRoom,
  Review,
  ReviewListResult,
  ReviewViewerState,
  RoomAccessResult,
} from "@escaperoom/shared/services";
import { Suspense } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CATALOG_PATH, roomPath } from "@/lib/catalog-seo";
import { roomGamePlayPath } from "@/lib/game-net";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BuyRoomButton } from "./buy-room-button";
import { FreeRoomPlayButton } from "./free-room-play-button";
import { languageName } from "./language-name";
import { RatingSummary } from "./rating-summary";
import { ReviewForm } from "./review-form";
import { RoomCoverUpload } from "./room-cover-upload";
import { RoomPrice } from "./room-card";

function ReviewItem({ review }: { review: Review }) {
  const t = useTranslations("RoomDetail");
  const format = useFormatter();
  return (
    <li className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0">
      <div className="flex items-center gap-2 text-sm">
        <span aria-label={t("stars", { rating: review.rating })} className="text-amber-500">
          {"★".repeat(review.rating)}
          <span className="text-muted-foreground/40">{"★".repeat(5 - review.rating)}</span>
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

/**
 * CTA principal de la ficha (entrada "CTA Jugar", `docs/DEUDA.md`, puntos
 * b–j): decide entre Comprar / Jugar / Reanudar / Ya jugada / Jugar gratis /
 * Organizar un evento / nada, según el modo de venta y el acceso del viewer.
 * `access` ya trae el `gameToken` (B-4): esta ficha nunca decide acceso, solo
 * pinta el botón que corresponde al resultado de `GET /api/rooms/:roomId/access`.
 */
function RoomPlayCta({
  room,
  locale,
  isFree,
  isPaid,
  isEventsOnly,
  access,
  isAnonymous,
  roomHref,
}: {
  room: CatalogRoom;
  locale: string;
  isFree: boolean;
  isPaid: boolean;
  isEventsOnly: boolean;
  access: RoomAccessResult | null;
  isAnonymous: boolean;
  roomHref: string;
}) {
  const t = useTranslations("RoomDetail");

  // Punto h: solo para eventos, con venta para eventos activa. Sin ningún
  // modo de venta, no hay botón (cae al `return null` final).
  if (isEventsOnly) {
    return (
      <Button asChild size="lg" className="w-fit">
        <Link href={{ pathname: "/events/new", query: { roomVersionId: room.latestVersion.id } }}>
          {t("organizeEventCta")}
        </Link>
      </Button>
    );
  }

  // Punto i: sala gratis, sin cuenta, sin distinguir `isAnonymous`.
  if (isFree) {
    return <FreeRoomPlayButton roomId={room.id} />;
  }

  if (isPaid) {
    // Punto c: sin sesión, el CTA lleva primero a login/registro (con
    // retorno a esta sala), nunca lanza el checkout directamente.
    if (isAnonymous) {
      return (
        <Button asChild size="lg" className="w-fit" variant="outline">
          <Link href={`/login?callbackURL=${encodeURIComponent(roomHref)}`}>
            {t("loginToBuyCta")}
          </Link>
        </Button>
      );
    }
    // Punto f: acceso "libre" o "en curso" → Jugar/Reanudar con el
    // `gameToken` ya emitido; "en curso" además une a la `GameRoom` viva
    // (`access.roomId`) en vez de crear otra.
    if (access?.owned && access.playable && access.gameToken) {
      const gameHref = `/${locale}${roomGamePlayPath(room.id, access.gameToken, access.roomId)}`;
      return (
        <Button asChild size="lg" className="w-fit">
          <a href={gameHref}>{t(access.roomId ? "resumeCta" : "playCta")}</a>
        </Button>
      );
    }
    // Punto f: compra consumida → ya se jugó, ofrecer volver a comprar.
    if (access?.owned && !access.playable) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t("alreadyPlayed")}</p>
          <BuyRoomButton roomVersionId={room.latestVersion.id} />
        </div>
      );
    }
    return <BuyRoomButton roomVersionId={room.latestVersion.id} />;
  }

  // Ni venta individual ni para eventos: sin botón (punto h).
  return null;
}

/** Detalle SSR de una sala del catálogo: ficha, reseñas y formulario de reseña. */
export function RoomDetailView({
  room,
  locale,
  reviewsPromise,
  viewer,
  coverImageUrl,
  isAuthor,
  access,
  isAnonymous,
}: {
  room: CatalogRoom;
  locale: string;
  reviewsPromise: Promise<ReviewListResult>;
  viewer: ReviewViewerState;
  coverImageUrl: string | null;
  isAuthor: boolean;
  /** `GET /api/rooms/:roomId/access`; `null` sin sesión o servicio no disponible. */
  access: RoomAccessResult | null;
  isAnonymous: boolean;
}) {
  const t = useTranslations("RoomDetail");
  const tc = useTranslations("Catalog");

  // Punto i, "CTA Jugar" (`docs/DEUDA.md`): gratis SOLO con precio 0 y venta
  // individual — precio `null` (sin venta individual) NO es gratis (punto j).
  const isFree = room.priceCents === 0 && room.saleIndividual;
  const isPaid = room.saleIndividual && !isFree;
  // Punto h: "solo para eventos" es la venta para eventos SIN venta
  // individual; una sala con ambas sigue mostrando el badge genérico de abajo.
  const isEventsOnly = !room.saleIndividual && room.saleEvents;
  // Absoluta (con locale): value de `callbackURL` para Better Auth, no un
  // `href` de `next-intl/navigation` (ese SÍ añade el locale él solo).
  const roomHref = `/${locale}${roomPath(room.id)}`;

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
            {isEventsOnly ? (
              <span className="rounded-full bg-black/40 px-2 py-1 backdrop-blur">
                {t("eventsOnlyBadge")}
              </span>
            ) : room.saleEvents ? (
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

      <RoomPlayCta
        room={room}
        locale={locale}
        isFree={isFree}
        isPaid={isPaid}
        isEventsOnly={isEventsOnly}
        access={access}
        isAnonymous={isAnonymous}
        roomHref={roomHref}
      />

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
