"""
Modelo 3D procedural de la llave (forma del icono: cabeza en trébol con agujero, collarín, caña, tope y paletón
de dos dientes). Se usa desde sala_prueba.py:  from modelo_llave import crear_llave
Unidades: metros; la llave mide ~1 m de largo (se escala al colocarla).
"""

import math

import bpy

METALES = {
    "bronce": (0.62, 0.34, 0.16),
    "plata": (0.72, 0.75, 0.80),
    "oro": (0.95, 0.68, 0.18),
}


def _mat(metal):
    m = bpy.data.materials.new(f"llave_{metal}")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*METALES[metal], 1)
    b.inputs["Metallic"].default_value = 0.85
    b.inputs["Roughness"].default_value = 0.32
    return m


def _cyl(r, depth, loc, rot=(0, 0, 0), verts=40):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    return bpy.context.object


def _cube(size, loc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return o


def _torus(major, minor, loc):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc,
                                     major_segments=48, minor_segments=16)
    return bpy.context.object


def crear_llave(metal="bronce", name="llave"):
    """Llave tumbada en el plano XY, cabeza en −X, paletón en +X. Devuelve un vacío padre (escalar/mover este).

    Piezas separadas (sin booleanas, que fallan con piezas solapadas): la cabeza es un aro (agujero real) con tres
    lóbulos alrededor que no tapan el agujero.
    """
    t = 0.07
    rx = (0, math.radians(90), 0)
    parts = [_torus(0.10, 0.045, (-0.36, 0, t / 2))]
    for ang in (90, 210, 330):
        a = math.radians(ang)
        parts.append(_cyl(0.085, t, (-0.36 + 0.15 * math.cos(a), 0.15 * math.sin(a), t / 2)))
    parts.append(_cyl(0.06, 0.07, (-0.20, 0, 0.06), rx))       # collarín
    parts.append(_cyl(0.045, 0.62, (0.10, 0, 0.05), rx))       # caña
    parts.append(_cyl(0.06, 0.05, (0.42, 0, 0.06), rx))        # tope
    parts.append(_cube((0.20, 0.07, t), (0.31, -0.07, t / 2)))  # paletón
    parts.append(_cube((0.06, 0.12, t), (0.25, -0.14, t / 2)))  # diente 1
    parts.append(_cube((0.06, 0.12, t), (0.37, -0.14, t / 2)))  # diente 2

    mat = _mat(metal)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for i, p in enumerate(parts):
        p.name = f"{name}_pieza{i}"
        bev = p.modifiers.new("biselado", "BEVEL")
        bev.width = 0.01
        bev.segments = 3
        bpy.context.view_layer.objects.active = p
        p.select_set(True)
        bpy.ops.object.shade_smooth()
        p.data.materials.clear()
        p.data.materials.append(mat)
        p.parent = root
    return root
