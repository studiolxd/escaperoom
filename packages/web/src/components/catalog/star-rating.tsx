/**
 * Pinta 5 estrellas (llena/media/vacía) a partir de un valor decimal 0-5,
 * redondeado al medio punto más cercano (4.4 → 4.5 llenas y media).
 */
export function StarRating({ value, className }: { value: number; className?: string }) {
  const rounded = Math.round(Math.max(0, Math.min(5, value)) * 2) / 2;

  return (
    <span aria-hidden="true" className={className ? `inline-flex ${className}` : "inline-flex"}>
      {Array.from({ length: 5 }, (_, i) => {
        const position = i + 1;
        const fill = rounded >= position ? "full" : rounded >= position - 0.5 ? "half" : "empty";
        return <Star key={position} fill={fill} />;
      })}
    </span>
  );
}

function Star({ fill }: { fill: "full" | "half" | "empty" }) {
  return (
    <span className="relative inline-block leading-none">
      <span className="text-muted-foreground/30">★</span>
      {fill !== "empty" && (
        <span
          className="absolute inset-0 overflow-hidden text-amber-500"
          style={{ width: fill === "half" ? "50%" : "100%" }}
        >
          ★
        </span>
      )}
    </span>
  );
}
