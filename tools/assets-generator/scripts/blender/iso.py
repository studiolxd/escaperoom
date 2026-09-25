"""
Cámara isométrica 2:1, sol y fondo del estilo (estilos/<id>/estilo.json), comunes a personajes, objetos y paredes.
También prepara sys.path para que los scripts de Blender importen contexto.py, geometria.py y tilegen.py.
"""
import math
import sys
from pathlib import Path

for _p in (Path(__file__).resolve().parents[1] / "comun", Path(__file__).resolve().parents[1] / "tiles",
           Path(__file__).resolve().parent):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402


def args():
    """Argumentos tras `--` en la línea de Blender."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def camara(scene, estilo, clip_end, ortho=None):
    """Cámara ortográfica con la elevación y el azimut del estilo. Devuelve (objeto, datos, vector adelante)."""
    cam_d = bpy.data.cameras.new("iso")
    cam_d.type = "ORTHO"
    if ortho is not None:
        cam_d.ortho_scale = ortho
    cam_d.clip_end = clip_end
    cam = bpy.data.objects.new("iso", cam_d)
    scene.collection.objects.link(cam)
    c = estilo["camara"]
    cam.rotation_euler = (math.radians(c["elevacion_deg"]), 0, math.radians(c["azimut_deg"]))
    fwd = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    scene.camera = cam
    return cam, cam_d, fwd


def sol(scene, estilo, cam, fwd, angulo_deg=None):
    """Sol del estilo: desde arriba-izquierda, del lado de la cámara."""
    l = estilo["luz"]
    right = cam.rotation_euler.to_matrix() @ Vector((1, 0, 0))
    toward = Vector((-fwd.x, -fwd.y, 0)).normalized()
    ld = (-right * l["derecha"] + toward * l["hacia_camara"] + Vector((0, 0, 1)) * l["arriba"]).normalized()
    sun_d = bpy.data.lights.new("sol", "SUN")
    sun_d.energy = l["energia"]
    if angulo_deg is not None:
        sun_d.angle = math.radians(angulo_deg)
    sun = bpy.data.objects.new("sol", sun_d)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (-ld).to_track_quat("-Z", "Y").to_euler()
    return sun


def fondo_plano(scene, estilo):
    """Mundo de color liso (luz ambiente de objetos y paredes)."""
    f = estilo["fondo"]
    world = bpy.data.worlds.new("mundo")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (*f["color"], 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = f["fuerza"]
    scene.world = world


def fondo_degradado(scene, cfg):
    """Mundo con degradado vertical (suelo cálido, cielo frío): luz ambiente de los personajes."""
    world = bpy.data.worlds.new("mundo")
    world.use_nodes = True
    wn = world.node_tree
    coord = wn.nodes.new("ShaderNodeTexCoord")
    sep = wn.nodes.new("ShaderNodeSeparateXYZ")
    ramp = wn.nodes.new("ShaderNodeValToRGB")
    for el, pos, col in zip(ramp.color_ramp.elements, cfg["posiciones"], cfg["colores"]):
        el.position = pos
        el.color = (*col, 1)
    mr = wn.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1
    wn.links.new(coord.outputs["Generated"], sep.inputs[0])
    wn.links.new(sep.outputs["Z"], mr.inputs["Value"])
    wn.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    wn.links.new(ramp.outputs["Color"], wn.nodes["Background"].inputs[0])
    wn.nodes["Background"].inputs[1].default_value = cfg["fuerza"]
    scene.world = world
