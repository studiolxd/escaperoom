-- B-13: seq scan sobre progressEvent en hasPlayedOrPurchased (WHERE pe."playerId" = …),
-- llamada en cada detalle de sala con sesión. CONCURRENTLY: no bloquea escrituras
-- en una tabla de eventos de progreso, que crece con cada partida jugada.
CREATE INDEX CONCURRENTLY "ixProgressEventPlayer" ON "progressEvent"("playerId");
