"""
Sala de prueba en Blender: suelo + los dos muros del fondo + un cuadro colgado + el caballero, con la MISMA
cámara isométrica 2:1 y la misma luz que los sprites. Sirve para ver objetos en contexto antes de producirlos.

Uso (desde assets-generator/):
    PACK=medieval-v1 /Applications/Blender.app/Contents/MacOS/Blender -b --python packs/medieval-v1/blender/sala_prueba.py [-- <salida>]

Salida por defecto: packs/medieval-v1/renders/sala-prueba/.

Convenciones (coinciden con el runtime: pantalla = (dx − dy, dx + dy)):
- Rejilla del juego: +x = abajo-derecha en pantalla = +X de Blender; +y = abajo-izquierda = −Y de Blender.
- Muro de la fila y=0 (arriba-derecha en pantalla): plano en Y = +borde, mira a −Y.
- Muro de la columna x=0 (arriba-izquierda): plano en X = −borde, mira a +X.
- Celda ≈ 0,9 m (64 px de ancho a 1× con la escala del avatar: 1,75 m ≈ 96 px de alto de sprite).
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/blender"))
import iso  # noqa: E402  (prepara sys.path)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import contexto  # noqa: E402

PACK = contexto.cargar("medieval-v1")
EST = PACK.estilo
OUT = Path(iso.args()[-1]) if iso.args() else PACK.renders / "sala-prueba"
OUT.mkdir(parents=True, exist_ok=True)

CELL = EST["celda_m"]
COLS, ROWS = 7, 7
SALA = EST["sala"]
WALL_H = SALA["alto_muro_m"]
WALL_T = SALA["grosor_muro_m"]
CUADRO_PNG = PACK.fuentes / "pared/cuadro-rey-recortado.png"
KNIGHT_FBX = PACK.fuentes / PACK["referencia_escala"]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


# --- Suelo (losas alternas) y muros neutros ---
stone_a = material("losa_a", tuple(SALA["losas"][0]))
stone_b = material("losa_b", tuple(SALA["losas"][1]))
wall_m = material("muro", tuple(SALA["muro"]))
x0 = -COLS * CELL / 2
y_top = ROWS * CELL / 2
for gx in range(COLS):
    for gy in range(ROWS):
        cx = x0 + (gx + 0.5) * CELL
        cy = y_top - (gy + 0.5) * CELL
        box(f"losa_{gx}_{gy}", (CELL * 0.98, CELL * 0.98, 0.05), (cx, cy, -0.025),
            stone_a if (gx + gy) % 2 else stone_b)
box("muro_y0", (COLS * CELL + WALL_T, WALL_T, WALL_H), (0, y_top + WALL_T / 2, WALL_H / 2), wall_m)
box("muro_x0", (WALL_T, ROWS * CELL, WALL_H), (x0 - WALL_T / 2, 0, WALL_H / 2), wall_m)

# --- Cuadro: imagen (con su marco pintado) sobre un tablero con grosor, colgado del muro y=0 ---
img = bpy.data.images.load(str(CUADRO_PNG))
aspect = img.size[0] / img.size[1]
PAINT_H = 1.15
paint_w = PAINT_H * aspect
cm = bpy.data.materials.new("cuadro")
cm.use_nodes = True
nt = cm.node_tree
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = img
nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
frame_back = material("canto_marco", (0.55, 0.40, 0.12), rough=0.4, metal=0.6)

def cuadro(gx, tilt_deg=0.0):
    cx = x0 + (gx + 0.5) * CELL
    cz = 1.25
    y_face = y_top - 0.06
    board = box("cuadro_tablero", (paint_w, 0.06, PAINT_H), (cx, y_face + 0.03, cz), frame_back)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, y_face - 0.001, cz), rotation=(math.radians(90), 0, 0))
    face = bpy.context.object
    face.scale = (paint_w, PAINT_H, 1)
    face.data.materials.append(cm)
    if tilt_deg:
        pivot = bpy.data.objects.new("pivote_cuadro", None)
        scene.collection.objects.link(pivot)
        pivot.location = (cx, y_face, cz + PAINT_H * 0.5)  # cuelga del clavo
        bpy.context.view_layer.update()
        for o in (board, face):
            o.parent = pivot
            o.matrix_parent_inverse = pivot.matrix_world.inverted()
        pivot.rotation_euler = (0, math.radians(tilt_deg), 0)
        pivot.location.x += 0.12  # se ha desplazado al moverlo
    return board, face

# --- Caballero (idle, fotograma 1), mirando abajo-izquierda (−Y) ---
bpy.ops.import_scene.fbx(filepath=str(KNIGHT_FBX))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
scene.frame_set(1)
arm.animation_data.action = None
arm.location = (x0 + 1.5 * CELL, y_top - 3.5 * CELL, 0)

# --- Cámara y luz del estilo ---
cam, cam_data, forward = iso.camara(scene, EST, clip_end=200, ortho=8.2)
cam.location = Vector((0, 0, 0.9)) - forward * 40
iso.sol(scene, EST, cam, forward)
iso.fondo_plano(scene, EST)

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from modelo_llave import crear_llave  # noqa: E402


import os
LLAVE_GLB = os.environ.get("LLAVE_GLB", str(PACK.fuentes / "objetos/llave/tripo.glb"))
# Oro (textura de Tripo) → bronce del icono: tono, saturación, valor
BRONCE_HSV = [float(v) for v in os.environ.get("BRONCE_HSV", "0.48 0.9 1.18").split()]  # si se da, se usa el modelo de Magnific (Tripo) en vez del procedural


def llave_tripo(path):
    """Importa el GLB de Tripo, lo tumba en el suelo (PCA: eje largo → X, eje fino → Z) y lo tiñe de bronce."""
    import numpy as np
    bpy.ops.import_scene.gltf(filepath=path)
    mesh = next(o for o in bpy.context.selected_objects if o.type == "MESH")
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
    v = np.array([vx.co[:] for vx in mesh.data.vertices])
    c = v.mean(0)
    _, _, vt = np.linalg.svd(v - c, full_matrices=False)
    R = np.array([vt[0], vt[1], np.cross(vt[0], vt[1])])  # filas: nuevos ejes X, Y, Z
    M = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            M[i][j] = R[i][j]
    mesh.data.transform(Matrix.Translation(-Vector(c)))
    mesh.data.transform(M)
    zs = [vx.co.z for vx in mesh.data.vertices]
    if abs(min(zs)) > abs(max(zs)):  # que la cara con relieve mire hacia arriba
        mesh.data.transform(Matrix.Rotation(math.pi, 4, "X"))
    xs = [vx.co.x for vx in mesh.data.vertices]
    # cabeza (lado más ancho en Y) hacia −X, como la llave procedural
    import numpy as np2
    vv = np2.array([vx.co[:] for vx in mesh.data.vertices])
    left = vv[vv[:, 0] < np2.median(vv[:, 0])]
    right = vv[vv[:, 0] >= np2.median(vv[:, 0])]
    if np2.ptp(right[:, 1]) > np2.ptp(left[:, 1]):
        mesh.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
    xs = [vx.co.x for vx in mesh.data.vertices]
    s = 1.0 / (max(xs) - min(xs))
    mesh.data.transform(Matrix.Scale(s, 4))
    mesh.data.transform(Matrix.Translation((0, 0, -min(vx.co.z for vx in mesh.data.vertices))))
    mesh.data.update()
    for mat in mesh.data.materials:  # oro → bronce
        nt = mat.node_tree
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        if tex:
            hsv = nt.nodes.new("ShaderNodeHueSaturation")
            hsv.inputs["Hue"].default_value = BRONCE_HSV[0]
            hsv.inputs["Saturation"].default_value = BRONCE_HSV[1]
            hsv.inputs["Value"].default_value = BRONCE_HSV[2]
            nt.links.new(tex.outputs["Color"], hsv.inputs["Color"])
            nt.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Metallic"].default_value = 0.85
        bsdf.inputs["Roughness"].default_value = 0.32
    root = bpy.data.objects.new("llave_suelo", None)
    scene.collection.objects.link(root)
    mesh.parent = root
    return root


def llave_suelo(gx, gy, length=0.7):
    """Llave de bronce tirada en el suelo, en 3D (objeto para recoger). Escala libre: más grande que una real."""
    k = llave_tripo(LLAVE_GLB) if LLAVE_GLB else crear_llave("bronce", "llave_suelo")
    k.scale = (length, length, length)
    k.location = (x0 + (gx + 0.5) * CELL, y_top - (gy + 0.5) * CELL, 0)
    k.rotation_euler = (0, 0, math.radians(-25))
    return k


room = [o for o in bpy.data.objects if o.name.startswith(("losa_", "muro_"))] + [arm] + list(arm.children)

# 1) Vistas de la sala
objs_recto = cuadro(3)
key = llave_suelo(3, 1)
scene.render.filepath = str(OUT / "sala_cuadro_recto.png")
bpy.ops.render.render(write_still=True)
for o in objs_recto:
    bpy.data.objects.remove(o)
objs_torcido = cuadro(3, tilt_deg=14)
scene.render.filepath = str(OUT / "sala_cuadro_torcido.png")
bpy.ops.render.render(write_still=True)

# 2) Sprites sueltos (sin sala): cuadro recto/torcido y llave en el suelo, fondo transparente
for o in room:
    o.hide_render = True
key.hide_render = True
scene.render.filepath = str(OUT / "sprite_cuadro-rey-torcido.png")
bpy.ops.render.render(write_still=True)
for o in list(bpy.data.objects):
    if o.name.startswith(("cuadro_", "pivote_cuadro")):
        bpy.data.objects.remove(o)
cuadro(3)
scene.render.filepath = str(OUT / "sprite_cuadro-rey.png")
bpy.ops.render.render(write_still=True)
for o in bpy.data.objects:
    o.hide_render = o.type == "MESH" and o.parent is not key
key.scale = (4.5, 4.5, 4.5)  # solo para el sprite: más píxeles (la escala en el juego la decide el runtime)
key.location = (0, 0, 0.01)
scene.render.filepath = str(OUT / "sprite_llave-bronce-suelo.png")
bpy.ops.render.render(write_still=True)
print("OK sala")
