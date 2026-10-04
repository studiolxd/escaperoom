"""
Exporta a GLB (sin optimizar) las piezas de pared del pack para el modo 3D (encargo 7.10a, specs/27 §2 y §4).

Uso (desde assets-generator/):
    PACK=medieval-v1 /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/exportar_pared_glb.py [-- <salida>]

Salida por defecto: packs/<pack>/renders/glb/<pieza>.glb, una por cada entrada de `pared.json -> piezas`, más
`cuadro-rey-torcido` (el cuadro-rey girado TORCIDO grados alrededor de su borde superior central, el valor de
blender/pared.py) y las cuatro piezas de la bodega que no son una simple imagen (`compartimento-cerrado`,
`compartimento-abierto`, `ranura-vacia`, `ranura-con-caliz`), con la geometría de blender/pared.py.

Convención propia de las piezas de pared:
- origen en el SUELO, bajo el centro de la pieza, en el plano trasero (el que toca el muro);
- la pieza queda a su `altura_centro_m` (pared.json);
- frente a +Z del GLB.
Así, colocada con h = 0 pegada a la cara del muro, cuelga a su altura.

Cada pieza de `pared.json` es `[imagen, alto_m, altura_centro_m, grosor_m]`: un tablero vertical con la imagen de
fuentes/pared/ como textura de la cara frontal (ancho = alto × proporción de la imagen), canto y trasera en un color
oscuro neutro; con grosor 0 (tela), un plano de dos caras.
"""
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402  (prepara sys.path)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix  # noqa: E402

import contexto  # noqa: E402
import glb_comun as g  # noqa: E402
from geometria import bisagra, material  # noqa: E402

PACK = contexto.cargar()
CONF = PACK.json("pared.json")
PARED = CONF["piezas"]
IMG = PACK.fuentes / "pared"
CELL = PACK.estilo["celda_m"]
OUT = Path(iso.args()[-1]) if iso.args() else PACK.renders / "glb"
CANTO = (0.12, 0.10, 0.09)       # canto y trasera del tablero: oscuro neutro
BODEGA = ("compartimento-cerrado", "compartimento-abierto", "ranura-vacia", "ranura-con-caliz")


def reiniciar():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return PACK.modulo("pared")     # tras reiniciar la escena: el módulo guarda bpy.context.scene


def _tiene_alfa(img):
    if img.channels < 4:
        return False
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return float(px[3::4].min()) < 0.999


def mat_imagen(nombre, ruta):
    """Material con la imagen como color base (y su alfa solo si la imagen tiene transparencia). Devuelve (material,
    proporción ancho/alto)."""
    img = bpy.data.images.load(str(ruta))
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    b = nt.nodes["Principled BSDF"]
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    if _tiene_alfa(img):
        nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 0.7
    return m, img.size[0] / img.size[1]


def tablero(nombre, pieza):
    """Tablero (o plano de dos caras si el grosor es 0) con la imagen en la cara frontal (+X de Blender = +Z del GLB):
    plano trasero en x = 0, cara frontal en x = grosor, centro a `altura_centro_m`."""
    img, alto, zc, grosor = PARED[pieza]
    m, aspecto = mat_imagen(nombre, IMG / f"{img}.png")
    w = alto * aspecto
    z0, z1 = zc - alto / 2, zc + alto / 2
    x = grosor
    if grosor:
        canto = material(f"{nombre}_canto", CANTO, 0.9)
        V = [(0, -w / 2, z0), (0, w / 2, z0), (0, w / 2, z1), (0, -w / 2, z1),
             (x, -w / 2, z0), (x, w / 2, z0), (x, w / 2, z1), (x, -w / 2, z1)]
        # frente primero (material 0, la imagen); el resto, canto y trasera (material 1)
        F = [(4, 5, 6, 7), (1, 0, 3, 2), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        mats = [m, canto]
    else:
        V = [(0, -w / 2, z0), (0, w / 2, z0), (0, w / 2, z1), (0, -w / 2, z1)]
        F = [(0, 1, 2, 3)]
        mats = [m]
    me = bpy.data.meshes.new(nombre)
    me.from_pydata(V, [], F)
    for mt in mats:
        me.materials.append(mt)
    for i, p in enumerate(me.polygons):
        p.material_index = 0 if i == 0 else 1
    uv = me.uv_layers.new(name="UVMap")
    esquinas = [(0, 0), (1, 0), (1, 1), (0, 1)]
    for p in me.polygons:
        for k, li in enumerate(p.loop_indices):
            uv.data[li].uv = esquinas[k] if p.index == 0 else (0, 0)
    me.update()
    o = bpy.data.objects.new(nombre, me)
    bpy.context.scene.collection.objects.link(o)
    return o, alto, zc, grosor


def pieza_simple(nombre):
    reiniciar()
    tablero(nombre, nombre)


def pieza_torcida():
    """cuadro-rey girado TORCIDO° alrededor del clavo (borde superior central de la cara frontal): en el plano del muro,
    con la esquina inferior hacia la izquierda de quien mira (el mismo sentido que en el sprite)."""
    esc = reiniciar()
    o, alto, zc, grosor = tablero("cuadro-rey", "cuadro-rey")
    clavo = bisagra("clavo", (grosor, 0, zc + alto / 2), [o])
    clavo.rotation_euler = (math.radians(-esc.TORCIDO), 0, 0)


def pieza_bodega(nombre):
    """Geometría de blender/pared.py (compartimento y ranura), pasada de su sistema de escena (muro en +Y, mirando a
    −Y, centro de la celda en el origen) al de las piezas de pared (plano trasero en x = 0, frente a +X)."""
    esc = reiniciar()
    esc.IMG, esc.PARED, esc.mat_imagen = IMG, PARED, mat_imagen
    if nombre.startswith("compartimento"):
        root, geo = esc.compartimento(nombre.endswith("abierto"))
        esc.pieza_azulejo(root, geo, nombre.endswith("abierto"))
    else:
        root = esc.ranura(nombre.endswith("caliz"))
    root.matrix_world = Matrix.Translation((CELL / 2, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
    bpy.context.view_layer.update()
    # convención del modo 3D: emisivo solo en fuego y agua; la gema del cáliz pasa a rojo mate
    mate = material("rubi_mate", (0.8, 0.02, 0.05), 0.4)
    for o in bpy.data.objects:
        if o.type == "MESH":
            for i, m in enumerate(o.data.materials):
                if m and m.name.startswith("rubi") and m.name != "rubi_mate":
                    o.data.materials[i] = mate


def exportar(nombre):
    piezas, horneados = g.preparar_piezas(g.aplanar([o for o in bpy.data.objects if o.type == "MESH"]), nombre)
    final = g.aplicar_y_unir(piezas, nombre)
    path = g.exportar_glb(OUT / f"{nombre}.glb", [final])
    return path, final, horneados


TRABAJOS = [(p, lambda p=p: pieza_simple(p)) for p in PARED]
TRABAJOS += [("cuadro-rey-torcido", pieza_torcida)]
TRABAJOS += [(b, lambda b=b: pieza_bodega(b)) for b in BODEGA]

for nombre, montar in TRABAJOS:
    t0 = time.time()
    montar()
    path, final, horneados = exportar(nombre)
    bb = g.bbox([final])
    print("GLBINFO " + json.dumps({"file": str(path), "triangulos": g.triangulos(final), "horneados": horneados,
                                   "bbox": [[round(v, 4) for v in b] for b in bb], "segundos": round(time.time() - t0, 1)}))
print("OK exportar_pared_glb")
