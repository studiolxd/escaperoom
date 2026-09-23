-- 0012_access_keys — asientos por clave y fin de grupo (ticket 5.5, specs/02 §4).
--
-- `seats`: asientos que concede la clave. Individual/batch = 1; una clave de grupo o
-- rotativa es un código compartido para N personas. La suma de `seats` de un evento
-- nunca supera `event."playersPurchased"` (lo garantiza el servicio bajo bloqueo de la
-- fila del evento). Al rotar, la clave vieja se queda con los asientos ya canjeados
-- (`seats = "redeemedCount"`, puede ser 0) y la nueva hereda el resto.
-- `redeemedCount`: asientos ya canjeados (5.8). La clave muere (`used`) al agotarlos.
ALTER TABLE "accessKey"
  ADD COLUMN seats           int NOT NULL DEFAULT 1,
  ADD COLUMN "redeemedCount" int NOT NULL DEFAULT 0,
  ADD CONSTRAINT "ckAccessKeySeats"
    CHECK (seats >= 0 AND "redeemedCount" >= 0 AND "redeemedCount" <= seats);

CREATE INDEX "ixAccessKeyGroup" ON "accessKey"("groupId");

-- El barrido de caducidad por fecha también cubre claves aún no confirmadas/activas
-- (`generated`, `sent`, `pending_confirmation`): cualquier clave viva puede caducar.
DROP INDEX "ixAccessKeyExpirySweep";
CREATE INDEX "ixAccessKeyExpirySweep" ON "accessKey"("expiresAt")
  WHERE status NOT IN ('used', 'expired') AND "expiresAt" IS NOT NULL;

-- Regla `on_group_complete` (specs/02 §4.3): instante en que el grupo superó la sala.
-- Lo escribe el servidor de partida; el job de caducidad mata las claves vivas del grupo.
ALTER TABLE "group" ADD COLUMN "completedAt" timestamptz;
