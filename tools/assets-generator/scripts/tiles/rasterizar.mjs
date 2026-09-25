// Rasteriza SVG del generador a PNG a una escala dada (1 = viewBox a 2×; 0.5 = 1×). Lo usa empaquetar_pack.py.
// Uso: node rasterizar.mjs <escala> <entrada.svg> <salida.png> [<entrada.svg> <salida.png> …]
import sharp from "sharp";
import { readFileSync } from "node:fs";
const [, , escala, ...pares] = process.argv;
for (let i = 0; i < pares.length; i += 2) {
  await sharp(readFileSync(pares[i]), { density: 72 * parseFloat(escala) }).png().toFile(pares[i + 1]);
}
