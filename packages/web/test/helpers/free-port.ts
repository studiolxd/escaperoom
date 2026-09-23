import { createServer } from "node:net";

/** Puerto TCP libre del SO (como `colyseus-server/test/helpers/free-port`). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("sin puerto"));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}
