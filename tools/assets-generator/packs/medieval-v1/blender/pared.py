"""
Escenas de pared del pack medieval-v1 para scripts/blender/render_pared.py (PARTE=salon|bodega|estandarte).

render_pared.py deja aquí antes de llamar: OUT, IMG (fuentes/pared), FUENTES, REFERENCIA (FBX del personaje de
escala), PARED (pared.json) y las funciones colgar, importar, mat_imagen, render, quitar y sprites_sueltos.
"""
import math

import bpy

import contexto
from geometria import box, emisivo, material

PACK = contexto.cargar()
EST = PACK.estilo
CELL = EST["celda_m"]
SALA = EST["sala"]                                      # colores y muros de la sala neutra del estilo
ENC = PACK.json("pared.json")["encuadre"]               # encuadre de los sprites de pared
RES = EST["objetos"]["res"]
scene = bpy.context.scene
OUT = IMG = FUENTES = REFERENCIA = PARED = None
colgar = importar = mat_imagen = render = quitar = sprites_sueltos = None
TORCIDO = 14   # grados del cuadro-rey-torcido (cuelga del clavo)


# ---------------------------------------------------------------- bodega
# Mural de azulejos (x=2 del muro y=0 de la bodega) con el compartimento en su azulejo central y la ranura del
# cáliz debajo. Compartimento y ranura se entregan como piezas aparte con el MISMO lienzo y pivote que el mural
# (el runtime las dibuja encima): así sirven tanto si van en la misma celda como si el fixture las separa.
MURAL_PX = (1962, 1945)                    # tamaño de mural-completo.png
XS, YS = (131, 680, 1288, 1839), (119, 704, 1284, 1847)   # juntas de los azulejos (px)


def mural_a_m(px, py):
    img, alto, zc, grosor = PARED["mural-completo"]
    ancho = alto * MURAL_PX[0] / MURAL_PX[1]
    return (px / MURAL_PX[0] - 0.5) * ancho, zc + alto / 2 - py / MURAL_PX[1] * alto


def compartimento(abierto):
    """Azulejo central: cerrado = el azulejo en su sitio; abierto = gira 105° sobre su borde izquierdo y deja ver
    un hueco oscuro con reborde de piedra."""
    root = bpy.data.objects.new("compartimento", None)
    scene.collection.objects.link(root)
    xa, za = mural_a_m(XS[1], YS[1])
    xb, zb = mural_a_m(XS[2], YS[2])
    w, h = xb - xa, za - zb
    grosor = PARED["mural-completo"][3]
    y_face = CELL / 2 - grosor - 0.004
    # la tapa usa azulejo-central.png (recorte de mural-completo con las juntas XS/YS)
    return root, (xa, xb, za, zb, w, h, y_face)


def pieza_azulejo(root, geo, abierto):
    xa, xb, za, zb, w, h, y_face = geo
    m, _ = mat_imagen("azulejo_central", IMG / "azulejo-central.png")
    piezas = []
    if abierto:
        hueco = material("hueco_compartimento", (0.03, 0.025, 0.02), 0.9)
        piedra = material("reborde_compartimento", (0.30, 0.27, 0.23), 0.8)
        piezas.append(box("hueco", (w, 0.004, h), ((xa + xb) / 2, y_face - 0.003, (za + zb) / 2), hueco))
        t = 0.03
        for nm, size, loc in (("reb_arr", (w + 2 * t, 0.03, t), ((xa + xb) / 2, y_face - 0.012, za + t / 2)),
                              ("reb_abj", (w + 2 * t, 0.03, t), ((xa + xb) / 2, y_face - 0.012, zb - t / 2)),
                              ("reb_izq", (t, 0.03, h), (xa - t / 2, y_face - 0.012, (za + zb) / 2)),
                              ("reb_der", (t, 0.03, h), (xb + t / 2, y_face - 0.012, (za + zb) / 2))):
            piezas.append(box(nm, size, loc, piedra))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(w / 2, 0, 0), rotation=(math.radians(90), 0, 0))
    tapa = bpy.context.object
    tapa.name = "azulejo_central"
    tapa.scale = (w, h, 1)
    tapa.data.materials.append(m)
    bis = bpy.data.objects.new("bisagra_azulejo", None)
    scene.collection.objects.link(bis)
    bis.location = (xa, y_face - 0.03 if abierto else y_face - 0.006, (za + zb) / 2)
    bis.parent = root
    tapa.parent = bis
    if abierto:
        bis.rotation_euler = (0, 0, math.radians(-105))   # hacia fuera del muro (−Y)
    for o in piezas:
        o.parent = root
    return piezas + [tapa]


