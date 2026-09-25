"""
Utilidades de geometría y materiales para Blender, comunes a todos los packs (render_objeto.py, render_pared.py y el
código de cada pack en packs/<id>/blender/).
"""
import math

import bmesh
import bpy
from mathutils import Vector


def material(name, color, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


def madera(name, eje, tono=1.0, periodo=0.055):
    """Tablas procedurales: bandas en diente de sierra a lo largo de `eje` (juntas oscuras) + veta con ruido."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.8
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.bands_direction = eje
    wave.wave_profile = "SAW"
    wave.inputs["Scale"].default_value = 2 * math.pi / (20 * periodo)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    base = [c * tono for c in (0.30, 0.10, 0.03)]
    ramp.color_ramp.elements[0].color = (*[c * 0.25 for c in base], 1)
    ramp.color_ramp.elements[1].position = 0.07
    ramp.color_ramp.elements[1].color = (*base, 1)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 25
    noise.inputs["Detail"].default_value = 6
    mapping = nt.nodes.new("ShaderNodeMapping")
    # veta alargada a lo largo de la tabla (perpendicular a las juntas)
    mapping.inputs["Scale"].default_value = {"X": (3, 0.4, 0.4), "Y": (0.4, 3, 0.4), "Z": (0.4, 0.4, 3)}[eje]
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.35
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(tc.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    nt.links.new(ramp.outputs["Color"], mix.inputs["A"])
    nt.links.new(noise.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return m


def malla(name, verts, faces, mats):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    for m in mats:
        me.materials.append(m)
    return o


def caja_abierta(name, x0_, x1_, y0_, y1_, z0_, z1_, mats, sin="x1"):
    """Caja de 5 caras con normales hacia dentro; `sin` es la cara que falta (el hueco)."""
    V = [(x0_, y0_, z0_), (x1_, y0_, z0_), (x1_, y1_, z0_), (x0_, y1_, z0_),
         (x0_, y0_, z1_), (x1_, y0_, z1_), (x1_, y1_, z1_), (x0_, y1_, z1_)]
    caras = {"y0": (0, 1, 5, 4), "x1": (1, 2, 6, 5), "y1": (2, 3, 7, 6), "x0": (3, 0, 4, 7),
             "z0": (3, 2, 1, 0), "z1": (4, 5, 6, 7)}
    F = [f for k, f in caras.items() if k != sin]
    o = malla(name, V, F, mats)
    c = Vector(((x0_ + x1_) / 2, (y0_ + y1_) / 2, (z0_ + z1_) / 2))
    for p in o.data.polygons:
        if p.normal.dot(c - Vector(p.center)) < 0:
            p.flip()
    return o


def separar(mesh, pred):
    """Separa en un objeto nuevo las caras cuyo centro cumple `pred`; devuelve el objeto nuevo."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for p in mesh.data.polygons:
        p.select = pred(p.center)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    return next(o for o in bpy.context.selected_objects if o is not mesh)


def cortar(mesh, planos):
    """Corta la malla por planos (punto, normal) para que las piezas se separen por aristas limpias."""
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    for co, no in planos:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
    bm.to_mesh(mesh.data)
    bm.free()


def borrar_caras(obj, pred):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    junk = [f for f in bm.faces if pred(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=junk, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    return len(junk)


def bisagra(name, loc, piezas):
    """Vacío en `loc` del que cuelgan `piezas` (se gira el vacío para abrir)."""
    h = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(h)
    h.location = loc
    bpy.context.view_layer.update()
    for o in piezas:
        o.parent = h
        o.matrix_parent_inverse = h.matrix_world.inverted()
    return h


def emisivo(name, color, fuerza):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0, 0, 0, 1)      # solo emisión: el color sale exacto, sin sol encima
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = fuerza
    return m


def biselar(objs, w=0.018):
    """Bisel suave en las aristas: las piezas de Blender se leen como las de Tripo (formas gruesas redondeadas)."""
    for o in objs:
        if o.type == "MESH" and len(o.data.vertices) == 8:
            m = o.modifiers.new("bisel", "BEVEL")
            m.width = w
            m.segments = 3
    return objs
