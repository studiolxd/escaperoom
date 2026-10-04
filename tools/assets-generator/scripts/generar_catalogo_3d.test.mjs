// node --test scripts/generar_catalogo_3d.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { generar } from './generar_catalogo_3d.mjs'

/** GLB mínimo: una caja entre `min` y `max` (dos triángulos bastan para la envolvente), con clips opcionales. */
async function glb(ruta, min, max, clips = []) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const pos = new Float32Array([...min, ...max, min[0], max[1], min[2]])
  const acc = doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer)
  const prim = doc.createPrimitive().setAttribute('POSITION', acc)
  const nodo = doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim))
  doc.createScene().addChild(nodo)
  for (const c of clips) doc.createAnimation(c)
  await new NodeIO().write(ruta, doc)
}

const caja = { type: 'box', cx: 0, cy: 0, ch: 0.5, sx: 1, sy: 1, sh: 1 }

async function entorno() {
  const dir = mkdtempSync(join(tmpdir(), 'catalogo-'))
  mkdirSync(join(dir, 'models'))
  // arca: 0,9333 × 0,81 × 0,8 con el centro desplazado; muro: 1 × 1 × 2,4 de kit con colisionador propio;
  // columna: 0,62 de planta pero de kit (ocupa una celda); cuadro: grosor 0 (tela)
  await glb(join(dir, 'models', 'arca.glb'), [-0.5, 0, -0.30004], [0.43333, 0.8, 0.50996], ['abrir'])
  await glb(join(dir, 'models', 'muro.glb'), [-0.5, 0, -0.5], [0.5, 2.4, 0.5])
  await glb(join(dir, 'models', 'columna.glb'), [-0.31, 0, -0.31], [0.31, 2.4, 0.31])
  await glb(join(dir, 'models', 'tela.glb'), [-0.4, 0.5, 0], [0.4, 1.5, 0])
  const config = {
    _: 'prueba',
    modelos: {
      arca: { category: 'mueble', group: 'arca', label: { es: 'Arca', en: 'Chest' } },
      muro: { category: 'muro', label: { es: 'Muro', en: 'Wall' }, snap: true, colliders: [caja] },
      columna: { category: 'estructura', label: { es: 'Columna', en: 'Column' }, snap: true },
      tela: { category: 'pared', label: { es: 'Tela', en: 'Cloth' }, colliders: [] },
      sin_glb: { category: 'suelto', label: { es: 'Sin GLB', en: 'No GLB' }, size: { w: 0.2, d: 0.3, hgt: 0.1 }, centro: { cx: 0.01, cy: 0, ch: 0.05 } },
    },
    alias: { 'arca-vieja': 'arca' },
    sprites2d: { arca: { model: 'arca', yaw: 0 } },
    sinModelo: ['oculto'],
  }
  writeFileSync(join(dir, 'modelos3d.json'), JSON.stringify(config))
  writeFileSync(join(dir, 'catalogo.json'), JSON.stringify({ packId: 'prueba', version: '0.0.1', models: {}, avatars: { heroe: { file: 'avatars/h.glb', label: { es: { text: 'H' } }, height: 1.7, clips: { idle: 'i', walk: 'w', interact: 'x' } } } }))
  return { dir, opciones: { pack: 'prueba', config: join(dir, 'modelos3d.json'), modelos: join(dir, 'models'), salida: join(dir, 'catalogo.json') } }
}

