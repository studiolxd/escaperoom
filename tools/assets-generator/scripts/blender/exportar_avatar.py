"""
Exporta un personaje jugable del pack (Mixamo) a un GLB con esqueleto y tres animaciones, sin optimizar.

Uso (desde assets-generator/):
    PACK=medieval-v1 PERSONAJE=caballero-m /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/exportar_avatar.py [-- <salida>]

Salida por defecto: packs/<pack>/renders/glb/<PERSONAJE>.glb. Entrada: fuentes/personajes/<id>/mixamo/<anim>.fbx.
- Malla, esqueleto y acción de idle.fbx; de los demás FBX (andar, alcanzar) solo se toma la acción (se borran sus mallas
  y esqueletos). Las acciones se renombran con pack.json → avatar.acciones (idle, walk, interact) y quedan como pistas
  NLA, que el exportador saca como tres animaciones.
- walk en el sitio: se resta la deriva lineal del desplazamiento de la cadera en el plano (queda el balanceo).
- Altura = estilo.json → personajes.altura_ref_m, pies en h = 0, frente a +Z del GLB (los FBX de Mixamo de este pack
  miran a −Y de Blender = +Z de glTF: no hace falta girar; se comprueba por la posición de la puntera).
- Reduce a ≤ MAX_TRIS triángulos con Decimate (antes del esqueleto, conservando pesos y UV).
"""
import json
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402  (prepara sys.path)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import contexto  # noqa: E402
import glb_comun as g  # noqa: E402

PACK = contexto.cargar()
PID = os.environ.get("PERSONAJE", "")
SRC = PACK.fuentes / "personajes" / PID / "mixamo"
if not (SRC / "idle.fbx").exists():
    sys.exit(f"PERSONAJE={PID!r}: no existe {SRC / 'idle.fbx'}")
OUT = Path(iso.args()[-1]) if iso.args() else PACK.renders / "glb"
ALTURA = PACK.estilo["personajes"]["altura_ref_m"]
MAX_TRIS = 40000
OBJETIVO_TRIS = 38000          # margen bajo el máximo: Decimate no clava el ratio
ACCIONES = PACK["avatar"]["acciones"]     # FBX -> [acción del runtime, fps]
t0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30                      # fps de los FBX de Mixamo


def importar(nombre):
    antes, antes_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=str(SRC / f"{nombre}.fbx"))
    return [o for o in bpy.data.objects if o not in antes], [a for a in bpy.data.actions if a not in antes_a]


def fcurves(accion):
    return [fc for layer in accion.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]


# 1) Malla, esqueleto y acción de idle
nuevos, acciones = importar("idle")
arm = next(o for o in nuevos if o.type == "ARMATURE")
mesh = next(o for o in nuevos if o.type == "MESH")
acc = {"idle": acciones[0]}

# 2) Solo las acciones de los demás FBX
for fbx in ACCIONES:
    if fbx == "idle":
        continue
    objs, acts = importar(fbx)
    acc[fbx] = acts[0]
    for o in objs:
        bpy.data.objects.remove(o)

# 3) Mallas a espacio mundo y rotación del esqueleto aplicada (Mixamo trae el armature girado 90° en X y la malla −90°)
bpy.context.view_layer.update()
pre_mano = None


def mano_mundo(accion, frame):
    arm.animation_data.action = accion
    arm.animation_data.action_slot = accion.slots[0]
    scene.frame_set(frame)
    return arm.matrix_world @ arm.pose.bones["mixamorig:RightHand"].head


ref_antes = {k: mano_mundo(a, 20) for k, a in acc.items()}
# Altura y suelo se miden con la pose del primer fotograma de idle (la de referencia del 2D), no con la pose de reposo
mano_mundo(acc["idle"], 1)
dg = bpy.context.evaluated_depsgraph_get()
ev = mesh.evaluated_get(dg).to_mesh()
zs = [(mesh.matrix_world @ v.co).z for v in ev.vertices]
zmin, zmax = min(zs), max(zs)
arm.animation_data.action = None
mesh.parent = None
mesh.matrix_world = mesh.matrix_world.copy()          # conserva la transformación mundo al soltar el padre
bpy.context.view_layer.update()


def aplicar(objs, **kw):
    for s in bpy.context.selected_objects:
        s.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(**kw)


aplicar([mesh], location=True, rotation=True, scale=True)
aplicar([arm], location=True, rotation=True, scale=True)

