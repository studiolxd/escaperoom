"""
Monta un objeto del pack en una escena vacía (sin sala, cámara ni luces), para exportarlo a GLB.

Es una COPIA de la lógica de render_objeto.py (importar el GLB de fuentes, llamar al constructor, crear `root`,
escalar y apoyar en el suelo, y `pose` sin la parte de orientación): render_objeto.py no la usa a propósito, para que
scripts/verificar.py siga comparando las mismas salidas. Si cambia allí, revisar aquí.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402,F401  (prepara sys.path)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402


def construir_objeto(pack, nombre):
    """Reinicia la escena, importa el GLB de fuentes (o crea el marcador), llama a CONSTRUCTORES[nombre] y aplica la
    escala. Devuelve (root, mesh, fijas, bisagras, modulo_objetos). Deja en `modulo_objetos.CFG` la configuración."""
    conf = pack.json("objetos.json")
    if nombre not in conf["render"]:
        sys.exit(f"OBJ={nombre!r} no está en packs/{pack.id}/objetos.json; objetos: {', '.join(conf['render'])}")
    cfg = dict(conf["render"][nombre])
    for k in ("glb", "imagen"):
        if cfg.get(k):
            cfg[k] = pack.fuentes / cfg[k]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    obj = pack.modulo("objetos")      # tras reiniciar la escena: el módulo guarda bpy.context.scene
    obj.CFG = cfg

    if cfg.get("glb"):
        bpy.ops.import_scene.gltf(filepath=str(cfg["glb"]))
        mesh = next(o for o in bpy.context.selected_objects if o.type == "MESH")
        mesh.data.transform(mesh.matrix_world)
        mesh.matrix_world = Matrix.Identity(4)
        for o in list(bpy.data.objects):
            if o.type == "EMPTY" and o is not mesh:
                bpy.data.objects.remove(o)
    else:   # objeto procedural (en metros): marcador de un vértice en el suelo
        me = bpy.data.meshes.new("marcador")
        me.from_pydata([(0, 0, 0)], [], [])
        mesh = bpy.data.objects.new("marcador", me)
        scene.collection.objects.link(mesh)

    fijas, bisagras = obj.CONSTRUCTORES[nombre](mesh)

    root = bpy.data.objects.new(nombre, None)
    scene.collection.objects.link(root)
    for o in [mesh, *fijas, *(h for h, _, _ in bisagras)]:
        o.parent = root
    if cfg["escala"]:
        eje, medida = cfg["escala"]
        i = "xyz".index(eje)
        co = [v.co[i] for v in mesh.data.vertices]
        s = medida / (max(co) - min(co))
    else:
        s = 1.0
    root.scale = (s, s, s)
    zmin = min(v.co.z for v in mesh.data.vertices)
    root.location.z = -zmin * s
    return root, mesh, fijas, bisagras, obj


def posar(modulo_objetos, bisagras, activo):
    """Abre/cierra bisagras y muestra/oculta SOLO_ACTIVO / SOLO_REPOSO / MOVIMIENTOS (sin orientar el objeto)."""
    obj = modulo_objetos
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
