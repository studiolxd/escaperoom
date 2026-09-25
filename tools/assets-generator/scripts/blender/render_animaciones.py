"""
Render isométrico 2:1 de las animaciones de Mixamo de un personaje, en 4 direcciones, para cualquier pack.

Uso (desde assets-generator/):
    PACK=medieval-v1 PERSONAJE=caballero-m /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/render_animaciones.py [-- <carpeta_mixamo> <salida> <prefijo>]

Por defecto lee packs/<pack>/fuentes/personajes/<PERSONAJE>/mixamo/<anim>.fbx (FBX Binary, With Skin, 30 fps) y
escribe en packs/<pack>/renders/<PERSONAJE>/<anim>/<dir>/<prefijo>_<anim>_<dir>_<n>.png (prefijo = id con "_").
Animaciones y nº de fotogramas: "avatar.animaciones" de pack.json. Cámara, resolución (master; los tamaños de juego
se sacan reduciendo), luz, levantado de cabeza y direcciones: "personajes" de estilo.json.
"""

import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402  (prepara sys.path)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import contexto  # noqa: E402

PACK = contexto.cargar()
EST = PACK.estilo
PJ = EST["personajes"]
if len(iso.args()) >= 3:
    SRC, OUT, PREFIX = Path(iso.args()[-3]), Path(iso.args()[-2]), iso.args()[-1]
else:
    pid = os.environ["PERSONAJE"]
    SRC, OUT, PREFIX = PACK.fuentes / "personajes" / pid / "mixamo", PACK.renders / pid, pid.replace("-", "_")
RES = tuple(PJ["res"])
# Cámara FIJA para todos los personajes (no depende de la altura de cada uno): así el pivote y la escala
# son iguales en todos y el runtime se configura una sola vez.
ORTHO_SCALE = PJ["ortho"]
CAMERA_TARGET_Z = PJ["centro_z"]

# animación → (nº de fotogramas, tramo del clip a muestrear como fracción [inicio, fin), bucle)
ANIMS = {k: (v["fotogramas"], tuple(v["tramo"]) if v["tramo"] else None, v["bucle"])
         for k, v in PACK["avatar"]["animaciones"].items()}   # tramo None = fotogramas clave por la extensión de la mano
# Cabeza algo levantada para que la cara se vea desde la cámara alta (grados, repartidos entre cuello y cabeza)
HEAD_LIFT_DEG = float(os.environ.get("HEAD_LIFT_DEG", PJ["cabeza_deg"]))
# El personaje exportado para Mixamo mira a -Y (= abajo-izquierda en pantalla con esta cámara)
DIRECTIONS = PJ["direcciones_deg"]


def setup_scene(fbx):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(fbx))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    action = arm.animation_data.action
    start, end = action.frame_range

    pivot = bpy.data.objects.new("pivote", None)
    bpy.context.scene.collection.objects.link(pivot)
    arm.parent = pivot

    apply_metal(mesh)
    scene = bpy.context.scene

    cam, cam_data, forward = iso.camara(scene, EST, clip_end=100, ortho=ORTHO_SCALE)
    cam.location = Vector((0, 0, CAMERA_TARGET_Z)) - forward * 20
    iso.sol(scene, EST, cam, forward, angulo_deg=PJ["sol_angulo_deg"])
    iso.fondo_degradado(scene, PJ["fondo_degradado"])

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = RES
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    return pivot, arm, start, end


def reach_frames(arm, start, end):
    """4 fotogramas clave de 'alcanzar': inicio del gesto, subida, brazo extendido y vuelta."""
    from mathutils import Vector as V
    scene = bpy.context.scene
    ext = {}
    for f in range(int(start), int(end) + 1):
        scene.frame_set(f)
        hips = arm.matrix_world @ arm.pose.bones["mixamorig:Hips"].head
        best = 0
        for hand in ("mixamorig:RightHand", "mixamorig:LeftHand"):
            h = arm.matrix_world @ arm.pose.bones[hand].head
            best = max(best, (V((h.x, h.y, 0)) - V((hips.x, hips.y, 0))).length)
        ext[f] = best
    lo, hi = min(ext.values()), max(ext.values())
    peak = max(ext, key=ext.get)
    up = [f for f in ext if f < peak]
    down = [f for f in ext if f > peak]
    def closest(frames, frac):
        target = lo + (hi - lo) * frac
        return min(frames, key=lambda f: abs(ext[f] - target)) if frames else peak
    return [closest(up, 0.2), closest(up, 0.6), peak, closest(down, 0.5)]


