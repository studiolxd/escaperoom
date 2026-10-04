import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

const FONDO = '#0b1120'
const BASE = '/pack/'
const LADO = 8 // metros del suelo de la escena de muestra
const CATEGORIAS = ['suelo', 'muro', 'estructura', 'mueble', 'pared', 'suelto']

// --- Escena, luz y cámara (material y luz del juego: specs/27 §7) ---
const escena = new THREE.Scene()
escena.background = new THREE.Color(FONDO)

const sol = new THREE.DirectionalLight(0xffffff, 3)
sol.position.set(-0.7, 0.9, 0.5).multiplyScalar(10)
escena.add(sol)
escena.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 0.6))

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.prepend(renderer.domElement)

const camara = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 100)
const controles = new OrbitControls(camara, renderer.domElement)
controles.enableDamping = true

addEventListener('resize', () => {
  camara.aspect = innerWidth / innerHeight
  camara.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// --- Material toon con degradado de 3 bandas ---
const degradado = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat)
degradado.minFilter = degradado.magFilter = THREE.NearestFilter
degradado.needsUpdate = true

const toonDe = new Map()
function materialToon(original) {
  if (!toonDe.has(original)) {
    toonDe.set(
      original,
      new THREE.MeshToonMaterial({
        map: original.map,
        color: original.color,
        emissive: original.emissive,
        emissiveMap: original.emissiveMap,
        gradientMap: degradado,
        transparent: original.transparent,
        alphaTest: original.alphaTest,
        side: original.side,
      }),
    )
  }
  return toonDe.get(original)
}

let modoMaterial = 'toon'
const originales = new Map() // malla -> material del GLB (no en userData: clone() lo serializaría)
function registrarMallas(raiz) {
  raiz.traverse((o) => {
    if (o.isMesh && !originales.has(o)) originales.set(o, o.material)
  })
}
function aplicarMaterial() {
  for (const [m, original] of originales) m.material = modoMaterial === 'toon' ? materialToon(original) : original
}

// --- Carga ---
const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const estado = document.getElementById('estado')
const $ = (id) => document.getElementById(id)
const cache = new Map()
function cargar(ruta) {
  if (!cache.has(ruta))
    cache.set(
      ruta,
      cargador.loadAsync(BASE + ruta).catch((e) => {
        cache.delete(ruta)
        estado.textContent += `No se pudo cargar ${ruta}: ${e.message}\nGenera los modelos con: pnpm exportar-3d --todo\n`
        throw e
      }),
    )
  return cache.get(ruta)
}

// El caballero es el mismo en los dos modos (una sola instancia, con sus tres clips idle / walk / interact)
let caballero = null
let mezclador = null
let activo = null
const clips = {}
async function cargarCaballero() {
  if (!caballero) {
    caballero = await cargar('avatars/caballero-m.glb')
    mezclador = new THREE.AnimationMixer(caballero.scene)
    for (const c of caballero.animations) clips[c.name] = mezclador.clipAction(c)
    registrarMallas(caballero.scene)
    ponerClip('idle')
    aplicarMaterial()
  }
  return caballero
}
function ponerClip(nombre) {
  const siguiente = clips[nombre]
  if (!siguiente) return
  siguiente.reset().play()
  if (activo && activo !== siguiente) activo.crossFadeTo(siguiente, 0.15, false)
  activo = siguiente
}

// ===================================================================================================================
// Modo galería: un modelo del catálogo solo, sobre una rejilla de 1 m
// ===================================================================================================================
const galeria = new THREE.Group()
const rejilla = new THREE.GridHelper(20, 20, 0x94a3b8, 0x475569)
rejilla.position.y = 0.002
galeria.add(rejilla)
let actual = new THREE.Group() // modelo mostrado + flecha del frente + colisionador
galeria.add(actual)
const colisionador = new THREE.Group()
const COLOR_COLISION = 0x4ade80
const materialLinea = new THREE.LineBasicMaterial({ color: COLOR_COLISION, depthTest: false })

let catalogo = null
let informe = new Map()
let orden = [] // ids del catálogo, por categoría y alfabéticamente
let indice = 0

/** Alambre de un colisionador (coordenadas lógicas: cx, cy = X y Z del GLB; ch = Y). */
function dibujarColisionador(c) {
  if (c.type === 'box') {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(c.sx, c.sh, c.sy)), materialLinea)
    l.position.set(c.cx, c.ch, c.cy)
    return l
  }
  // cuña transitable: la cara superior sube de h0 a h1 avanzando en `dir` (y+ = +Z del GLB)
  const [hx, hz] = [c.sx / 2, c.sy / 2]
  const alto = (x, z) => {
    const t = { 'x+': (x + hx) / c.sx, 'x-': (hx - x) / c.sx, 'y+': (z + hz) / c.sy, 'y-': (hz - z) / c.sy }[c.dir]
    return c.h0 + (c.h1 - c.h0) * t
  }
  const base = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]
  const p = []
  base.forEach(([x, z], i) => {
    const [x2, z2] = base[(i + 1) % 4]
    p.push(x, 0, z, x2, 0, z2, x, alto(x, z), z, x2, alto(x2, z2), z2, x, 0, z, x, alto(x, z), z)
  })
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  const l = new THREE.LineSegments(g, materialLinea)
  l.position.set(c.cx, 0, c.cy)
  return l
}

