// Previsualiza cada SVG de un estilo (estilos/<estilo>/renders/svg/<nombre>.svg) como mosaico iso 3×3 y a 128×64
// real (tamaño real de trabajo actual del pack; ver docs/tiles/contexto.md). Salida en estilos/<estilo>/renders/previews/.
// Uso (desde assets-generator/): [ESTILO=vector-plano] node scripts/tiles/preview.mjs [nombre ...]
// Requiere: pnpm install   (sharp)
import sharp from "sharp";
import { readdirSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const S = 4, W = 128 * S, H = 64 * S, N = 3;
const RW = 128, RH = 64, RZOOM = 2; // tamaño real y factor de ampliación para la tira de comprobación
const EST = process.env.ESTILO || "vector-plano";
const SVG = `estilos/${EST}/renders/svg`, PREV = `estilos/${EST}/renders/previews`, PRESETS = `estilos/${EST}/tiles/presets`;
const preset_de = (name) => `${EST}/${name}`;   // nombre para tilegen.py (siempre con estilo)
mkdirSync(PREV, { recursive: true });
const allNames = readdirSync(SVG).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4));
const names = process.argv.slice(2).length ? process.argv.slice(2) : allNames;

// alto del viewBox: 64 = tile de suelo; más alto = sprite con altura (muro), cuya
// base 128×64 va abajo del lienzo (pivote abajo-centro) y el resto sobresale arriba.
const vbSize = (svg) => { const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg.toString()); return m ? [+m[1], +m[2]] : [128, 64]; };
const vbHeight = (svg) => vbSize(svg)[1];
// se rasteriza directamente a WxH con `density` (el SVG mide 128x64 a 72dpi) en vez
// de resize(): resize() reescala con interpolación (lanczos3) y añade un difuminado
// extra sobre el antialiasing nativo del borde del rombo.
const raster = (svg) => sharp(svg, { density: 72 * S }).png().toBuffer();
// celda (i,j): i crece hacia abajo-derecha (+v), j hacia abajo-izquierda (−u)
const cell = (i, j) => ({ left: Math.round((i - j) * W / 2 + (N - 1) * W / 2), top: Math.round((i + j) * H / 2) });

