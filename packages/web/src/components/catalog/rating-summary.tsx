import { useFormatter, useTranslations } from "next-intl";

/** Media y recuento de reseñas ("4,6 de 5 (128 reseñas)" o "Sin reseñas todavía"). */
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
    <span data-rating-avg={ratingAvg} data-rating-count={ratingCount}>
      <span aria-hidden="true">★ </span>
      {t("rating", {
        avg: format.number(ratingAvg, { maximumFractionDigits: 1 }),
        count: ratingCount,
      })}
    </span>
  );
}
