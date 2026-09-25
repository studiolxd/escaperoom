-- E-7: FK moderationAppeal.creatorId sin índice.
CREATE INDEX CONCURRENTLY "ixModerationAppealCreator" ON "moderationAppeal"("creatorId");
