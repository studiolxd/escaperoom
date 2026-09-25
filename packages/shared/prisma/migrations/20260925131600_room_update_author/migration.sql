-- E-7: FK roomUpdate.authorId sin índice.
CREATE INDEX CONCURRENTLY "ixRoomUpdateAuthor" ON "roomUpdate"("authorId");
