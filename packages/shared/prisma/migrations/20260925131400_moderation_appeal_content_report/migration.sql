-- E-7: FK moderationAppeal.contentReportId sin índice.
CREATE INDEX CONCURRENTLY "ixModerationAppealContentReport" ON "moderationAppeal"("contentReportId");
