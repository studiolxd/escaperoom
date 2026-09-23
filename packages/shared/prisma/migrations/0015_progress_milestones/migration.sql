-- 0015_progress_milestones — bitácora de hitos de las partidas de evento (ticket 5.12, specs/14 §8.1).
--
-- La room `event` de Colyseus persiste cada hito de la partida en `progressEvent`
-- (0008) para que el panel del organizador y el ranking sobrevivan a un reinicio.
-- Además de `solved`/`hint_used`/`attempt_failed` hacen falta el inicio, la
-- apertura de una puerta y el fin de la partida con su resultado; los dos
-- últimos no son de un puzzle, así que `puzzleId` pasa a ser opcional.
--
-- `ADD VALUE` no puede usarse en la misma transacción que lo crea: aquí solo se
-- declara (Postgres ≥ 12 lo admite dentro de un bloque de transacción).
ALTER TYPE "progressEventKind" ADD VALUE IF NOT EXISTS 'game_started';
ALTER TYPE "progressEventKind" ADD VALUE IF NOT EXISTS 'door_opened';
ALTER TYPE "progressEventKind" ADD VALUE IF NOT EXISTS 'game_ended';

ALTER TABLE "progressEvent"
  ALTER COLUMN "puzzleId" DROP NOT NULL,
  ADD COLUMN "objectId" text,        -- puerta abierta (`door_opened`)
  ADD COLUMN "result"   text,        -- desenlace (`game_ended`)
  ADD CONSTRAINT "ckProgressEventResult"
    CHECK (result IS NULL OR result IN ('victory', 'timeout', 'aborted')),
  ADD CONSTRAINT "ckProgressEventTarget"
    CHECK ("eventKind" NOT IN ('solved', 'hint_used', 'attempt_failed') OR "puzzleId" IS NOT NULL);
