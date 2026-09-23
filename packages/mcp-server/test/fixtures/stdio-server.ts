import { actorFromEnv, runStdioServer } from "../../src";
import { createTestDeps } from "./drafts";

/**
 * Servidor stdio de test: el mismo `runStdioServer` que `src/bin/stdio.ts`,
 * con la identidad por entorno y los drafts de test en memoria.
 */
await runStdioServer(await createTestDeps(actorFromEnv()));
