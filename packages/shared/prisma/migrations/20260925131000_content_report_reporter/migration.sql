-- E-7: FK contentReport.reporterId sin índice.
CREATE INDEX CONCURRENTLY "ixContentReportReporter" ON "contentReport"("reporterId");
