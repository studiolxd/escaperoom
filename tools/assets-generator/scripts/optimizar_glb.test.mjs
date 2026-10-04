// node --test scripts/optimizar_glb.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { optimizar } from './optimizar_glb.mjs'

/** Cubo de 1 m con una textura PNG de 2048 px (degradado con ruido ligero, que pesa mucho en PNG). */
async function cuboConTextura() {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const h = 0.5
  const caras = [
    [[0, 0, 1], [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]]],
    [[0, 0, -1], [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]]],
    [[1, 0, 0], [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]]],
    [[-1, 0, 0], [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]]],
    [[0, 1, 0], [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]]],
    [[0, -1, 0], [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]]],
  ]
  const pos = [], nor = [], uv = [], idx = []
  caras.forEach(([n, vs], f) => {
    vs.forEach((v, i) => {
      pos.push(...v)
      nor.push(...n)
      uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0)
    })
    idx.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3)
  })
  const acc = (tipo, datos, T = Float32Array) => doc.createAccessor().setType(tipo).setArray(new T(datos)).setBuffer(buffer)
  const ruido = Buffer.alloc(2048 * 2048 * 3)
  for (let i = 0; i < ruido.length; i++) ruido[i] = ((i / 3) % 2048 >> 3) + ((i * 2654435761) >>> 29)
  const png = await sharp(ruido, { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer()
  const textura = doc.createTexture('color').setImage(new Uint8Array(png)).setMimeType('image/png')
  const material = doc.createMaterial('m').setBaseColorTexture(textura).setMetallicFactor(0).setRoughnessFactor(1)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', pos))
    .setAttribute('NORMAL', acc('VEC3', nor))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv))
    .setIndices(acc('SCALAR', idx, Uint16Array))
    .setMaterial(material)
  const malla = doc.createMesh('cubo').addPrimitive(prim)
  const nodo = doc.createNode('cubo').setMesh(malla)
  doc.createScene().addChild(nodo)
  return doc
}

test('optimizar_glb: pesa menos o igual, mantiene las mallas, declara meshopt y no mete escala en los nodos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glb-'))
  try {
    const entrada = join(dir, 'cubo.glb')
    const salida = join(dir, 'cubo-opt.glb')
    await new NodeIO().write(entrada, await cuboConTextura())

    const info = await optimizar(entrada, salida, { tex: 1024, tris: 30000 })

    assert.ok(statSync(salida).size <= statSync(entrada).size, 'la salida no puede pesar más que la entrada')
    assert.equal(info.bytes, statSync(salida).size)
    assert.ok(info.extensions.includes('EXT_meshopt_compression'))
    assert.equal(info.triangles, 12)
    assert.deepEqual(info.textures, [{ w: 1024, h: 1024 }])
    assert.deepEqual(info.clips, [])

    await MeshoptDecoder.ready
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    const original = await io.read(entrada)
    const optimizado = await io.read(salida)
    assert.equal(optimizado.getRoot().listMeshes().length, original.getRoot().listMeshes().length)
    const raiz = optimizado.getRoot()
    assert.ok(raiz.listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression'))
    for (const nodo of raiz.listNodes()) assert.deepEqual(nodo.getScale(), [1, 1, 1], 'sin escala en los nodos')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('optimizar_glb: simplifica por encima de --tris', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glb-'))
  try {
    // Esfera de ~5.000 triángulos con --tris 1000
    const doc = new Document()
    const buffer = doc.createBuffer()
    const N = 50
    const pos = [], idx = []
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        const t = (i / N) * Math.PI, p = (j / N) * 2 * Math.PI
        pos.push(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p))
      }
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const a = i * (N + 1) + j, b = a + N + 1
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
    doc.createScene().addChild(doc.createNode('esfera').setMesh(doc.createMesh('esfera').addPrimitive(prim)))
    const entrada = join(dir, 'esfera.glb')
    await new NodeIO().write(entrada, doc)
    const info = await optimizar(entrada, join(dir, 'esfera-opt.glb'), { tex: 1024, tris: 1000 })
    assert.ok(info.triangles <= 1000, `triángulos: ${info.triangles}`)
    assert.ok(info.triangles > 100)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
