"""
Exporta a GLB (sin optimizar) los objetos pequeños que quedan tirados en el suelo (llave, yesquero, antorcha apagada)
para el modo 3D (encargo 7.10a). Misma colocación que render_prop_suelo.py (que hace el sprite 2D): el `tripo.glb` se
centra, se alinea por sus ejes principales con el eje largo a lo largo de X y se apoya en el suelo; aquí se deja
TUMBADO sin la inclinación de 20° ni el giro de −25° del sprite (son trucos de la cámara isométrica), y se escala a su
medida real: el eje largo mide `largo` m (modelos3d.json → "suelo").

Uso (desde assets-generator/):
    PACK=medieval-v1 /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/exportar_prop_suelo_glb.py [-- <salida>]

Salida por defecto: packs/<pack>/renders/glb/<id>.glb. Origen en el centro de la base, frente a +Z del GLB.
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
from mathutils import Matrix, Vector  # noqa: E402

import contexto  # noqa: E402
import glb_comun as g  # noqa: E402

PACK = contexto.cargar()
PROPS = PACK.json("modelos3d.json")["suelo"]
OUT = Path(iso.args()[-1]) if iso.args() else PACK.renders / "glb"


def tumbado(glb, largo):
    """Importa el GLB, lo alinea por sus ejes principales (largo en X, plano en XY, lo más pesado abajo), lo escala a
    `largo` m en X y lo apoya en el suelo con el centro de su base en el origen."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    mesh = next(o for o in bpy.context.selected_objects if o.type == "MESH")
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o)
    v = np.array([vx.co[:] for vx in mesh.data.vertices])
    c = v.mean(0)
    _, _, vt = np.linalg.svd(v - c, full_matrices=False)
    R = np.array([vt[0], vt[1], np.cross(vt[0], vt[1])])
    M = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            M[i][j] = R[i][j]
    mesh.data.transform(Matrix.Translation(-Vector(c)))
    mesh.data.transform(M)
    zs = [vx.co.z for vx in mesh.data.vertices]
    if abs(min(zs)) > abs(max(zs)):
        mesh.data.transform(Matrix.Rotation(math.pi, 4, "X"))
    xs = [vx.co.x for vx in mesh.data.vertices]
    mesh.data.transform(Matrix.Scale(largo / (max(xs) - min(xs)), 4))
    co = [vx.co for vx in mesh.data.vertices]
    mesh.data.transform(Matrix.Translation((-(min(p.x for p in co) + max(p.x for p in co)) / 2,
                                            -(min(p.y for p in co) + max(p.y for p in co)) / 2,
                                            -min(p.z for p in co))))
    mesh.data.update()
    return mesh


for nombre, conf in PROPS.items():
    t0 = time.time()
    mesh = tumbado(PACK.fuentes / conf["glb"], conf["largo"])
    piezas, horneados = g.preparar_piezas(g.aplanar([mesh]), nombre)
    final = g.aplicar_y_unir(piezas, nombre)
    path = g.exportar_glb(OUT / f"{nombre}.glb", [final])
    bb = g.bbox([final])
    print("GLBINFO " + json.dumps({"file": str(path), "triangulos": g.triangulos(final), "horneados": horneados,
                                   "bbox": [[round(v, 4) for v in b] for b in bb], "segundos": round(time.time() - t0, 1)}))
print("OK exportar_prop_suelo_glb")
