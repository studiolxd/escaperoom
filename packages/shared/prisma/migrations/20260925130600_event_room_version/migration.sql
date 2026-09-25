-- E-7: FK event.roomVersionId sin índice.
CREATE INDEX CONCURRENTLY "ixEventRoomVersion" ON "event"("roomVersionId");