function describirColisionador(c) {
  if (c.type === 'box') return `caja ${c.sx}×${c.sy}×${c.sh} en (${c.cx}, ${c.cy}, h ${c.ch})`
  return `cuña ${c.sx}×${c.sy} de ${c.h0} a ${c.h1} hacia ${c.dir} en (${c.cx}, ${c.cy})`
}

function mostrarDatos(id, m, malla) {
  const fichero = m.file.replace(/^models\//, '').replace(/\.glb$/, '')
  const inf = informe.get(fichero)
  let tris = inf?.triangles
  if (tris === undefined && malla) {
    tris = 0
    malla.traverse((o) => {
      if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3
    })
  }
  const kb = (b) => `${(b / 1024).toFixed(0)} KB`
  const filas = [
    ['modelo', id + (fichero !== id ? ` (= ${fichero})` : '')],
    ['categoría', `${m.category}${m.group ? ` · grupo ${m.group}` : ''}${m.snap ? ' · kit (snap)' : ''}`],
    ['medidas', `${m.size.w} × ${m.size.d} × ${m.size.hgt} m (x, z, y)`],
    ['triángulos', tris === undefined ? '–' : String(Math.round(tris))],
    ['peso', inf ? kb(inf.bytes) : '–'],
    ['texturas', inf ? inf.textures.map((t) => `${t.w}×${t.h}`).join(', ') || '–' : '–'],
    ['clips', m.clips.join(', ') || '–'],
    ['colisión', m.colliders.length ? m.colliders.map(describirColisionador).join('<br>') : 'ninguna (no bloquea)'],
  ]
  if (inf?.fuera_de_presupuesto?.length) filas.push(['presupuesto', inf.fuera_de_presupuesto.join(', ')])
  $('datos').innerHTML = filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')
}

let pedido = 0 // descarta las cargas que llegan tarde si se cambia de modelo deprisa
async function mostrarModelo(i) {
  indice = (i + orden.length) % orden.length
  const id = orden[indice]
  const m = catalogo.models[id]
  $('modelo').value = id
  history.replaceState(null, '', `#${id}`)
  const mio = ++pedido
  estado.textContent = ''
  let glb = null
  try {
    glb = await cargar(m.file)
  } catch {
    // sin GLB: se pinta la caja de medidas del catálogo
  }
  if (mio !== pedido) return
  galeria.remove(actual)
  actual = new THREE.Group()
  galeria.add(actual)
  let modelo
  if (glb) {
    modelo = glb.scene.clone(true)
    registrarMallas(modelo)
    aplicarMaterial()
  } else {
    modelo = new THREE.Mesh(new THREE.BoxGeometry(m.size.w, m.size.hgt, m.size.d), new THREE.MeshBasicMaterial({ color: 0x64748b, wireframe: true }))
    modelo.position.y = m.size.hgt / 2
  }
  actual.add(modelo)
  // frente (+Z): una flecha amarilla delante de la pieza, a ras de suelo
  const frente = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.02, m.size.d / 2 + 0.1), 0.6, 0xfacc15, 0.18, 0.12)
  actual.add(frente)
  // colisionador en alambre
  colisionador.clear()
  for (const c of m.colliders) colisionador.add(dibujarColisionador(c))
  actual.add(colisionador)
  colisionador.visible = $('colision').value === 'si'
  // caballero de referencia, al lado (a la derecha de la pieza)
  const pj = await cargarCaballero().catch(() => null)
  if (mio !== pedido) return
  if (pj) {
    galeria.add(pj.scene)
    pj.scene.position.set(m.size.w / 2 + 0.8, 0, 0)
    pj.scene.visible = $('referencia').value === 'si'
  }
  mostrarDatos(id, m, glb?.scene)
  encuadrar(m)
}

