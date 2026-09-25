-- E-7: FK eventRecording.sessionId sin índice.
CREATE INDEX CONCURRENTLY "ixEventRecordingSession" ON "eventRecording"("sessionId");