def ranura(con_caliz):
    """Repisa de piedra bajo el mural con un hueco en forma de copa; con el cáliz real dentro si `con_caliz`."""
    root = bpy.data.objects.new("ranura", None)
    scene.collection.objects.link(root)
    piedra = material("piedra_ranura", (0.46, 0.41, 0.35), 0.85)
    hueco = material("hueco_ranura", (0.05, 0.04, 0.035), 0.9)
    zr = 0.46                                   # repisa bajo el mural
    rep = box("repisa", (0.46, 0.22, 0.10), (0, CELL / 2 - 0.11, zr), piedra)
    mensula = box("mensula", (0.24, 0.14, 0.16), (0, CELL / 2 - 0.07, zr - 0.13), piedra)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.075, depth=0.004, location=(0, CELL / 2 - 0.11, zr + 0.051))
    agujero = bpy.context.object
    agujero.data.materials.append(hueco)
    piezas = [rep, mensula, agujero]
    if con_caliz:
        oro = material("oro_caliz", (0.95, 0.66, 0.16), 0.3)
        oro.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.85
        rubi = emisivo("rubi", (0.8, 0.02, 0.05), 0.4)
        prof = [(0.0, 0.0), (0.07, 0.0), (0.07, 0.012), (0.025, 0.03), (0.016, 0.05), (0.016, 0.12), (0.03, 0.135),
                (0.07, 0.17), (0.085, 0.22), (0.086, 0.25), (0.078, 0.25), (0.076, 0.22), (0.06, 0.18), (0.0, 0.16)]
        N = 40
        V = [(r * math.cos(2 * math.pi * i / N), r * math.sin(2 * math.pi * i / N), z) for r, z in prof for i in range(N)]
        F = [(j * N + i, j * N + (i + 1) % N, (j + 1) * N + (i + 1) % N, (j + 1) * N + i)
             for j in range(len(prof) - 1) for i in range(N)]
        me = bpy.data.meshes.new("caliz")
        me.from_pydata(V, [], F)
        cal = bpy.data.objects.new("caliz", me)
        scene.collection.objects.link(cal)
        me.materials.append(oro)
        for p in me.polygons:
            p.use_smooth = True
        cal.location = (0, CELL / 2 - 0.11, zr + 0.03)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, location=(0, CELL / 2 - 0.11 - 0.078, zr + 0.03 + 0.2))
        gema = bpy.context.object
        gema.data.materials.append(rubi)
        piezas += [cal, gema]
    for o in piezas:
        o.parent = root
    return root


def sprites_bodega():
    for orient, rot in (("abajo-izq", 0), ("abajo-der", 90)):
        def tomar(name, g):
            g.rotation_euler = (0, 0, math.radians(rot))
            render(OUT / f"sprite_{name}_{orient}.png", (RES, RES), ENC["ortho"], (0, 0, ENC["centro_z"]))
            quitar(g)
        for f in ("mural-completo", "mural-desordenado", "mirilla"):
            tomar(f, colgar(f))
        for ab, name in ((False, "compartimento-cerrado"), (True, "compartimento-abierto")):
            root, geo = compartimento(ab)
            pieza_azulejo(root, geo, ab)
            tomar(name, root)
        for cc, name in ((False, "ranura-vacia"), (True, "ranura-con-caliz")):
            tomar(name, ranura(cc))


