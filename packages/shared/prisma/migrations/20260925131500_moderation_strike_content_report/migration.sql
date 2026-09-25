-- E-7: FK moderationStrike.contentReportId sin índice.
CREATE INDEX CONCURRENTLY "ixModerationStrikeContentReport" ON "moderationStrike"("contentReportId");