# 4) Altura, suelo y escala (Mixamo ya viene a ~1,75 m; se ajusta exacto con la pose de idle medida arriba)
s = ALTURA / (zmax - zmin)
mesh.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation((0, 0, -zmin)))
arm.location = (0, 0, -zmin * s)
arm.scale = (s, s, s)
aplicar([arm], location=True, scale=True)
for a in acc.values():
    for fc in fcurves(a):
        if fc.data_path.endswith(".location"):
            for k in fc.keyframe_points:
                k.co.y *= s
                k.handle_left.y *= s
                k.handle_right.y *= s
            fc.update()
mesh.parent = arm
mesh.matrix_parent_inverse = Matrix.Identity(4)
for m in mesh.modifiers:
    if m.type == "ARMATURE":
        m.object = arm

# 5) Frente: la puntera debe estar hacia −Y de Blender (= +Z de glTF)
arm.animation_data.action = None
scene.frame_set(1)
pie, punta = (arm.matrix_world @ arm.pose.bones[f"mixamorig:{n}"].head for n in ("LeftFoot", "LeftToeBase"))
if punta.y > pie.y:
    sys.exit("el personaje no mira a −Y de Blender: hace falta girarlo (no previsto)")

# 6) Decimate (antes del esqueleto, conservando UV y pesos)
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
if tris > MAX_TRIS:
    mod = mesh.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = OBJETIVO_TRIS / tris
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
tris_final = g.triangulos(mesh)

# 7) Materiales exportables tal cual (textura de imagen directa); sin metal ni mapas
for m in mesh.data.materials:
    if g.necesita_hornear(m):
        sys.exit(f"el material {m.name} del personaje no es una textura directa: hornear no previsto para avatares")
    g.normalizar_material(m)
for a in list(mesh.data.color_attributes):
    mesh.data.color_attributes.remove(a)

# 8) walk en el sitio: se resta la deriva lineal de la cadera en el plano (canales de location de Hips que no son
# verticales en mundo)
hips = arm.data.bones["mixamorig:Hips"]
ejes_mundo = (arm.matrix_world @ hips.matrix_local).to_3x3().transposed()      # fila i = eje local i en mundo
horizontales = [i for i in range(3) if abs(ejes_mundo[i].z) < 0.7]
deriva = {}
for fbx, a in acc.items():
    if ACCIONES[fbx][0] != "walk":
        continue
    for fc in fcurves(a):
        if fc.data_path == 'pose.bones["mixamorig:Hips"].location' and fc.array_index in horizontales:
            pts = [(k.co.x, k.co.y) for k in fc.keyframe_points]
            n = len(pts)
            mt, mv = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
            b = sum((x - mt) * (y - mv) for x, y in pts) / sum((x - mt) ** 2 for x, _ in pts)
            deriva[fc.array_index] = round(b * (pts[-1][0] - pts[0][0]), 4)
            for k in fc.keyframe_points:
                d = b * (k.co.x - mt)
                k.co.y -= d
                k.handle_left.y -= d
                k.handle_right.y -= d
            fc.update()

# 9) Pistas NLA con el nombre del runtime
ad = arm.animation_data_create()
ad.action = None
for fbx, a in acc.items():
    nombre = ACCIONES[fbx][0]
    a.name = nombre
    pista = ad.nla_tracks.new()
    pista.name = nombre
    tira = pista.strips.new(nombre, int(a.frame_range[0]), a)
    if tira.action_slot is None:
        tira.action_slot = a.slots[0]

kw = dict(filepath=str(OUT / f"{PID}.glb"), export_format="GLB", use_selection=True, export_yup=True,
          export_apply=False, export_cameras=False, export_lights=False, export_materials="EXPORT",
          export_image_format="AUTO", export_vertex_color="NONE", export_animations=True, export_skins=True,
          export_animation_mode="NLA_TRACKS")
OUT.mkdir(parents=True, exist_ok=True)
for o in bpy.context.selected_objects:
    o.select_set(False)
arm.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(**kw)

# Comprobación numérica: la mano en el fotograma 20 de cada clip no debe haberse movido respecto al original (salvo
# la escala s y la deriva quitada al walk)
ref_despues = {k: mano_mundo(a, 20) for k, a in acc.items()}
print("GLBINFO " + json.dumps({
    "file": kw["filepath"], "triangulos": tris_final, "triangulos_original": tris, "escala": round(s, 5),
    "clips": [ACCIONES[k][0] for k in acc], "deriva_walk_quitada_m": deriva, "ejes_cadera_horizontales": horizontales,
    "mano_f20_antes_despues": {ACCIONES[k][0]: [[round(v, 3) for v in ref_antes[k]], [round(v, 3) for v in ref_despues[k]]]
                                for k in acc},
    "segundos": round(time.time() - t0, 1)}))
print("OK exportar_avatar", PID)