def montaje_bodega():
    COLS, ROWS = 18, 9
    x0, y_top = -COLS * CELL / 2, ROWS * CELL / 2
    sa, sb = material("losa_a", (0.40, 0.37, 0.34)), material("losa_b", (0.34, 0.31, 0.29))
    wm = material("muro", (0.50, 0.45, 0.40))
    for gx in range(COLS):
        for gy in range(ROWS):
            box(f"losa_{gx}_{gy}", (CELL * 0.98, CELL * 0.98, 0.05),
                (x0 + (gx + 0.5) * CELL, y_top - (gy + 0.5) * CELL, -0.025), sa if (gx + gy) % 2 else sb)
    box("muro_y0", (COLS * CELL + 0.18, 0.18, 2.4), (0, y_top + 0.09, 1.2), wm)
    box("muro_x0", (0.18, ROWS * CELL, 2.4), (x0 - 0.09, 0, 1.2), wm)

    def celda(gx, gy):
        return (x0 + (gx + 0.5) * CELL, y_top - (gy + 0.5) * CELL)

    # mural (completo, compartimento abierto, cáliz en la ranura) en la celda (3, 0) del muro del fondo
    g = colgar("mural-completo"); g.location = (*celda(3, 0), 0)
    root, geo = compartimento(True); pieza_azulejo(root, geo, True); root.location = (*celda(3, 0), 0)
    r = ranura(True); r.location = (*celda(3, 0), 0)
    g = colgar("mirilla"); g.location = (*celda(12, 0), 0)
    B = FUENTES / "objetos"
    importar(B / "mesa/tripo.glb", 0.78, celda(9, 5))
    for gx, gy in ((6, 0), (15, 0)):
        importar(B / "barril/tripo.glb", 1.0, celda(gx, gy))
    importar(B / "barril/tripo.glb", 1.0, celda(15, 6))
    bpy.ops.import_scene.fbx(filepath=str(REFERENCIA))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    scene.frame_set(1)
    arm.animation_data.action = None
    arm.location = (*celda(5, 3), 0)
    render(OUT / "bodega_muro.png", (2400, 1500), 13.0, (0.3, 0.6, 1.0))


# ---------------------------------------------------------------- salón del trono
def salon():
    # 1) Sprites sueltos: cada objeto, en las dos orientaciones
    for frame, torc in [(f, 0) for f in PARED] + [("cuadro-rey", TORCIDO)]:
        name = "cuadro-rey-torcido" if torc else frame
        g = colgar(frame, torc)
        for orient, rot in (("abajo-izq", 0), ("abajo-der", 90)):
            g.rotation_euler = (0, 0, math.radians(rot))
            render(OUT / f"sprite_{name}_{orient}.png", (RES, RES), ENC["ortho"], (0, 0, ENC["centro_z"]))
        for o in [g, *g.children_recursive]:
            bpy.data.objects.remove(o)

    # 2) Muro del fondo del salón del trono, como en el fixture (celdas x de la fila y=0)
    COLS, ROWS = 17, 7
    x0, y_top = -COLS * CELL / 2, ROWS * CELL / 2
    sa, sb, wm = material("losa_a", tuple(SALA["losas"][0])), material("losa_b", tuple(SALA["losas"][1])), material("muro", tuple(SALA["muro"]))
    for gx in range(COLS):
        for gy in range(ROWS):
            box(f"losa_{gx}_{gy}", (CELL * 0.98, CELL * 0.98, 0.05),
                (x0 + (gx + 0.5) * CELL, y_top - (gy + 0.5) * CELL, -0.025), sa if (gx + gy) % 2 else sb)
    H, G = SALA["alto_muro_m"], SALA["grosor_muro_m"]
    box("muro_y0", (COLS * CELL + G, G, H), (0, y_top + G / 2, H / 2), wm)
    box("muro_x0", (G, ROWS * CELL, H), (x0 - G / 2, 0, H / 2), wm)


    def celda(gx, gy):
        return (x0 + (gx + 0.5) * CELL, y_top - (gy + 0.5) * CELL)


    for gx, frame in ((4, "tapiz-dragones"), (6, "cuadro-rey"), (8, "cuadro-reino-4torres"), (10, "tapiz-7-dragones"),
                      (12, "cuadro-reino-brasero"), (14, "cuadro-reino-estatuas"), (15, "tapiz-dragones")):
        g = colgar(frame)
        g.location = (*celda(gx, 0), 0)
    O = FUENTES / "objetos"
    importar(O / "trono/tripo.glb", 2.0, celda(10, 1))
    importar(O / "estatua/tripo.glb", 2.4, celda(7, 3))
    importar(O / "estatua/tripo.glb", 2.4, celda(13, 3))
    importar(O / "brasero/tripo.glb", 0.95, celda(4, 6))
    bpy.ops.import_scene.fbx(filepath=str(REFERENCIA))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    scene.frame_set(1)
    arm.animation_data.action = None
    arm.location = (*celda(9, 4), 0)
    render(OUT / "muro_fondo.png", (2400, 1500), 14.0, (0.8, 0.8, 1.0))


def estandarte():
    sprites_sueltos(["estandarte"])


PARTES = {"salon": salon, "bodega": lambda: (sprites_bodega(), montaje_bodega()), "estandarte": estandarte}
