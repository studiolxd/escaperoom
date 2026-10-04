"""
Utilidades comunes de los exportadores a GLB (exportar_glb.py, exportar_kit.py, exportar_avatar.py): aplanar piezas,
hornear materiales procedurales a textura, limpiar y exportar con las convenciones del modo 3D (specs/27 §2 y §4).

Convenciones: metros; origen en el centro de la base (h = 0 en el punto más bajo); frente a +Z del GLB (en Blender los
modelos miran a +X: giro de −90° sobre Z antes de exportar); escala aplicada a la malla; materiales PBR con color base
(factor o textura), metallic 0, roughness 1, emisivo solo en fuego y agua.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402,F401  (prepara sys.path)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

GIRO_FRENTE = Matrix.Rotation(-math.pi / 2, 4, "Z")   # frente +X de Blender → −Y de Blender = +Z de glTF
RES_PROCEDURAL = 512
RES_MAX_IMAGEN = 1024
MARGEN_PX = 4


# --- Materiales -------------------------------------------------------------------------------------------------

def _bsdf(mat):
    if not mat or not mat.use_nodes:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def _color_enlazado(bsdf):
    """Nodo del que sale el color base (o None si es una constante)."""
    link = next((l for l in bsdf.id_data.links if l.to_socket == bsdf.inputs["Base Color"]), None)
    return link.from_node if link else None


def es_emisivo(mat):
    """Material de geometria.emisivo: base negra y color de emisión constante."""
    b = _bsdf(mat)
    if not b or _color_enlazado(b) is not None:
        return False
    return b.inputs["Emission Strength"].default_value > 0 and sum(b.inputs["Emission Color"].default_value[:3]) > 0


def necesita_hornear(mat):
    """Exportable tal cual: color base constante o textura de imagen directa. El resto (ruido, mezclas...) se hornea."""
    b = _bsdf(mat)
    if not b or es_emisivo(mat):
        return False
    nodo = _color_enlazado(b)
    return nodo is not None and nodo.type != "TEX_IMAGE"


def _imagen_fuente(mat):
    """Mayor lado de las imágenes que alimentan el material (para hornear sin perder resolución), o 0."""
    lados = [max(n.image.size) for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    return max(lados) if lados else 0


def normalizar_material(mat):
    """metallic 0, roughness 1, sin mapas de normales ni de rugosidad; emisivo con fuerza 1 (sin extensión de brillo)."""
    b = _bsdf(mat)
    if not b:
        return
    nt = mat.node_tree
    for nombre in ("Metallic", "Roughness", "Normal"):
        for l in [l for l in nt.links if l.to_socket == b.inputs[nombre]]:
            nt.links.remove(l)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = 1.0
    if es_emisivo(mat):
        b.inputs["Emission Strength"].default_value = 1.0
    else:
        for l in [l for l in nt.links if l.to_socket == b.inputs["Emission Color"]]:
            nt.links.remove(l)
        b.inputs["Emission Strength"].default_value = 0.0


# --- Geometría --------------------------------------------------------------------------------------------------

def aplanar(objetos, depsgraph=None):
    """Copias de las mallas con los modificadores aplicados, EN ESPACIO LOCAL y con la misma matriz mundo que el
    original (los materiales procedurales usan coordenadas de objeto: hay que hornearlos antes de aplicar la
    transformación). Quita del resultado las piezas sin caras."""
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    deps = depsgraph or bpy.context.evaluated_depsgraph_get()
    copias = []
    for o in objetos:
        if o.type != "MESH":
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
        if not me.polygons:
            bpy.data.meshes.remove(me)
            continue
        n = bpy.data.objects.new(o.name, me)
        scene.collection.objects.link(n)
        n.matrix_world = o.matrix_world.copy()
        copias.append(n)
    return copias


def partir_por_material(o):
    """Una malla por cada material usado por `o` (mismo matrix_world). Devuelve [(objeto, material)]."""
    scene = bpy.context.scene
    partes = []
    usados = sorted({p.material_index for p in o.data.polygons})
    for i in usados:
        mat = o.data.materials[i] if i < len(o.data.materials) else None
        me = o.data.copy()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != i], context="FACES")
        bm.to_mesh(me)
        bm.free()
        me.materials.clear()
        me.materials.append(mat)
        for p in me.polygons:
            p.material_index = 0
        n = bpy.data.objects.new(f"{o.name}.{mat.name if mat else 'sin_material'}", me)
        scene.collection.objects.link(n)
        n.matrix_world = o.matrix_world.copy()
        partes.append((n, mat))
    return partes


def _area_uv(me):
    uv = me.uv_layers.active
    if not uv:
        return 0.0
    tot = 0.0
    for p in me.polygons:
        pts = [uv.data[i].uv for i in p.loop_indices]
        a = sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1] for k in range(len(pts)))
        tot += abs(a) / 2
    return tot


def _activar(o):
    for s in bpy.context.selected_objects:
        s.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def desplegar_uv(o):
    """Smart UV Project si la pieza no tiene UV (o los tiene sin área)."""
    me = o.data
    if me.uv_layers and _area_uv(me) > 1e-6:
        return False
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    _activar(o)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return True


def hornear_color(o, mat, nombre, lado):
    """Hornea el color base de `mat` sobre `o` (una sola pieza con ese material) a una imagen lado×lado y devuelve el
    material nuevo (color base = esa imagen). Cycles, DIFFUSE, solo color (sin luz directa ni indirecta)."""
    scene = bpy.context.scene
    b = _bsdf(mat)
    b.inputs["Metallic"].default_value = 0.0
    desplegar_uv(o)
    img = bpy.data.images.new(nombre, lado, lado, alpha=False)
    img.colorspace_settings.name = "sRGB"
    nt = mat.node_tree
    nodo = nt.nodes.new("ShaderNodeTexImage")
    nodo.image = img
    nt.nodes.active = nodo
    for n in nt.nodes:
        n.select = n == nodo
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.render.bake.target = "IMAGE_TEXTURES"
    _activar(o)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=MARGEN_PX, margin_type="EXTEND", use_clear=True)
    img.pack()
    nuevo = bpy.data.materials.new(nombre)
    nuevo.use_nodes = True
    ntn = nuevo.node_tree
    tex = ntn.nodes.new("ShaderNodeTexImage")
    tex.image = img
    ntn.links.new(tex.outputs["Color"], ntn.nodes["Principled BSDF"].inputs["Base Color"])
    o.data.materials.clear()
    o.data.materials.append(nuevo)
    nt.nodes.remove(nodo)
    return nuevo


def preparar_piezas(objetos, prefijo):
    """De mallas locales (de `aplanar`) a piezas listas para exportar: cada (pieza, material) con su material
    horneado si hace falta y normalizado. Devuelve la lista de objetos y la de materiales horneados (informe)."""
    piezas, horneados = [], []
    for o in objetos:
        for parte, mat in partir_por_material(o):
            if mat is not None and necesita_hornear(mat):
                lado = RES_PROCEDURAL
                src = _imagen_fuente(mat)
                if src:
                    lado = min(src, RES_MAX_IMAGEN)
                nuevo = hornear_color(parte, mat, f"{prefijo}_{parte.name}", lado)
                horneados.append({"pieza": o.name, "material": mat.name, "px": lado})
                mat = nuevo
            if mat is not None:
                normalizar_material(mat)
            piezas.append(parte)
        bpy.data.objects.remove(o)
    return piezas, horneados


def bbox(objetos):
    pts = [o.matrix_world @ v.co for o in objetos for v in o.data.vertices]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def aplicar_y_unir(piezas, nombre, giro=GIRO_FRENTE, desplazamiento=Vector((0, 0, 0))):
    """Aplica matrix_world (+ desplazamiento y giro del frente) a la malla de cada pieza y las une en un solo objeto con
    un material por cada material distinto (las que comparten material se funden en una primitiva)."""
    for o in piezas:
        me = o.data
        me.transform(giro @ Matrix.Translation(desplazamiento) @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        me.update()
    _activar(piezas[0])
    for o in piezas:
        o.select_set(True)
    bpy.context.view_layer.objects.active = piezas[0]
    if len(piezas) > 1:
        bpy.ops.object.join()
    final = bpy.context.view_layer.objects.active
    final.name = nombre
    final.data.name = nombre
    final.matrix_world = Matrix.Identity(4)
    return final


def triangulos(o):
    me = o.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def exportar_glb(path, objetos, animaciones=False):
    """GLB binario sin optimizar con las convenciones de arriba. `objetos`: lo que se exporta (lo demás, no)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    for s in bpy.context.selected_objects:
        s.select_set(False)
    for o in objetos:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objetos[0]
    kw = dict(filepath=str(path), export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
              export_cameras=False, export_lights=False, export_materials="EXPORT", export_image_format="AUTO",
              export_vertex_color="NONE", export_animations=animaciones, export_skins=animaciones)
    if animaciones:
        kw.update(export_animation_mode="NLA_TRACKS", export_force_sampling=True)
    bpy.ops.export_scene.gltf(**kw)
    return path
