-- E-7: FK progressEvent.accessKeyCode sin índice (canje/consulta de progreso por clave de acceso).
CREATE INDEX CONCURRENTLY "ixProgressEventAccessKey" ON "progressEvent"("accessKeyCode");
