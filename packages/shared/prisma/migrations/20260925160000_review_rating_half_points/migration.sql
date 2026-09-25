-- Permitir medios puntos en las valoraciones (docs/DEUDA.md: "Permitir
-- valoraciones en medios puntos"). Escala doblada: 2–10 enteros en BD,
-- 1–5 con pasos de 0,5 en la capa de servicio (evita problemas de precisión
-- de Decimal). Los valores existentes (1–5) se multiplican por 2 antes de
-- ampliar el CHECK, así que la migración no puede paralelizarse con
-- escrituras concurrentes a "review" (ventana corta, tabla pequeña).
ALTER TABLE "review" DROP CONSTRAINT "review_rating_check";

UPDATE "review" SET rating = rating * 2;

ALTER TABLE "review" ADD CONSTRAINT "review_rating_check" CHECK (rating BETWEEN 2 AND 10);
