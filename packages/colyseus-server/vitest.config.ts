import { defineConfig, mergeConfig } from "vitest/config";
import base from "@escaperoom/config/vitest";

// Los tests de integración arrancan un servidor Colyseus real, cada uno en un
// puerto libre del SO (test/helpers/free-port.ts). Se mantienen en serie para
// no arrancar varios servidores Colyseus en el mismo proceso a la vez.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      fileParallelism: false,
    },
  }),
);
