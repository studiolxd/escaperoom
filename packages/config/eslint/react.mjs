// Preset para paquetes con React puro (sin Next.js): reglas de hooks encima
// de la base compartida. Ver F-24 en la auditoría (2026-09-24).
//
// `eslint-plugin-react-hooks` v7 empaqueta en su preset "recommended" un
// conjunto mucho más amplio de reglas orientadas al React Compiler
// (inmutabilidad, pureza, `set-state-in-effect`, …) que exigirían reescribir
// patrones existentes fuera del alcance de F-24. Activamos solo las dos
// reglas que pide el hallazgo: `rules-of-hooks` (bugs reales) y
// `exhaustive-deps` (deps incompletas, como F-8).
import reactHooks from "eslint-plugin-react-hooks";
import base from "./base.mjs";

export const reactHooksRules = {
  plugins: { "react-hooks": reactHooks },
  rules: {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
  },
};

export default [...base, reactHooksRules];
