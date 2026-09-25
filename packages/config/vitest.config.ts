import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // El timeout por defecto de vitest (5 s) se queda corto en CI
    // (ubuntu-latest, 2 vCPU): `pnpm verify` lanza lint/typecheck/test/build
    // de TODO el monorepo a la vez con turbo, y vitest aísla cada archivo de
    // test en su propio worker — con decenas de archivos por paquete
    // compitiendo por 2 hilos, un test individual puede tardar más de 5 s
    // aunque su trabajo real sean solo unos ms en una máquina sin esa
    // contención (confirmado: <150 ms por test en local). No es una
    // regresión de rendimiento de ningún paquete; es margen de CI.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
