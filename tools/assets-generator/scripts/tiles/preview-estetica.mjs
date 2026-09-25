// Vista previa de los tiles de un estilo: cada SVG de estilos/<estilo>/renders/svg/ a 1× y 2×, mosaico 3×3 de los suelos y una sala de
// prueba (suelo alterno + muros del fondo con un arco y una ventana) a tamaño real (1×) y ampliada.
// Uso (desde assets-generator/): node scripts/tiles/preview-estetica.mjs castillo-toon   -> estilos/castillo-toon/renders/previews/
import sharp from "sharp";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";

const est = process.argv[2] || "castillo-toon";
const dir = `estilos/${est}/renders/svg`;
const outDir = `estilos/${est}/renders/previews`;
mkdirSync(outDir, { recursive: true });
const names = readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4));
const raster = (name, scale) => sharp(readFileSync(`${dir}/${name}.svg`), { density: 72 * scale }).png().toBuffer();

const tiles1x = {};
for (const n of names) {
  tiles1x[n] = await raster(n, 0.5);
  await sharp(tiles1x[n]).toFile(`${outDir}/${n}-1x.png`);
  await sharp(await raster(n, 1)).toFile(`${outDir}/${n}-2x.png`);
}
const meta = async (b) => sharp(b).metadata();

// sala de prueba a 1× (celda 64×32): muros en la fila y=0 y la columna x=0, suelo alterno piedra-1/piedra-2
const N = 7, W = 64 * N + 64, H = 32 * N + 200;
const ox = W / 2, oy = 170;
const cen = (gx, gy) => [ox + (gx - gy) * 32, oy + (gx + gy) * 16];
const comps = [];
const suelo = () => "piedra-1";
for (let s = 0; s <= 2 * (N - 1); s++)
  for (let gx = 0; gx < N; gx++) {
    const gy = s - gx;
    if (gy < 0 || gy >= N) continue;
    const [x, y] = cen(gx, gy);
    comps.push({ input: tiles1x[suelo(gx, gy)], left: x - 32, top: y - 16 });
  }
for (let s = 0; s <= 2 * (N - 1); s++)
  for (let gx = 0; gx < N; gx++) {
    const gy = s - gx;
    if (gy < 0 || gy >= N || (gx !== 0 && gy !== 0)) continue;
    let pieza = "muro-1";
    if (gy === 0 && gx === 4 && tiles1x["muro-arco-1-v"]) pieza = "muro-arco-1-v";
    if (gx === 0 && gy === 3 && tiles1x["muro-ventana-1"]) pieza = "muro-ventana-1";
    const b = tiles1x[pieza];
    const m = await meta(b);
    const [x, y] = cen(gx, gy);
    comps.push({ input: b, left: x - 32, top: y + 16 - m.height });
  }
const sala = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 11, g: 17, b: 32, alpha: 1 } } })
  .composite(comps).png().toBuffer();
await sharp(sala).toFile(`${outDir}/sala-1x.png`);
await sharp(sala).resize(W * 3, H * 3, { kernel: "nearest" }).toFile(`${outDir}/sala-3x.png`);
console.log(`${outDir}: ${names.length} piezas + sala-1x.png / sala-3x.png`);
