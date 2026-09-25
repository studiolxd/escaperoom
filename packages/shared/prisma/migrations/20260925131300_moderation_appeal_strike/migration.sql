-- E-7: FK moderationAppeal.strikeId sin índice.
CREATE INDEX CONCURRENTLY "ixModerationAppealStrike" ON "moderationAppeal"("strikeId");
