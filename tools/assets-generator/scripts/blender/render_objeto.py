"""
Render isométrico de un objeto de suelo en una sala neutra y como sprites, para cualquier pack.

Uso (desde assets-generator/):
    PACK=medieval-v1 OBJ=arca /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/render_objeto.py [-- <salida>]

Salida por defecto: packs/<pack>/renders/<OBJ> (o la "salida" del objeto en objetos.json).
Configuración de cada objeto en packs/<pack>/objetos.json ("render": GLB de fuentes/, escala, encuadre, estados,
orientaciones y medidas propias); su constructor, en packs/<pack>/blender/objetos.py (separa las piezas móviles
del modelo de Tripo, les pone bisagra y construye el interior: el modelo es una cáscara y abierto se vería hueco).
Estados activos ("abierto", "encendido"...: se abren bisagras y se ven las piezas SOLO_ACTIVO) en
"estados_activos" de objetos.json.
Orientaciones: "abajo-izq" (junto al muro de la fila y=0, mirando a la sala) y "abajo-der" (junto al muro de la
columna x=0). Cámara 2:1 y luz del estilo del pack; sin sombra en los sprites. En todos los GLB el frente mira a +X.
"""

import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402  (prepara sys.path)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import contexto  # noqa: E402
from geometria import box, material  # noqa: E402

PACK = contexto.cargar()
EST = PACK.estilo
CELL = EST["celda_m"]
CONF = PACK.json("objetos.json")
NAME = os.environ.get("OBJ", "")
if NAME not in CONF["render"]:
    sys.exit(f"OBJ={NAME!r} no está en packs/{PACK.id}/objetos.json; objetos: {', '.join(CONF['render'])}")
CFG = dict(CONF["render"][NAME])
for k in ("glb", "imagen"):
    if CFG.get(k):
        CFG[k] = PACK.fuentes / CFG[k]
ACTIVOS = set(CONF["estados_activos"])
OUT = Path(iso.args()[-1]) if iso.args() else PACK.renders / CFG.get("salida", NAME)
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
obj = PACK.modulo("objetos")      # tras reiniciar la escena: el módulo guarda bpy.context.scene
obj.CFG = CFG

# --- Sala neutra del estilo ---
SALA = EST["sala"]
H, G = SALA["alto_muro_m"], SALA["grosor_muro_m"]
COLS = ROWS = 5
x0 = -COLS * CELL / 2
y_top = ROWS * CELL / 2
room = []
sa, sb, wm = material("losa_a", tuple(SALA["losas"][0])), material("losa_b", tuple(SALA["losas"][1])), material("muro", tuple(SALA["muro"]))
for gx in range(COLS):
    for gy in range(ROWS):
        room.append(box(f"losa_{gx}_{gy}", (CELL * 0.98, CELL * 0.98, 0.05),
                        (x0 + (gx + 0.5) * CELL, y_top - (gy + 0.5) * CELL, -0.025), sa if (gx + gy) % 2 else sb))
room.append(box("muro_y0", (COLS * CELL + G, G, H), (0, y_top + G / 2, H / 2), wm))
room.append(box("muro_x0", (G, ROWS * CELL, H), (x0 - G / 2, 0, H / 2), wm))

# --- Personaje de referencia (escala), idle fotograma 1 (si el pack tiene "referencia_escala") ---
knight = []
if PACK["referencia_escala"]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(PACK.fuentes / PACK["referencia_escala"]))
    knight = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in knight if o.type == "ARMATURE")
    scene.frame_set(1)
    arm.animation_data.action = None
    arm.location = (x0 + 1.4 * CELL, y_top - 2.2 * CELL, 0)
    room += knight

# --- Objeto ---
if CFG.get("glb"):
    bpy.ops.import_scene.gltf(filepath=str(CFG["glb"]))
    mesh = next(o for o in bpy.context.selected_objects if o.type == "MESH" and o not in knight)
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
    for o in list(bpy.data.objects):
        if o.type == "EMPTY" and o is not mesh and o not in knight:
            bpy.data.objects.remove(o)
else:   # objeto procedural (en metros): marcador de un vértice en el suelo
    me = bpy.data.meshes.new("marcador")
    me.from_pydata([(0, 0, 0)], [], [])
    mesh = bpy.data.objects.new("marcador", me)
    scene.collection.objects.link(mesh)

fijas, bisagras = obj.CONSTRUCTORES[NAME](mesh)

root = bpy.data.objects.new(NAME, None)
scene.collection.objects.link(root)
for o in [mesh, *fijas, *(h for h, _, _ in bisagras)]:
    o.parent = root
if CFG["escala"]:
    eje, medida = CFG["escala"]
    i = "xyz".index(eje)
    co = [v.co[i] for v in mesh.data.vertices]
    s = medida / (max(co) - min(co))
else:
    s = 1.0
root.scale = (s, s, s)
zmin = min(v.co.z for v in mesh.data.vertices)
root.location.z = -zmin * s

# --- Cámara y luz del estilo ---
cam, cam_d, fwd = iso.camara(scene, EST, clip_end=200)
iso.sol(scene, EST, cam, fwd)
iso.fondo_plano(scene, EST)
scene.render.engine = "BLENDER_EEVEE"
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"

# frente +X del GLB → mirar a la sala: junto al muro y=0 mira a −Y; junto al muro x=0 mira a +X
ORIENT = {"abajo-izq": (-90, (x0 + 2.5 * CELL, y_top - 0.75 * CELL)),
          "abajo-der": (0, (x0 + 0.75 * CELL, y_top - 2.5 * CELL))}


def pose(state, orient):
    activo = state in ACTIVOS
    for h, ax, ang in bisagras:
        r = [0, 0, 0]
        r["XYZ".index(ax)] = math.radians(ang) if activo else 0
        h.rotation_euler = r
    for o in obj.SOLO_ACTIVO:
        o.hide_render = not activo
    for o in obj.SOLO_REPOSO:
        o.hide_render = activo
    for o, d, giro in obj.MOVIMIENTOS:
        o.location = d if activo else Vector((0, 0, 0))
        o.rotation_euler = [math.radians(g) if activo else 0 for g in giro]
    deg, (px, py) = ORIENT[orient]
    root.rotation_euler = (0, 0, math.radians(deg))
    root.location.x, root.location.y = px, py


def render(path, res, ortho, target):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam_d.ortho_scale = ortho
    cam.location = Vector(target) - fwd * 40
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


# 1) En la sala
for state in CFG["frames"]:
    pose(state, "abajo-izq")
    render(OUT / f"sala_{NAME}_{state}.png", (1400, 1000), 5.5, (0, 0.3, 0.6))

# 2) Sprites sueltos (encuadre fijo común a estados y orientaciones)
for o in room:
    o.hide_render = True
ortho, zc = CFG["encuadre"]
res = EST["objetos"]["res"]
for orient in CFG.get("orientaciones", list(ORIENT)):
    for state, frame in CFG["frames"].items():
        pose(state, orient)
        root.location.x, root.location.y = 0, 0
        render(OUT / f"sprite_{frame}_{orient}.png", (res, res), ortho, (0, 0, zc))
print("OK objeto", NAME)