for (const name of names) {
  const svg = readFileSync(`${SVG}/${name}.svg`);
  const [tw, th] = vbSize(svg);
  const pad = (th - 64) * S;
  const tile = await raster(svg);
  const preset = existsSync(`${PRESETS}/${name}.json`) ? JSON.parse(readFileSync(`${PRESETS}/${name}.json`)) : {};
  if (preset.type === "sprite" || tw !== 128) {
    // sprite: sobre suelo piedra-1 en la celda central, pivote abajo-centro
    const comps = [];
    if (existsSync(`${SVG}/piedra-1.svg`)) {
      const floor = await raster(readFileSync(`${SVG}/piedra-1.svg`));
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const c = cell(i, j); comps.push({ input: floor, left: c.left, top: c.top + pad }); }
    }
    const c = cell(1, 1);
    comps.push({ input: tile, left: Math.round(c.left + (W - tw * S) / 2), top: c.top + pad - (th - 64) * S });
    await sharp({ create: { width: W * N, height: H * N + pad, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(comps).png().toFile(`${PREV}/${name}-mosaico.png`);
    console.log(`${PREV}/${name}-mosaico.png`);
    continue;
  }
  // sin solape: el mosaico debe reflejar cómo se van a ver los tiles en el juego
  // (a tope, sin margen). Si aquí queda una línea en la juntura, el fix va en el
  // SVG (tilegen.py), no compensándolo al componer el preview.
  const comps = [];
  if (pad === 0) {
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) comps.push({ input: tile, ...cell(i, j) });
  } else {
    // muro: suelo piedra-1 debajo (si existe) y una fila de 3 muros a lo largo de su
    // eje (dir del preset), pintados en orden de profundidad (i+j) como hará el
    // runtime: el tramo anterior tapa el canto corto del siguiente.
    const dir = preset.params?.dir ?? "u";
    if (existsSync(`${SVG}/piedra-1.svg`)) {
      const floor = await raster(readFileSync(`${SVG}/piedra-1.svg`));
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) { const c = cell(i, j); comps.push({ input: floor, left: c.left, top: c.top + pad }); }
    }
    const arms = preset.params?.arms;
    if (arms) {
      // pieza con brazos (esquina, T, cruz, remate): va en el centro y por cada brazo
      // se coloca un tramo recto del mismo preset (generado al vuelo con `tilegen.py svg`)
      // en la celda vecina; i = +v, j = −u.
      const straight = {};
      const mate = (ax) => (straight[ax] ??= raster(execFileSync("python3", ["scripts/tiles/tilegen.py", "svg", preset_de(name), "--set", `arms=${JSON.stringify(ax === "u" ? ["-u", "+u"] : ["-v", "+v"])}`], { maxBuffer: 1 << 26 })));
      const at = { "-u": [1, 2], "+u": [1, 0], "-v": [0, 1], "+v": [2, 1] };
      const items = [{ buf: tile, ij: [1, 1] }];
      for (const a of arms) items.push({ buf: await mate(a[1]), ij: at[a] });
      items.sort((p, q) => (p.ij[0] + p.ij[1]) - (q.ij[0] + q.ij[1]));
      for (const { buf, ij } of items) comps.push({ input: buf, ...cell(...ij) });
    } else {
      const row = dir === "v" ? [[0, 0], [1, 0], [2, 0]] : [[0, 0], [0, 1], [0, 2]];
      for (const [i, j] of row) comps.push({ input: tile, ...cell(i, j) });
    }
  }
  await sharp({ create: { width: W * N, height: H * N + pad, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps).png().toFile(`${PREV}/${name}-mosaico.png`);
  console.log(`${PREV}/${name}-mosaico.png`);
  // el tile suelto, a la misma escala que el mosaico
  await sharp({ create: { width: W, height: th * S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: tile, left: 0, top: 0 }]).png().toFile(`${PREV}/${name}-tile.png`);
  console.log(`${PREV}/${name}-tile.png`);
}

// todos-128.png siempre incluye TODOS los tiles de out/, aunque se haya pedido
// regenerar el mosaico de solo uno (si no, al llamar `node preview.mjs madera-1`
// esta tira se quedaba solo con madera-1 y perdía el resto). Los tiles altos
// (muros) van a su alto real, alineados por la base.
const strip = [];
let stripH = RH;
const smalls = [];
const sheet = []; // sprites-128.png: hoja de contacto de todo lo que no es tile/muro, a tamaño real ×2
const isSprite = (name) => { const p = `${PRESETS}/${name}.json`; return !existsSync(p) || JSON.parse(readFileSync(p)).type === "sprite"; };
for (const name of allNames.filter(isSprite)) {
  const svg = readFileSync(`${SVG}/${name}.svg`);
  const [tw, th] = vbSize(svg);
  const small = await sharp(svg).resize(tw, th).png().toBuffer();
  sheet.push({ name, w: tw * RZOOM, h: th * RZOOM, buf: await sharp(small).resize(tw * RZOOM, th * RZOOM, { kernel: "nearest" }).png().toBuffer() });
}
if (sheet.length) {
  const COLS = 8, CW = 256 * RZOOM + 8, CH = 256 * RZOOM + 8;
  const comps = sheet.map((e, k) => ({ input: e.buf, left: (k % COLS) * CW + Math.round((CW - e.w) / 2), top: Math.floor(k / COLS) * CH + CH - 8 - e.h }));
  await sharp({ create: { width: COLS * CW, height: Math.ceil(sheet.length / COLS) * CH, channels: 4, background: { r: 40, g: 40, b: 44, alpha: 1 } } })
    .composite(comps).png().toFile(`${PREV}/sprites-128.png`);
  console.log(`${PREV}/sprites-128.png`);
}
for (const name of allNames.filter((n) => !isSprite(n))) {
  const svg = readFileSync(`${SVG}/${name}.svg`);
  const th = vbHeight(svg);
  stripH = Math.max(stripH, th);
  const small = await sharp(svg).resize(RW, th).png().toBuffer();
  smalls.push({ th, buf: await sharp(small).resize(RW * RZOOM, th * RZOOM, { kernel: "nearest" }).png().toBuffer() });
}
for (const [idx, { th, buf }] of smalls.entries())
  strip.push({ input: buf, left: idx * (RW * RZOOM + 8), top: (stripH - th) * RZOOM });
await sharp({ create: { width: (RW * RZOOM + 8) * smalls.length, height: stripH * RZOOM, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(strip).png().toFile(`${PREV}/todos-128.png`);
console.log(`${PREV}/todos-128.png`);
