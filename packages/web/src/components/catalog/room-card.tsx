import type { CatalogRoom } from "@escaperoom/shared/services";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { roomPath } from "@/lib/catalog-seo";
import { languageName } from "./language-name";
import { RatingSummary } from "./rating-summary";

/** Precio individual formateado en el locale de la UI ("Gratis" si no hay precio). */
export function RoomPrice({ room }: { room: Pick<CatalogRoom, "priceCents" | "currency"> }) {
  const t = useTranslations("Catalog");
  const format = useFormatter();
  if (!room.priceCents) return <>{t("free")}</>;
  return (
    <>{format.number(room.priceCents / 100, { style: "currency", currency: room.currency })}</>
  );
}

/** Tarjeta de sala en el listado del catálogo. */
export function RoomCard({ room, locale }: { room: CatalogRoom; locale: string }) {
  const t = useTranslations("Catalog");
  return (
    <article
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
      data-room-id={room.id}
    >
      <h2 className="text-lg font-semibold" lang={room.defaultLanguage}>
        <Link href={roomPath(room.id)} className="hover:underline">
          {room.title}
        </Link>
      </h2>
      <p className="text-xs text-muted-foreground">
        {t("byAuthor", { author: room.authorDisplayName })}
      </p>
      <p className="line-clamp-3 text-sm" lang={room.defaultLanguage}>
        {room.description}
      </p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <li>{t(`difficulty${room.difficulty}`)}</li>
        <li>{t("playersRange", { min: room.players.min, max: room.players.max })}</li>
        <li>{t("minutes", { minutes: room.estimatedMinutes })}</li>
        <li>{room.languages.map((code) => languageName(code, locale)).join(", ")}</li>
      </ul>
      <div className="mt-auto flex items-center justify-between gap-2 text-sm">
        <RatingSummary ratingAvg={room.ratingAvg} ratingCount={room.ratingCount} />
        <span className="font-medium">
          <RoomPrice room={room} />
        </span>
      </div>
    </article>
  );
}
