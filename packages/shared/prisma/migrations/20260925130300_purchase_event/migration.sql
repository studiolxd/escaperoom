-- E-7: FK purchase.eventId sin índice (findFirst por eventId+purchaseType+status en purchase-confirmation).
CREATE INDEX CONCURRENTLY "ixPurchaseEvent" ON "purchase"("eventId");
