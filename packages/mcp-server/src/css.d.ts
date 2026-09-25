/**
 * `@escaperoom/editor/rules-graph` importa `@xyflow/react/dist/style.css`
 * como side-effect para que los bundlers de destino (Next.js) lo empaqueten
 * junto al componente (F-16); este paquete solo lo tipa transitivamente
 * (nunca renderiza `RulesGraph`), así que necesita la misma declaración
 * ambiental que ya tiene `packages/editor`.
 */
declare module "*.css";