function encuadrar(m) {
  const grande = Math.max(m.size.w, m.size.d, m.size.hgt, 1.8)
  controles.minDistance = 0.2
  controles.maxDistance = 40
  controles.target.set(m.size.w / 2 * 0.3, Math.max(m.size.hgt, 1.2) / 2, 0)
  camara.position.set(grande * 0.9 + m.size.w / 2, grande * 0.7, grande * 1.6)
  controles.update()
}

function llenarSelector() {
  const sel = $('modelo')
  sel.innerHTML = ''
  orden = []
  for (const cat of CATEGORIAS) {
    const ids = Object.keys(catalogo.models)
      .filter((id) => catalogo.models[id].category === cat)
      .sort()
    if (!ids.length) continue
    const grupo = document.createElement('optgroup')
    grupo.label = `${cat} (${ids.length})`
    for (const id of ids) {
      grupo.append(new Option(`${id} — ${catalogo.models[id].label.es.text}`, id))
      orden.push(id)
    }
    sel.append(grupo)
  }
}

async function iniciarGaleria() {
  const [cat, inf] = await Promise.all([
    fetch('/catalogo.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('sin catálogo')))),
    fetch('/informe.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ])
  catalogo = cat
  informe = new Map(inf.map((f) => [f.id, f]))
  llenarSelector()
  const deHash = location.hash.slice(1)
  await mostrarModelo(orden.includes(deHash) ? orden.indexOf(deHash) : 0)
}

$('modelo').onchange = (e) => mostrarModelo(orden.indexOf(e.target.value))
$('anterior').onclick = () => mostrarModelo(indice - 1)
$('siguiente').onclick = () => mostrarModelo(indice + 1)
$('referencia').onchange = (e) => caballero && (caballero.scene.visible = e.target.value === 'si')
$('colision').onchange = (e) => (colisionador.visible = e.target.value === 'si')
addEventListener('keydown', (e) => {
  if (modo !== 'galeria' || e.target.tagName === 'SELECT') return
  if (e.key === 'ArrowLeft') mostrarModelo(indice - 1)
  if (e.key === 'ArrowRight') mostrarModelo(indice + 1)
})

// ===================================================================================================================
// Modo escena de muestra (encargo 7.3): suelo de 8 × 8 m, muro en dos lados, arca, brasero y caballero
// ===================================================================================================================
const muestra = new THREE.Group()
let ponerArca = null
let ponerBrasero = null
let ayudas = null
const pjPos = new THREE.Vector3(4, 0, 4.2)

async function montarMuestra() {
  const [suelo, muro, arcaCerrada, arcaAbierta, brasAp, brasEn, pj] = await Promise.all([
    cargar('models/suelo-piedra-1.glb'),
    cargar('models/muro.glb'),
    cargar('models/arca-cerrada.glb'),
    cargar('models/arca-abierta.glb'),
    cargar('models/brasero-apagado.glb'),
    cargar('models/brasero-encendido.glb'),
    cargarCaballero(),
  ])
  // Suelo de 8 × 8 m (la cara superior de cada losa queda en h = 0) y muro en dos lados (norte y oeste)
  for (let x = 0; x < LADO; x++)
    for (let z = 0; z < LADO; z++) {
      const l = suelo.scene.clone(true)
      l.position.set(x + 0.5, 0, z + 0.5)
      muestra.add(l)
    }
  for (let i = -1; i < LADO; i++) {
    const n = muro.scene.clone(true)
    n.position.set(i + 0.5, 0, -0.5)
    muestra.add(n)
    if (i >= 0) {
      const o = muro.scene.clone(true)
      o.position.set(-0.5, 0, i + 0.5)
      muestra.add(o)
    }
  }
  // Pares de estados: se cambia el GLB mostrando uno y ocultando el otro
  const par = (a, b, x, z) => {
    // copias: las escenas originales están en caché y las clona también la galería
    const [ca, cb] = [a.scene.clone(true), b.scene.clone(true)]
    for (const g of [ca, cb]) {
      g.position.set(x, 0, z)
      muestra.add(g)
    }
    return (primero) => {
      ca.visible = primero
      cb.visible = !primero
    }
  }
  ponerArca = par(arcaCerrada, arcaAbierta, 5.5, 1.1)
  ponerBrasero = par(brasAp, brasEn, 1.8, 1.4)
  ponerArca(true)
  ponerBrasero(true)
  registrarMallas(muestra)
  aplicarMaterial()
  ayudas = new THREE.Group()
  ayudas.add(new THREE.GridHelper(LADO, LADO, 0xffffff, 0x64748b).translateX(LADO / 2).translateZ(LADO / 2))
  ayudas.add(new THREE.AxesHelper(1.5))
  ayudas.visible = $('ayudas').value === 'si'
  muestra.add(ayudas)
  return pj
}

let muestraLista = null
$('arca').onchange = (e) => ponerArca?.(e.target.value === 'cerrada')
$('brasero').onchange = (e) => ponerBrasero?.(e.target.value === 'apagado')
$('caballero').onchange = (e) => ponerClip(e.target.value)
$('ayudas').onchange = (e) => ayudas && (ayudas.visible = e.target.value === 'si')

// --- Informe (renders/glb/informe.json), solo en la escena de muestra ---
fetch('/informe.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error('sin informe.json'))))
  .then((filas) => {
    const kb = (b) => `${(b / 1024).toFixed(0)} KB`
    $('informe').innerHTML =
      '<table><tr><th>modelo</th><th>peso</th><th>tris</th><th>texturas</th><th>clips</th></tr>' +
      filas
        .map(
          (f) =>
            `<tr class="${f.fuera_de_presupuesto?.length ? 'mal' : ''}"><td>${f.id}</td><td>${kb(f.bytes)}</td><td>${f.triangles}</td>` +
            `<td>${f.textures.map((t) => `${t.w}×${t.h}`).join(', ')}</td><td>${f.clips.join(', ') || '–'}</td></tr>`,
        )
        .join('') +
      '</table>'
  })
  .catch(() => ($('informe').textContent = 'Sin informe.json: ejecuta pnpm exportar-3d --todo'))

// ===================================================================================================================
// Modos
// ===================================================================================================================
let modo = null
async function cambiarModo(nuevo) {
  modo = nuevo
  $('galeria').style.display = nuevo === 'galeria' ? '' : 'none'
  $('muestra').style.display = nuevo === 'muestra' ? '' : 'none'
  $('informe').style.display = nuevo === 'muestra' ? '' : 'none'
  escena.remove(galeria, muestra)
  estado.textContent = ''
  if (nuevo === 'galeria') {
    escena.fog = null
    escena.add(galeria)
    if (!catalogo) await iniciarGaleria().catch((e) => (estado.textContent = `No se pudo abrir la galería: ${e.message}`))
    else await mostrarModelo(indice)
  } else {
    escena.fog = new THREE.Fog(FONDO, 12, 30)
    escena.add(muestra)
    muestraLista ??= montarMuestra()
    const pj = await muestraLista.catch(() => null)
    if (modo !== 'muestra' || !pj) return
    muestra.add(pj.scene)
    pj.scene.visible = true
    pj.scene.position.copy(pjPos)
    controles.minDistance = 2
    controles.maxDistance = 8
    controles.target.copy(pjPos).add(new THREE.Vector3(0, 1.2, 0))
    camara.position.copy(controles.target).add(new THREE.Vector3(3.2, 1.6, 5.2))
    controles.update()
  }
}
$('modo').onchange = (e) => cambiarModo(e.target.value)
$('material').onchange = (e) => {
  modoMaterial = e.target.value
  aplicarMaterial()
}

const reloj = new THREE.Clock()
renderer.setAnimationLoop(() => {
  mezclador?.update(reloj.getDelta())
  controles.update()
  renderer.render(escena, camara)
})

cambiarModo('galeria')
