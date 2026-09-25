-- E-7: FK moderationAppeal.roomId sin índice.
CREATE INDEX CONCURRENTLY "ixModerationAppealRoom" ON "moderationAppeal"("roomId");
