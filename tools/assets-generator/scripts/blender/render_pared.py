"""
Objetos planos de pared (cuadros, tapices, murales...): la imagen pintada de frente se cuelga en el muro y se
renderiza con la cámara isométrica 2:1 y la luz del estilo del pack.

Uso (desde assets-generator/):
    PACK=medieval-v1 PARTE=salon /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/render_pared.py [-- <salida>]

Las piezas (imagen de fuentes/pared/, alto real, altura del centro, grosor del tablero) están en
packs/<pack>/pared.json (con el encuadre de los sprites y la carpeta de renders/ de cada parte); las escenas (PARTE)
y las piezas especiales, en packs/<pack>/blender/pared.py. Los sprites se llaman `sprite_<frame>_<orientación>.png`: colgados del
muro de la fila y=0 ("abajo-izq", mirando a −Y) o de la columna x=0 ("abajo-der", mirando a +X), con el centro de
la celda de la que cuelgan en el origen (pivote, igual que los objetos de suelo): se empaquetan con
empaquetar_objeto.py.
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
IMG = PACK.fuentes / "pared"
CONF = PACK.json("pared.json")
PARED = CONF["piezas"]
ENC = CONF["encuadre"]              # ortho y altura del centro de los sprites de pared
RES = EST["objetos"]["res"]
PARTE = os.environ.get("PARTE", "salon")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
esc = PACK.modulo("pared")      # tras reiniciar la escena: el módulo guarda bpy.context.scene
OUT = Path(iso.args()[-1]) if iso.args() else PACK.renders / CONF["salidas"][PARTE]
OUT.mkdir(parents=True, exist_ok=True)


def mat_imagen(name, path):
    img = bpy.data.images.load(str(path))
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    b = nt.nodes["Principled BSDF"]
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 0.7
    return m, img.size[0] / img.size[1]


canto = material("canto_marco", (0.45, 0.30, 0.10), 0.5)


def colgar(frame, torcido=0.0):
    """Objeto de pared como grupo: vacío en el centro de la celda (suelo), la pieza pegada al muro en +Y, mirando a −Y."""
    img, alto, zc, grosor = PARED[frame]
    m, aspect = mat_imagen(frame, IMG / f"{img}.png")
    ancho = alto * aspect
    root = bpy.data.objects.new(f"pared_{frame}", None)
    scene.collection.objects.link(root)
    y_face = CELL / 2 - max(grosor, 0.02)
    piezas = []
    if grosor:
        piezas.append(box(f"{frame}_tablero", (ancho, grosor, alto), (0, y_face + grosor / 2, zc), canto))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, y_face - 0.002, zc), rotation=(math.radians(90), 0, 0))
    cara = bpy.context.object
    cara.name = f"{frame}_cara"
    cara.scale = (ancho, alto, 1)
    cara.data.materials.append(m)
    piezas.append(cara)
    padre = root
    if torcido:
        clavo = bpy.data.objects.new(f"{frame}_clavo", None)
        scene.collection.objects.link(clavo)
        clavo.location = (0, y_face, zc + alto / 2)
        clavo.parent = root
        padre = clavo
        bpy.context.view_layer.update()
    for o in piezas:
        o.parent = padre
        o.matrix_parent_inverse = padre.matrix_world.inverted()
    if torcido:
        clavo.rotation_euler = (0, math.radians(torcido), 0)
    return root


def importar(glb, alto, pos, rot_deg=-90):
    """Modelo de Tripo (frente +X) escalado a `alto`, apoyado en el suelo en la celda `pos`, mirando a −Y."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    nuevos = [o for o in bpy.data.objects if o not in before]
    mesh = next(o for o in nuevos if o.type == "MESH")
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
    for o in nuevos:
        if o is not mesh:
            bpy.data.objects.remove(o)
    zs = [v.co.z for v in mesh.data.vertices]
    s = alto / (max(zs) - min(zs))
    mesh.scale = (s, s, s)
    mesh.rotation_euler = (0, 0, math.radians(rot_deg))
    mesh.location = (*pos, -min(zs) * s)
    return mesh


# --- Cámara y luz del estilo ---
cam, cam_d, fwd = iso.camara(scene, EST, clip_end=300)
iso.sol(scene, EST, cam, fwd)
iso.fondo_plano(scene, EST)
scene.render.engine = "BLENDER_EEVEE"
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"


def render(path, res, ortho, target):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam_d.ortho_scale = ortho
    cam.location = Vector(target) - fwd * 60
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def quitar(g):
    for o in [g, *g.children_recursive]:
        bpy.data.objects.remove(o)


def sprites_sueltos(frames):
    for f in frames:
        g = colgar(f)
        for orient, rot in (("abajo-izq", 0), ("abajo-der", 90)):
            g.rotation_euler = (0, 0, math.radians(rot))
            render(OUT / f"sprite_{f}_{orient}.png", (RES, RES), ENC["ortho"], (0, 0, ENC["centro_z"]))
        quitar(g)


esc.OUT, esc.IMG, esc.FUENTES, esc.REFERENCIA, esc.PARED = OUT, IMG, PACK.fuentes, (PACK.fuentes / PACK["referencia_escala"]) if PACK["referencia_escala"] else None, PARED
esc.colgar, esc.importar, esc.mat_imagen, esc.render, esc.quitar, esc.sprites_sueltos = colgar, importar, mat_imagen, render, quitar, sprites_sueltos
esc.PARTES[PARTE]()
print("OK pared")
