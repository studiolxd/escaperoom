import { defineConfig, mergeConfig } from "vitest/config";
import base from "@escaperoom/config/vitest";

// Los tests de integración arrancan un servidor Colyseus real, cada uno en un
// puerto libre del SO (test/helpers/free-port.ts). Se mantienen en serie para
// no arrancar varios servidores Colyseus en el mismo proceso a la vez.
// `*.spec.ts`: el E2E de protocolo del Rey Aldric (ticket 2.12, specs/22 §3.1).
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts", "test/**/*.spec.ts"],
      fileParallelism: false,
    },
  }),
);
