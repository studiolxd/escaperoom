-- E-7: FK purchase.resultingRoomId sin índice (localizar la compra que originó un fork/licencia).
CREATE INDEX CONCURRENTLY "ixPurchaseResultingRoom" ON "purchase"("resultingRoomId");
