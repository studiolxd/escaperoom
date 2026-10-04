// Optimiza un GLB del modo 3D para Three.js (specs/27 §4 y §7.1).
//
//   node scripts/optimizar_glb.mjs <entrada.glb> <salida.glb> [--tex 1024] [--tris 30000]
//
// Pasos, en este orden: dedup, prune, weld, simplify (solo si supera --tris; nunca en mallas con skinning),
// textureCompress a WebP con lado máximo --tex y meshopt (EXT_meshopt_compression). Imprime una línea JSON con
// { file, bytes, triangles, textures: [{w,h}], clips, extensions }.
//
// Meshopt: se aplica reorder + compresión del propio EXT_meshopt_compression (método QUANTIZE) en vez de la función
// `meshopt()`, que antes cuantiza con KHR_mesh_quantization y mete una escala en los nodos: la convención del
// pack es escala aplicada a la malla y sin transformación en los nodos.
import { readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, prune, weld, simplify, textureCompress, reorder } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

export const TEX_POR_DEFECTO = 1024
export const TRIS_POR_DEFECTO = 30000

export function contarTriangulos(doc) {
  let n = 0
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices()
      n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3
    }
  return Math.round(n)
}

function tieneSkinning(doc) {
  return doc.getRoot().listSkins().length > 0
}

/** Optimiza `entrada` y escribe `salida`; devuelve la línea de informe. */
export async function optimizar(entrada, salida, { tex = TEX_POR_DEFECTO, tris = TRIS_POR_DEFECTO } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
  io.setLogger(new Logger(Logger.Verbosity.SILENT))   // la única salida es la línea JSON final
  const doc = await io.read(entrada)
  doc.setLogger(new Logger(Logger.Verbosity.SILENT))

  await doc.transform(dedup(), prune(), weld())
  const antes = contarTriangulos(doc)
  if (antes > tris && !tieneSkinning(doc)) {
    // El simplificador aproxima el ratio: se repite con un objetivo algo más bajo hasta cumplir (máx. 4 pasadas)
    let objetivo = tris / antes
    for (let i = 0; i < 4 && contarTriangulos(doc) > tris; i++) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: objetivo, error: 0.02 }))
      objetivo = (tris / contarTriangulos(doc)) * 0.98
    }
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 85 }),
    prune(),
    reorder({ encoder: MeshoptEncoder }),
  )
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })

  await io.write(salida, doc)

  const leido = await io.read(salida)
  const raiz = leido.getRoot()
  const textures = raiz.listTextures().map((t) => {
    const [w, h] = t.getSize() ?? [0, 0]
    return { w, h }
  })
  return {
    file: salida,
    bytes: statSync(salida).size,
    triangles: contarTriangulos(leido),
    textures,
    clips: raiz.listAnimations().map((a) => a.getName()),
    extensions: raiz.listExtensionsUsed().map((e) => e.extensionName),
  }
}

function argumentos(argv) {
  const pos = []
  const opt = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i]
    else pos.push(argv[i])
  }
  return { pos, opt }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos, opt } = argumentos(process.argv.slice(2))
  if (pos.length !== 2) {
    console.error('uso: node scripts/optimizar_glb.mjs <entrada.glb> <salida.glb> [--tex 1024] [--tris 30000]')
    process.exit(2)
  }
  const info = await optimizar(pos[0], pos[1], {
    tex: Number(opt.tex ?? TEX_POR_DEFECTO),
    tris: Number(opt.tris ?? TRIS_POR_DEFECTO),
  })
  console.log(JSON.stringify(info))
}
