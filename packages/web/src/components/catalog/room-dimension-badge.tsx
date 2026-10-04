import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

/** Distintivo «2D» / «3D» del formato de la sala (catálogo y ficha). */
export function RoomDimensionBadge({ dimension }: { dimension: "2d" | "3d" }) {
  const t = useTranslations("Catalog");
  const label = dimension === "3d" ? t("dimension3d") : t("dimension2d");
  return (
    <Badge
      variant={dimension === "3d" ? "default" : "secondary"}
      aria-label={t("dimensionBadgeLabel", { dimension: label })}
      data-dimension={dimension}
    >
      {label}
    </Badge>
  );
}
