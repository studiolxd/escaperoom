"""
Prepara un GLB de Tripo/Magnific para Mixamo: quita el rig de Tripo, aplica la pose de reposo (T) y exporta
solo la malla con su textura en FBX (Mixamo re-riggea con mejores pesos).

Uso (desde assets-generator/):
    [PACK=<id>] [HEIGHT_M=1.80] $BLENDER -b --python scripts/blender/exportar_mixamo.py -- <modelo.glb> <salida.fbx>

HEIGHT_M: altura del personaje en metros (da la escala relativa entre personajes; ver la biblia del estilo). Por
defecto, la altura de referencia del estilo del pack ("personajes.altura_ref_m" de estilo.json).
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402,F401  (prepara sys.path)

import bpy  # noqa: E402

import contexto  # noqa: E402

GLB, OUT = sys.argv[-2], Path(sys.argv[-1])
HEIGHT_M = float(os.environ.get("HEIGHT_M") or contexto.cargar().estilo["personajes"]["altura_ref_m"])
OUT.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Fuera objetos auxiliares (Tripo incluye una Icosphere)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)

mesh = next(o for o in bpy.data.objects if o.type == "MESH")
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)

# Congelar la malla en la pose de reposo y soltarla del esqueleto
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
for mod in list(mesh.modifiers):
    if mod.type == "ARMATURE":
        mesh.modifiers.remove(mod)
mw = mesh.matrix_world.copy()
mesh.parent = None
mesh.matrix_world = mw
mesh.vertex_groups.clear()
if arm:
    bpy.data.objects.remove(arm)
# Hornear la transformación en los vértices (más fiable que transform_apply en modo fondo)
from mathutils import Matrix
import math
mesh.data.transform(mesh.matrix_world)
mesh.matrix_world = Matrix.Identity(4)

# Mixamo espera personaje de pie mirando a -Y. El GLB de Tripo mira a +X y mide ~1 (se escala a HEIGHT_M).
mesh.data.transform(Matrix.Rotation(math.radians(-90), 4, "Z"))
zs = [v.co.z for v in mesh.data.vertices]
s = HEIGHT_M / (max(zs) - min(zs))
mesh.data.transform(Matrix.Scale(s, 4))
minz = min(v.co.z for v in mesh.data.vertices)
mesh.data.transform(Matrix.Translation((0, 0, -minz)))
mesh.data.update()

# Reducir polígonos: Tripo v3.1 puede dar ~1M de triángulos; Mixamo y los sprites no necesitan tanto
TARGET_TRIS = 60000
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
if tris > TARGET_TRIS:
    dec = mesh.modifiers.new("reducir", "DECIMATE")
    dec.ratio = TARGET_TRIS / tris
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.modifier_apply(modifier=dec.name)
print("TRIANGULOS", tris, "->", sum(len(p.vertices) - 2 for p in mesh.data.polygons))

# Textura dentro del FBX
for img in bpy.data.images:
    if img.source == "FILE" or img.packed_file:
        img.filepath_raw = str(OUT.parent / f"{img.name}.png")
        img.file_format = "PNG"
        img.save()

bpy.ops.export_scene.fbx(
    filepath=str(OUT),
    use_selection=False,
    object_types={"MESH"},
    path_mode="COPY",
    embed_textures=True,
    apply_scale_options="FBX_SCALE_ALL",
)
print("EXPORTADO", OUT, "dimensiones", tuple(round(v, 2) for v in mesh.dimensions))
