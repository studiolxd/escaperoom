import { defineConfig, mergeConfig } from "vitest/config";
import base from "@escaperoom/config/vitest";

// Los tests de integración arrancan un servidor Colyseus real. Se ejecutan en
// serie para que dos ficheros no levanten dos servidores a la vez (el segundo
// `listen()` sobre el mismo puerto cuelga el hook de arranque).
export default mergeConfig(
  base,
  defineConfig({
    test: {
      fileParallelism: false,
    },
  }),
);
