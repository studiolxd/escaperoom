import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

const FONDO = '#0b1120'
const BASE = '/pack/'
const LADO = 8 // metros del suelo

// --- Escena, luz y cámara (material y luz del juego: specs/27 §7) ---
const escena = new THREE.Scene()
escena.background = new THREE.Color(FONDO)
escena.fog = new THREE.Fog(FONDO, 12, 30)

const sol = new THREE.DirectionalLight(0xffffff, 3)
sol.position.set(-0.7, 0.9, 0.5).multiplyScalar(10)
escena.add(sol)
escena.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 0.6))

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.prepend(renderer.domElement)

const camara = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100)
const controles = new OrbitControls(camara, renderer.domElement)
controles.minDistance = 2
controles.maxDistance = 8
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
      }),
    )
  }
  return toonDe.get(original)
}

let modoMaterial = 'toon'
const originales = new Map() // malla -> material del GLB (no en userData: clone() lo serializaría)
function aplicarMaterial() {
  for (const [m, original] of originales) m.material = modoMaterial === 'toon' ? materialToon(original) : original
}

// --- Carga ---
const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const estado = document.getElementById('estado')
const cargar = (ruta) =>
  cargador.loadAsync(BASE + ruta).catch((e) => {
    estado.textContent += `No se pudo cargar ${ruta}: ${e.message}\nGenera los modelos con: pnpm exportar-3d --muestra\n`
    throw e
  })

const [suelo, muro, arcaCerrada, arcaAbierta, brasAp, brasEn, caballero] = await Promise.all([
  cargar('models/suelo-piedra-1.glb'),
  cargar('models/muro.glb'),
  cargar('models/arca-cerrada.glb'),
  cargar('models/arca-abierta.glb'),
  cargar('models/brasero-apagado.glb'),
  cargar('models/brasero-encendido.glb'),
  cargar('avatars/caballero-m.glb'),
])

// Suelo de 8 × 8 m (la cara superior de cada losa queda en h = 0) y muro en dos lados (norte y oeste)
for (let x = 0; x < LADO; x++)
  for (let z = 0; z < LADO; z++) {
    const l = suelo.scene.clone(true)
    l.position.set(x + 0.5, 0, z + 0.5)
    escena.add(l)
  }
for (let i = -1; i < LADO; i++) {
  const n = muro.scene.clone(true)
  n.position.set(i + 0.5, 0, -0.5)
  escena.add(n)
  if (i >= 0) {
    const o = muro.scene.clone(true)
    o.position.set(-0.5, 0, i + 0.5)
    escena.add(o)
  }
}

// Pares de estados: se cambia el GLB mostrando uno y ocultando el otro
function par(a, b, x, z) {
  for (const g of [a, b]) {
    g.scene.position.set(x, 0, z)
    escena.add(g.scene)
  }
  return (primero) => {
    a.scene.visible = primero
    b.scene.visible = !primero
  }
}
const ponerArca = par(arcaCerrada, arcaAbierta, 5.5, 1.1)
const ponerBrasero = par(brasAp, brasEn, 1.8, 1.4)
ponerArca(true)
ponerBrasero(true)

// Caballero con sus tres clips (idle / walk / interact)
const pjPos = new THREE.Vector3(4, 0, 4.2)
caballero.scene.position.copy(pjPos)
escena.add(caballero.scene)
const mezclador = new THREE.AnimationMixer(caballero.scene)
const clips = Object.fromEntries(caballero.animations.map((c) => [c.name, mezclador.clipAction(c)]))
let activo = null
function ponerClip(nombre) {
  const siguiente = clips[nombre]
  if (!siguiente) return
  siguiente.reset().play()
  if (activo && activo !== siguiente) activo.crossFadeTo(siguiente, 0.15, false)
  activo = siguiente
}
ponerClip('idle')

// Todas las mallas (también las copias del suelo y el muro, que comparten material con el original)
escena.traverse((o) => {
  if (o.isMesh) originales.set(o, o.material)
})
aplicarMaterial()

// Cámara: objetivo a 1,2 m sobre el caballero
controles.target.copy(pjPos).add(new THREE.Vector3(0, 1.2, 0))
camara.position.copy(controles.target).add(new THREE.Vector3(3.2, 1.6, 5.2))
controles.update()

// Ejes y rejilla de 1 m
const ayudas = new THREE.Group()
ayudas.add(new THREE.GridHelper(LADO, LADO, 0xffffff, 0x64748b).translateX(LADO / 2).translateZ(LADO / 2))
ayudas.add(new THREE.AxesHelper(1.5))
ayudas.visible = false
escena.add(ayudas)

// --- Controles (HTML nativo: herramienta interna) ---
const $ = (id) => document.getElementById(id)
$('arca').onchange = (e) => ponerArca(e.target.value === 'cerrada')
$('brasero').onchange = (e) => ponerBrasero(e.target.value === 'apagado')
$('caballero').onchange = (e) => ponerClip(e.target.value)
$('material').onchange = (e) => {
  modoMaterial = e.target.value
  aplicarMaterial()
}
$('ayudas').onchange = (e) => (ayudas.visible = e.target.value === 'si')

// --- Informe (renders/glb/informe.json) ---
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
  .catch(() => ($('informe').textContent = 'Sin informe.json: ejecuta pnpm exportar-3d --muestra'))

const reloj = new THREE.Clock()
renderer.setAnimationLoop(() => {
  mezclador.update(reloj.getDelta())
  controles.update()
  renderer.render(escena, camara)
})
