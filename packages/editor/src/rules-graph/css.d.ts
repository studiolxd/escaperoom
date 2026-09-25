/**
 * Import de CSS como side-effect (`@xyflow/react/dist/style.css`, F-16): el
 * bundler de destino (Next.js) sabe manejarlo; TypeScript, sin esta
 * declaración ambiental, no.
 */
declare module "*.css";