test('generar: medidas, colisionador por defecto y declarado, alias, redondeo, orden y avatares', async () => {
  const { dir, opciones } = await entorno()
  try {
    const r = await generar(opciones)
    const c = JSON.parse(r.catalogo)
    assert.deepEqual(Object.keys(c), ['packId', 'version', 'models', 'avatars'])
    assert.equal(c.packId, 'prueba')
    assert.equal(c.version, '1.0.0')
    // claves de los modelos ordenadas (alias incluidos)
    assert.deepEqual(Object.keys(c.models), ['arca', 'arca-vieja', 'columna', 'muro', 'sin_glb', 'tela'].sort())
    // medidas: w = X, d = Z, hgt = Y, redondeadas a 3 decimales; colisionador por defecto = envolvente (cx, cy = X y Z; ch = Y)
    assert.deepEqual(c.models.arca.size, { d: 0.81, hgt: 0.8, w: 0.933 })
    assert.deepEqual(c.models.arca.colliders, [{ ch: 0.4, cx: -0.033, cy: 0.105, sh: 0.8, sx: 0.933, sy: 0.81, type: 'box' }])
    assert.deepEqual(c.models.arca.clips, ['abrir'])
    assert.equal(c.models.arca.file, 'models/arca.glb')
    assert.equal(c.models.arca.group, 'arca')
    assert.deepEqual(c.models.arca.label, { en: { text: 'Chest' }, es: { text: 'Arca' } })
    assert.equal(c.models.arca.snap, false)
    // colisionador declarado: se copia tal cual; [] = no bloquea
    assert.deepEqual(c.models.muro.colliders, [{ ch: 0.5, cx: 0, cy: 0, sh: 1, sx: 1, sy: 1, type: 'box' }])
    assert.deepEqual(c.models.tela.colliders, [])
    // las piezas de kit ocupan celdas enteras; el grosor 0 mide 0,001
    assert.equal(c.models.muro.snap, true)
    assert.deepEqual(c.models.columna.size, { d: 1, hgt: 2.4, w: 1 })
    assert.deepEqual(c.models.tela.size, { d: 0.001, hgt: 1, w: 0.8 })
    // sin GLB: el size y el centro declarados
    assert.deepEqual(c.models.sin_glb.size, { d: 0.3, hgt: 0.1, w: 0.2 })
    assert.deepEqual(c.models.sin_glb.colliders, [{ ch: 0.05, cx: 0.01, cy: 0, sh: 0.1, sx: 0.2, sy: 0.3, type: 'box' }])
    // alias: entrada propia con el mismo fichero y metadatos
    assert.deepEqual(c.models['arca-vieja'], c.models.arca)
    // avatars: tal cual estaban
    assert.deepEqual(Object.keys(c.avatars), ['heroe'])
    assert.equal(c.avatars.heroe.height, 1.7)
    // lo escrito es lo devuelto, y es determinista
    assert.equal(readFileSync(opciones.salida, 'utf8'), r.catalogo)
    assert.equal((await generar(opciones)).catalogo, r.catalogo)
    // el size medido se escribe de vuelta en modelos3d.json (con el centro de la envolvente)
    const cfg = JSON.parse(readFileSync(opciones.config, 'utf8'))
    assert.deepEqual(cfg.modelos.arca.size, { w: 0.933, d: 0.81, hgt: 0.8 })
    assert.deepEqual(cfg.modelos.arca.centro, { cx: -0.033, cy: 0.105, ch: 0.4 })
    assert.deepEqual(cfg.modelos.arca.clips, ['abrir'])
    assert.equal('clips' in cfg.modelos.muro, false)
    assert.deepEqual(cfg.modelos.columna.size, { w: 0.62, d: 0.62, hgt: 2.4 })
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('--check: pasa al día, también sin binarios, y falla si se altera el catálogo versionado', async () => {
  const { dir, opciones } = await entorno()
  try {
    await generar(opciones)
    assert.deepEqual((await generar({ ...opciones, check: true })).problemas, [])
    // en un clon sin GLB, el size escrito de vuelta basta
    const sinBinarios = { ...opciones, modelos: join(dir, 'no-hay') }
    assert.deepEqual((await generar({ ...sinBinarios, check: true })).problemas, [])
    // se altera el fichero versionado
    const c = JSON.parse(readFileSync(opciones.salida, 'utf8'))
    c.models.arca.size.w = 2
    writeFileSync(opciones.salida, JSON.stringify(c, null, 2) + '\n')
    assert.equal((await generar({ ...opciones, check: true })).problemas.length > 0, true)
    assert.equal((await generar({ ...sinBinarios, check: true })).problemas.length > 0, true)
    // --check no modifica nada
    assert.equal(JSON.parse(readFileSync(opciones.salida, 'utf8')).models.arca.size.w, 2)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('generar: falla si falta el GLB y no hay size, o si un alias apunta a un modelo que no existe', async () => {
  const { dir, opciones } = await entorno()
  try {
    const cfg = JSON.parse(readFileSync(opciones.config, 'utf8'))
    delete cfg.modelos.sin_glb.size
    writeFileSync(opciones.config, JSON.stringify(cfg))
    await assert.rejects(generar(opciones), /sin_glb.*size/)
    cfg.modelos.sin_glb.size = { w: 1, d: 1, hgt: 1 }
    cfg.alias = { fantasma: 'no-existe' }
    writeFileSync(opciones.config, JSON.stringify(cfg))
    await assert.rejects(generar(opciones), /no-existe/)
  } finally {
    rmSync(dir, { recursive: true })
  }
})
