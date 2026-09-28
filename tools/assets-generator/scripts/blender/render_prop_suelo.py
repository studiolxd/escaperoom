"""
Render isométrico de un objeto PEQUEÑO tirado en el suelo (llave, yesquero, antorcha apagada…) como un único sprite.

Uso (desde assets-generator/):
    PACK=medieval-v1 /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/render_prop_suelo.py -- \
        <fuentes/objetos/<id>/tripo.glb> <inclinacion_grados> <carpeta_salida>

Escribe <carpeta_salida>/sprite.png (cámara 2:1, luz y fondo del estilo del pack, sin sombra). El objeto se centra,
se escala a 1 m en su eje más largo (x4.5 en escena) y se apoya en el suelo con `-25°` de giro; la inclinación
(unos 20°) le da volumen: con 0° queda plano y parece visto desde arriba. Después se recorta por alfa y se copia
a packages/web/public/packs/<pack>/sprites/<id>-suelo.png, con su `sizes`/`origins` en pack.config.json
(p. ej. llave/yesquero [20,22] y antorcha apagada [17,22], origen [0.5,0.7]).
Sprites hechos así: llave-bronce-suelo, yesquero-suelo, antorcha-apagada-suelo.
"""

import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import contexto  # noqa: E402

PACK = contexto.cargar(os.environ.get("PACK", "medieval-v1"))
EST = PACK.estilo

GLB = sys.argv[-3]
TILT_DEG = float(sys.argv[-2])
OUT = Path(sys.argv[-1])
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def import_flat_on_ground(path):
    """Importa un GLB, lo centra y lo escala a 1 m en su eje más largo, apoyado en Z=0."""
    bpy.ops.import_scene.gltf(filepath=path)
    mesh = next(o for o in bpy.context.selected_objects if o.type == "MESH")
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
    import numpy as np

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
    s = 1.0 / (max(xs) - min(xs))
    mesh.data.transform(Matrix.Scale(s, 4))
    mesh.data.transform(Matrix.Translation((0, 0, -min(vx.co.z for vx in mesh.data.vertices))))
    mesh.data.update()
    root = bpy.data.objects.new("prop_suelo", None)
    scene.collection.objects.link(root)
    mesh.parent = root
    return root


cam, cam_data, forward = iso.camara(scene, EST, clip_end=200, ortho=8.2)
cam.location = Vector((0, 0, 0.9)) - forward * 40
iso.sol(scene, EST, cam, forward)
iso.fondo_plano(scene, EST)
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"

prop = import_flat_on_ground(GLB)
prop.scale = (4.5, 4.5, 4.5)
prop.location = (0, 0, 0.01)
prop.rotation_euler = (math.radians(TILT_DEG), 0, math.radians(-25))
scene.render.filepath = str(OUT / "sprite.png")
bpy.ops.render.render(write_still=True)
print("OK", GLB, TILT_DEG)
