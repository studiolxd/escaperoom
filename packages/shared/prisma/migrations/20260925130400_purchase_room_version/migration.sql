-- E-7: FK purchase.roomVersionId sin índice dedicado (uxPurchaseOwnedRoom no sirve para filtrar solo por versión).
CREATE INDEX CONCURRENTLY "ixPurchaseRoomVersion" ON "purchase"("roomVersionId");
