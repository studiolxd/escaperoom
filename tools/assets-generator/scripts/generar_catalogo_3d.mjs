// Genera el catálogo versionado de modelos 3D de un pack (specs/27 §4, encargo 7.10a):
//
//   node scripts/generar_catalogo_3d.mjs [--pack medieval-v1]           # escribe packages/shared/src/packs/<pack>.models3d.json
//   node scripts/generar_catalogo_3d.mjs [--pack medieval-v1] --check   # falla si el fichero versionado no coincide
//
// Entrada: packs/<pack>/modelos3d.json (categoría, grupo, nombre, colisión y alias de cada modelo) y, por cada modelo,
// su GLB optimizado de packages/web/public/packs/<pack>/models/<id>.glb, del que se mide la caja envolvente
// (`getBounds` de gltf-transform; ejes del GLB: w = X, d = Z, hgt = Y) y los clips.
//
// - Un modelo cuyo GLB no existe usa el `size` (y el `centro`) declarados en modelos3d.json; si no los declara, el
//   script falla diciendo cuál. Tras generar, el script ESCRIBE DE VUELTA en modelos3d.json el `size` medido (y el
//   `centro` de la envolvente, para que el colisionador por defecto salga igual) de cada modelo: así `--check`
//   funciona en un clon sin binarios.
// - Colisionador por defecto: una caja con la envolvente, en coordenadas lógicas (cx, cy = centro en X y Z del GLB;
//   ch = centro en Y). Si el modelo declara `colliders`, se copian tal cual (`[]` = no bloquea).
// - Las piezas de kit (`snap: true`) ocupan celdas enteras: su planta (w, d) se redondea hacia arriba al metro (la
//   columna, el escalón y el umbral miden menos de 1 m, pero ocupan una celda).
// - Las medidas se redondean a 3 decimales y ninguna queda por debajo de 0,001 m (una tela de grosor 0 mide 0,001: el
//   esquema pide medidas positivas). Salida determinista: claves de los modelos ordenadas, `version` "1.0.0". `avatars`
//   se conserva tal cual está en el fichero que ya existe.
// - `alias`: ids adicionales que apuntan al mismo fichero y metadatos (entradas propias del catálogo).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const VERSION = '1.0.0'
const MINIMO = 0.001

export const r3 = (v) => {
  const x = Math.round(v * 1000) / 1000
  return Object.is(x, -0) ? 0 : x
}

/** Copia con las claves de los objetos ordenadas (los arrays conservan su orden) y los números redondeados. */
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, ordenar(v[k])]),
    )
  return typeof v === 'number' ? r3(v) : v
}

/** Caja envolvente y clips de un GLB optimizado. */
export async function medir(ruta) {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read(ruta)
  const { min, max } = getBounds(doc.getRoot().listScenes()[0])
  return {
    w: max[0] - min[0],
    d: max[2] - min[2],
    hgt: max[1] - min[1],
    cx: (min[0] + max[0]) / 2,
    cy: (min[2] + max[2]) / 2,
    ch: (min[1] + max[1]) / 2,
    clips: doc
      .getRoot()
      .listAnimations()
      .map((a) => a.getName()),
  }
}

