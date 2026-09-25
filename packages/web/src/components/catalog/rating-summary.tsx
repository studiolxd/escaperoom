import { useFormatter, useTranslations } from "next-intl";
import { StarRating } from "./star-rating";

/** Estrellas pintadas + recuento ("★★★★☆ (128 reseñas)" o "Sin reseñas todavía"). */
export function RatingSummary({
  ratingAvg,
  ratingCount,
}: {
  ratingAvg: number | null;
  ratingCount: number;
}) {
  const t = useTranslations("Catalog");
  const format = useFormatter();
  if (ratingAvg === null || ratingCount === 0) {
    return <span className="text-muted-foreground">{t("noRatings")}</span>;
  }
  return (
    <span
      data-rating-avg={ratingAvg}
      data-rating-count={ratingCount}
      className="inline-flex items-center gap-1.5"
    >
      <StarRating value={ratingAvg} />
      <span className="sr-only">
        {t("rating", { avg: format.number(ratingAvg, { maximumFractionDigits: 1 }), count: ratingCount })}
      </span>
      <span aria-hidden="true">({t("ratingCount", { count: ratingCount })})</span>
    </span>
  );
}
