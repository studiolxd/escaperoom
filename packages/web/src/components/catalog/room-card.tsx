import type { CatalogRoom } from "@escaperoom/shared/services";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { roomPath } from "@/lib/catalog-seo";
import { languageName } from "./language-name";
import { RatingSummary } from "./rating-summary";

/**
 * Precio individual formateado en el locale de la UI. "Gratis" SOLO con
 * precio 0 y venta individual activa (punto j de la entrada "CTA Jugar",
 * `docs/DEUDA.md`); con precio `null` (sin venta individual) la sala es
 * "Solo para eventos" — antes esta etiqueta mostraba "Gratis" también en ese
 * caso, aunque la sala no se pudiera jugar.
 */
export function RoomPrice({
  room,
}: {
  room: Pick<CatalogRoom, "priceCents" | "currency" | "saleIndividual">;
}) {
  const t = useTranslations("Catalog");
  const format = useFormatter();
  if (room.priceCents === 0 && room.saleIndividual) return <>{t("free")}</>;
  if (room.priceCents === null) return <>{t("eventsOnly")}</>;
  return (
    <>{format.number(room.priceCents / 100, { style: "currency", currency: room.currency })}</>
  );
}

/** Tarjeta de sala en el listado del catálogo. */
export function RoomCard({
  room,
  locale,
  coverImageUrl,
}: {
  room: CatalogRoom;
  locale: string;
  coverImageUrl: string | null;
}) {
  const t = useTranslations("Catalog");
  return (
    <article
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
      data-room-id={room.id}
    >
      {/* Mismo patrón que la ficha de sala (room-detail.tsx): degradado
          oscuro fijo sobre la portada, título y reseñas dentro. A sangre con
          la tarjeta (el `overflow-hidden` de arriba recorta las esquinas). */}
      <div
        className="relative isolate flex aspect-video w-full flex-col justify-end bg-muted"
        data-slot="room-cover"
      >
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={room.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <div className="force-light relative z-10 flex flex-col gap-1 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 text-white">
          <h2 className="text-lg font-semibold" lang={room.defaultLanguage}>
            <Link href={roomPath(room.id)} className="hover:underline">
              {room.title}
            </Link>
          </h2>
          <RatingSummary ratingAvg={room.ratingAvg} ratingCount={room.ratingCount} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs text-muted-foreground">
          {t("byAuthor", { author: room.authorDisplayName })}
        </p>
        <p className="line-clamp-3 text-sm" lang={room.defaultLanguage}>
          {room.description}
        </p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <div className="flex gap-1">
            <dt className="font-medium">{t("difficulty")}</dt>
            <dd>{t(`difficulty${room.difficulty}`)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">{t("players")}</dt>
            <dd>{t("playersRange", { min: room.players.min, max: room.players.max })}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">{t("time")}</dt>
            <dd>{t("minutes", { minutes: room.estimatedMinutes })}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">{t("language")}</dt>
            <dd>{room.languages.map((code) => languageName(code, locale)).join(", ")}</dd>
          </div>
        </dl>
        <div className="mt-auto flex items-center justify-end text-sm">
          <span className="font-medium">
            <RoomPrice room={room} />
          </span>
        </div>
      </div>
    </article>
  );
}
