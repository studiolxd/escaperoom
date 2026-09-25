-- E-7: FK contentReport.roomVersionId sin índice (roomId ya lo tiene, ixContentReportRoom de 0016).
CREATE INDEX CONCURRENTLY "ixContentReportRoomVersion" ON "contentReport"("roomVersionId");
