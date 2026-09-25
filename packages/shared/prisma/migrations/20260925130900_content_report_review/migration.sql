-- E-7: FK contentReport.reviewId sin índice.
CREATE INDEX CONCURRENTLY "ixContentReportReview" ON "contentReport"("reviewId");