/** Texto del fichero de configuración: un modelo (o alias, o sprite) por línea. */
export function formatoConfig(cfg) {
  const lineas = []
  const claves = Object.keys(cfg)
  claves.forEach((k, i) => {
    const v = cfg[k]
    const coma = i < claves.length - 1 ? ',' : ''
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const hijos = Object.keys(v)
      lineas.push(`  ${JSON.stringify(k)}: {`)
      hijos.forEach((h, j) => lineas.push(`    ${JSON.stringify(h)}: ${JSON.stringify(v[h])}${j < hijos.length - 1 ? ',' : ''}`))
      lineas.push(`  }${coma}`)
    } else lineas.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${coma}`)
  })
  return `{\n${lineas.join('\n')}\n}\n`
}

function entrada(id, m, med) {
  const size = med
    ? { w: Math.max(med.w, MINIMO), d: Math.max(med.d, MINIMO), hgt: Math.max(med.hgt, MINIMO) }
    : { w: Math.max(m.size.w, MINIMO), d: Math.max(m.size.d, MINIMO), hgt: Math.max(m.size.hgt, MINIMO) }
  if (m.snap === true) {
    // las piezas de kit ocupan celdas enteras (specs/27 §4.1): la planta se redondea hacia arriba al metro
    size.w = Math.max(1, Math.ceil(size.w - 0.01))
    size.d = Math.max(1, Math.ceil(size.d - 0.01))
  }
  const centro = med ? { cx: med.cx, cy: med.cy, ch: med.ch } : (m.centro ?? { cx: 0, cy: 0, ch: size.hgt / 2 })
  const colliders = m.colliders ?? [
    { type: 'box', cx: centro.cx, cy: centro.cy, ch: centro.ch, sx: size.w, sy: size.d, sh: size.hgt },
  ]
  const e = {
    file: `models/${id}.glb`,
    category: m.category,
    label: Object.fromEntries(Object.entries(m.label).map(([l, text]) => [l, { text }])),
    size,
    colliders,
    snap: m.snap === true,
    clips: med ? med.clips : (m.clips ?? []),
  }
  if (m.group) e.group = m.group
  return e
}

/**
 * Genera el catálogo. `check`: no escribe nada y devuelve los problemas. Devuelve { catalogo, problemas }.
 * Opciones: pack, config (ruta), modelos (carpeta de GLB), salida (ruta del catálogo).
 */
export async function generar({ pack = 'medieval-v1', config, modelos, salida, check = false } = {}) {
  config ??= join(RAIZ, 'packs', pack, 'modelos3d.json')
  modelos ??= join(RAIZ, '..', '..', 'packages', 'web', 'public', 'packs', pack, 'models')
  salida ??= join(RAIZ, '..', '..', 'packages', 'shared', 'src', 'packs', `${pack}.models3d.json`)
  const cfg = JSON.parse(readFileSync(config, 'utf8'))
  const problemas = []
  const models = {}
  let cfgCambiado = false

  for (const [id, m] of Object.entries(cfg.modelos)) {
    const ruta = join(modelos, `${id}.glb`)
    let med = null
    if (existsSync(ruta)) med = await medir(ruta)
    else if (!m.size) throw new Error(`${id}: no existe ${ruta} y modelos3d.json no declara su "size"`)
    models[id] = entrada(id, m, med)
    if (med) {
      const nuevo = { w: r3(med.w), d: r3(med.d), hgt: r3(med.hgt) }
      const centro = { cx: r3(med.cx), cy: r3(med.cy), ch: r3(med.ch) }
      const clips = med.clips.length ? med.clips : undefined
      if (
        JSON.stringify(m.size) !== JSON.stringify(nuevo) ||
        JSON.stringify(m.centro) !== JSON.stringify(centro) ||
        JSON.stringify(m.clips) !== JSON.stringify(clips)
      ) {
        problemas.push(`${id}: el size/centro/clips de modelos3d.json no coincide con el GLB`)
        m.size = nuevo
        m.centro = centro
        if (clips) m.clips = clips
        else delete m.clips
        cfgCambiado = true
      }
    }
  }
  for (const [alias, destino] of Object.entries(cfg.alias ?? {})) {
    if (!models[destino]) throw new Error(`alias ${alias}: el modelo ${destino} no existe`)
    if (models[alias]) throw new Error(`alias ${alias}: ya es un modelo`)
    models[alias] = structuredClone(models[destino])
  }
  for (const [sprite, s] of Object.entries(cfg.sprites2d ?? {}))
    if (!models[s.model]) throw new Error(`sprites2d ${sprite}: el modelo ${s.model} no existe`)

  const previo = existsSync(salida) ? JSON.parse(readFileSync(salida, 'utf8')) : null
  const catalogo = { packId: pack, version: VERSION, models: ordenar(models), avatars: previo?.avatars ?? {} }
  const texto = JSON.stringify(catalogo, null, 2) + '\n'

  if (check) {
    if (!previo || readFileSync(salida, 'utf8') !== texto) problemas.push(`${salida} no coincide con lo que genera modelos3d.json`)
  } else {
    writeFileSync(salida, texto)
    if (cfgCambiado) writeFileSync(config, formatoConfig(cfg))
  }
  return { catalogo: texto, problemas, modelos: Object.keys(models).length }
}

function argumentos(argv) {
  const opt = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const k = argv[i].slice(2)
    opt[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  }
  return opt
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opt = argumentos(process.argv.slice(2))
  try {
    const r = await generar({ pack: opt.pack ?? 'medieval-v1', config: opt.config, modelos: opt.modelos, salida: opt.salida, check: !!opt.check })
    if (opt.check) {
      if (r.problemas.length) {
        console.error(r.problemas.join('\n'))
        process.exit(1)
      }
      console.log(`OK catálogo al día (${r.modelos} modelos)`)
    } else console.log(`OK catálogo generado (${r.modelos} modelos)`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
