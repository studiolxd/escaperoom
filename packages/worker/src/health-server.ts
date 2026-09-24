import { createServer, type Server } from "node:http";
import { createWorkerHealthHandler, type WorkerHealthDeps } from "@escaperoom/kit/health";
import { logger } from "@escaperoom/kit/logger";

// ---------------------------------------------------------------------------
// E-9: el worker no exponía ningún endpoint de salud (`createWorkerHealthHandler`
// de kit solo se usaba en tests); un orquestador (systemd, Docker, k8s) no
// tenía forma de saber si seguía consumiendo colas o reiniciarlo si no.
// `WORKER_HEALTH_PORT` (sin definir: no se arranca el servidor, útil para
// tests/dev sin puerto reservado).
// ---------------------------------------------------------------------------

/** Arranca el `/healthz` del worker si `WORKER_HEALTH_PORT` está configurado. */
export function startWorkerHealthServer(deps: WorkerHealthDeps): Server | null {
  const port = Number.parseInt(process.env.WORKER_HEALTH_PORT ?? "", 10);
  if (!Number.isInteger(port) || port <= 0) return null;

  const handler = createWorkerHealthHandler(deps);
  const server = createServer((req, res) => {
    const url = `http://localhost${req.url ?? "/"}`;
    void handler(new Request(url, { method: req.method }))
      .then(async (response) => {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "worker health server: fallo sirviendo la petición");
        res.writeHead(503).end();
      });
  });
  server.listen(port, () => {
    logger.info({ port }, "worker: /healthz escuchando");
  });
  server.on("error", (err) => {
    logger.warn({ err, port }, "worker health server: error");
  });
  return server;
}
