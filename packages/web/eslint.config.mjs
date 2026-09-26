import nextjs from "@escaperoom/config/eslint/nextjs";

export default [
  ...nextjs,
  {
    rules: {
      // F-34 (auditoría 2026-09-24): una sola forma de importar `cn`, la que
      // genera el CLI de shadcn (`import { cn } from "cn"`), no el reexport
      // de `@/lib/utils` (retirado).
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/utils",
              importNames: ["cn"],
              message: 'Importa `cn` desde "cn", no desde "@/lib/utils".',
            },
          ],
        },
      ],
    },
  },
];