def lift_head(arm):
    """Congela la pose actual (sin acción) y levanta cuello y cabeza."""
    from mathutils import Quaternion
    action = arm.animation_data.action
    arm.animation_data.action = None
    for name, share in (("mixamorig:Neck", 0.5), ("mixamorig:Head", 0.5)):
        pb = arm.pose.bones.get(name)
        if pb:
            pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion((1, 0, 0), math.radians(-HEAD_LIFT_DEG * share))
    bpy.context.view_layer.update()
    return action


def apply_metal(mesh):
    """Los grises claros de la textura (armadura) pasan a ser metal con algo de brillo ("metal" del estilo)."""
    M = PJ.get("metal")
    if not M:
        return
    for mat in mesh.data.materials:
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if not tex:
            continue
        hsv = nt.nodes.new("ShaderNodeSeparateColor")
        hsv.mode = "HSV"
        nt.links.new(tex.outputs["Color"], hsv.inputs["Color"])
        low_sat = nt.nodes.new("ShaderNodeMath"); low_sat.operation = "LESS_THAN"; low_sat.inputs[1].default_value = M["saturacion_max"]
        nt.links.new(hsv.outputs[1], low_sat.inputs[0])
        bright = nt.nodes.new("ShaderNodeMath"); bright.operation = "GREATER_THAN"; bright.inputs[1].default_value = M["valor_min"]
        nt.links.new(hsv.outputs[2], bright.inputs[0])
        mask = nt.nodes.new("ShaderNodeMath"); mask.operation = "MULTIPLY"
        nt.links.new(low_sat.outputs[0], mask.inputs[0]); nt.links.new(bright.outputs[0], mask.inputs[1])
        met = nt.nodes.new("ShaderNodeMath"); met.operation = "MULTIPLY"; met.inputs[1].default_value = M["metalico"]
        nt.links.new(mask.outputs[0], met.inputs[0]); nt.links.new(met.outputs[0], bsdf.inputs["Metallic"])
        rough = nt.nodes.new("ShaderNodeMapRange")
        rough.inputs["To Min"].default_value, rough.inputs["To Max"].default_value = M["rugosidad"]
        nt.links.new(mask.outputs[0], rough.inputs["Value"]); nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
        dim = nt.nodes.new("ShaderNodeMix"); dim.data_type = "RGBA"; dim.blend_type = "MULTIPLY"
        dim.inputs["B"].default_value = (*M["tinte"], 1)
        nt.links.new(mask.outputs[0], dim.inputs["Factor"]); nt.links.new(tex.outputs["Color"], dim.inputs["A"])
        nt.links.new(dim.outputs["Result"], bsdf.inputs["Base Color"])


for anim, (count, span, loop) in ANIMS.items():
    fbx = SRC / f"{anim}.fbx"
    if not fbx.exists():
        print("FALTA", fbx)
        continue
    pivot, arm, start, end = setup_scene(fbx)
    if span is None:
        frames = reach_frames(arm, start, end)
    else:
        f0, f1 = span
        length = end - start
        # En bucle se reparte el ciclo sin repetir el último fotograma (= primero)
        frames = [start + length * (f0 + (f1 - f0) * i / (count if loop else count - 1)) for i in range(count)]
    for dname, deg in DIRECTIONS.items():
        pivot.rotation_euler = (0, 0, math.radians(deg))
        folder = OUT / anim / dname
        folder.mkdir(parents=True, exist_ok=True)
        for i, fr in enumerate(frames, start=1):
            bpy.context.scene.frame_set(int(fr), subframe=fr - int(fr))
            action = lift_head(arm)
            bpy.context.scene.render.filepath = str(folder / f"{PREFIX}_{anim}_{dname}_{i}.png")
            bpy.ops.render.render(write_still=True)
            arm.animation_data.action = action
        print("OK", anim, dname, [round(f, 1) for f in frames])
