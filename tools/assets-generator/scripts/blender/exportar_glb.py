"""
Exporta un objeto del pack a GLB (un fichero por estado) para el modo 3D, sin optimizar (eso lo hace
scripts/optimizar_glb.mjs).

Uso (desde assets-generator/):
    PACK=medieval-v1 OBJ=arca /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/exportar_glb.py [-- <salida>]

Salida por defecto: packs/<pack>/renders/glb/<frame>.glb, uno por cada "frames" de objetos.json (arca-cerrada.glb,
arca-abierta.glb). Imprime una línea `GLBINFO {json}` por GLB con los materiales horneados y los triángulos.
Mismos constructores que los sprites (packs/<pack>/blender/objetos.py), sin sala, cámara ni luces.
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402  (prepara sys.path)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import contexto  # noqa: E402
import glb_comun as g  # noqa: E402
from construir import construir_objeto, posar  # noqa: E402

PACK = contexto.cargar()
NAME = os.environ.get("OBJ", "")
CONF = PACK.json("objetos.json")
if NAME not in CONF["render"]:
    sys.exit(f"OBJ={NAME!r} no está en packs/{PACK.id}/objetos.json; objetos: {', '.join(CONF['render'])}")
ACTIVOS = set(CONF["estados_activos"])
OUT = Path(iso.args()[-1]) if iso.args() else PACK.renders / "glb"


def visibles():
    return [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]


for estado, frame in CONF["render"][NAME]["frames"].items():
    t0 = time.time()
    root, mesh, fijas, bisagras, obj = construir_objeto(PACK, NAME)
    # Origen: centro de la base del objeto EN REPOSO (el mismo desplazamiento para todos los estados, para que la
    # tapa abierta o el fuego no muevan el origen)
    posar(obj, bisagras, False)
    reposo = g.aplanar(visibles())
    lo, hi = g.bbox(reposo)
    desp = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for o in reposo:
        bpy.data.objects.remove(o)

    posar(obj, bisagras, estado in ACTIVOS)
    copias = g.aplanar(visibles())
    piezas, horneados = g.preparar_piezas(copias, frame)
    for o in [o for o in bpy.data.objects if o.name in ("marcador",) or o.type == "EMPTY"]:
        bpy.data.objects.remove(o)
    final = g.aplicar_y_unir(piezas, frame, desplazamiento=desp)
    path = g.exportar_glb(OUT / f"{frame}.glb", [final])
    print("GLBINFO " + json.dumps({"file": str(path), "triangulos": g.triangulos(final), "horneados": horneados,
                                   "segundos": round(time.time() - t0, 1)}))
print("OK exportar_glb", NAME)
