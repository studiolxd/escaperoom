import { createServer } from "node:net";

/**
 * Pide al SO un puerto TCP libre (escuchando en el puerto 0) y lo libera.
 *
 * `boot()` de @colyseus/testing no admite el puerto 0: el SDK de test se
 * conecta a `server.port` tal cual, así que necesitamos el número real antes
 * de arrancar. Con un puerto por fichero de test, varios procesos (worktrees,
 * verify en paralelo) no chocan con EADDRINUSE en el 2568/2569 fijos.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("No se pudo obtener un puerto libre"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
