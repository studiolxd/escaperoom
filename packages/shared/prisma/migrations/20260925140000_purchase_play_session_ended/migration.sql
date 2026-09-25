-- B-4 (bloque 3, auditoría 2026-09-24): la partida de una compra B2C se
-- gasta al TERMINAR (victoria/derrota/tiempo agotado), no al crear la room.
-- `playSessionStartedAt` pasa a marcar una reclamación "en curso" que se
-- libera si la room se cierra sin terminar; `playSessionEndedAt` es el
-- consumo definitivo.
ALTER TABLE "purchase" ADD COLUMN "playSessionEndedAt" TIMESTAMPTZ(6);
