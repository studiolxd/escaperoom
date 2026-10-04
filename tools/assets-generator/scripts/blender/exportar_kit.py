"""
Genera por código las piezas de kit de muestra del modo 3D (specs/27 §4.1) y las exporta a GLB sin optimizar.

Uso (desde assets-generator/):
    PACK=medieval-v1 /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/exportar_kit.py [-- <salida>]

Salida por defecto: packs/<pack>/renders/glb/<pieza>.glb. Con KIT=muro,suelo-piedra-1 (lista separada por comas) solo
esas piezas; sin KIT, todas. Colores de estilo.json → sala (muro, losas) y la piedra y la madera procedurales del pack
(piedra_mat, madera) horneadas a textura.
- muro: bloque de 1 × 1 × 2,4 m (alto = sala.alto_muro_m). Sillares con juntas biseladas: hiladas de 0,4 m de alto,
  piezas de 0,5 m a rompejuntas, en las cuatro caras y la superior.
- muro-ventana: muro con una saetera de 0,2 × 0,8 m en la cara frontal (+Z), centrada a 1,5 m, abocinada hacia dentro
  y sin atravesar (fondo oscuro).
- muro-arco: muro con un hueco pasante (a lo largo de Z) de 0,8 × 2,0 m rematado en medio punto.
- suelo-piedra-1 / -2, suelo-alfombra, suelo-madera: losa de 1 × 1 × 0,1 m con la cara superior en h = 0 (excepción de
  origen de las piezas de suelo). Piedra 1: cuatro losas de 0,5 m con junta biselada; piedra 2: una losa de 1 m con
  junta perimetral y el segundo color de las losas; alfombra: tela #7f1d1d con ribete #b45309 de 6 cm; madera: cinco
  tablas a lo largo de Z.
- tarima (1 × 1 × 0,4), rampa (1 × 2, de 0 a 0,4), escalera (1 × 2, cinco peldaños de 0,2 m, de 0 a 1,0) y trampilla
  (1 × 1 × 0,05): las rampas y escaleras suben hacia −Z del GLB (el punto bajo queda en +Z).
"""
import json
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402  (prepara sys.path)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

import contexto  # noqa: E402
import glb_comun as g  # noqa: E402
from geometria import biselar, box, madera, malla, material  # noqa: E402

PACK = contexto.cargar()
SALA = PACK.estilo["sala"]
OUT = Path(iso.args()[-1]) if iso.args() else PACK.renders / "glb"
LADO, GRUESO, JUNTA, BISEL = 1.0, 0.1, 0.02, 0.012    # medidas de la spec §4.1 (m)
HILADA, PIEZA, PROF = 0.4, 0.5, 0.06                   # alto de hilada, largo de pieza, fondo del sillar (m)


def reiniciar():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return PACK.modulo("objetos")     # tras reiniciar la escena: el módulo guarda bpy.context.scene


def tono(color, obj):
    """Factor de piedra_mat para que su luminosidad media sea la del color del estilo."""
    return (sum(color) / 3) / (sum(obj.PIEDRA) / 3)


def sillar(nombre, tam, loc, mat):
    o = box(nombre, tam, loc, mat)
    biselar([o], BISEL)
    # biselar() solo actúa en mallas de 8 vértices: segmentos = 1 (chaflán) para no inflar los triángulos del kit
    o.modifiers["bisel"].segments = 1
    return o


def unir(objs, nombre):
    """Aplica modificadores (aplanar) y une en una sola malla local (para hornear UNA textura por material)."""
    copias = g.aplanar(objs)
    for o in objs:
        bpy.data.objects.remove(o)
    g._activar(copias[0])
    for o in copias:
        o.select_set(True)
    bpy.context.view_layer.objects.active = copias[0]
    if len(copias) > 1:
        bpy.ops.object.join()
    final = bpy.context.view_layer.objects.active
    final.name = nombre
    return final


def exportar(nombre, piezas_unidas):
    horneados = []
    piezas, horneados = g.preparar_piezas(piezas_unidas, nombre)
    final = g.aplicar_y_unir(piezas, nombre)
    path = g.exportar_glb(OUT / f"{nombre}.glb", [final])
    return path, final, horneados


def srgb(hexa):
    """Color #rrggbb (sRGB) → lineal, que es lo que lleva el color base de glTF y los materiales de Blender."""
    c = [int(hexa[k:k + 2], 16) / 255 for k in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def convexo(nombre, puntos, mat):
    """Sólido convexo (cierre convexo de `puntos`), operando de las booleanas de corte. Lo quita `limpiar()` cuando el
    corte ya está aplicado (unir())."""
    bm = bmesh.new()
    for p in puntos:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    me = bpy.data.meshes.new(nombre)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(nombre, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    return o


def prisma(nombre, perfil, x0, x1, mat):
    """Prisma convexo extruido a lo largo de X (adelante) con el perfil (y, z) del plano lateral."""
    return convexo(nombre, [(x, y, z) for x in (x0, x1) for y, z in perfil], mat)


def toca(operando, centro, tam):
    """¿Se solapan la caja de la pieza (centro, tam) y la del operando?"""
    vs = [v.co for v in operando.data.vertices]
    for i in range(3):
        if centro[i] + tam[i] / 2 <= min(v[i] for v in vs) or centro[i] - tam[i] / 2 >= max(v[i] for v in vs):
            return False
    return True


def restar(o, operando, transferir=False):
    """Booleana exacta de diferencia. Con `transferir`, las caras del corte llevan el material del operando; si no, el de
    la propia pieza."""
    m = o.modifiers.new("corte", "BOOLEAN")
    m.operation, m.solver, m.object = "DIFFERENCE", "EXACT", operando
    m.material_mode = "TRANSFER" if transferir else "INDEX"


def limpiar(objs):
    for o in objs:
        bpy.data.objects.remove(o)


def hacer_muro(nombre, hueco=None):
    """Bloque `muro`. `hueco(piedra, junta)` (opcional) devuelve (operando de la piel, operando del núcleo, lado) y
    resta ese hueco en las sillares de la cara ±X `lado` que lo tocan y en el núcleo; el operando del núcleo lleva el
    material de las caras del corte."""
    obj = reiniciar()
    piedra = obj.piedra_mat("piedra_muro", tono(SALA["muro"], obj))
    junta = material("junta_muro", tuple(c * 0.45 for c in SALA["muro"]))
    alto = SALA["alto_muro_m"]
    n_hiladas = round(alto / HILADA)
    h = alto / n_hiladas
    nucleo = box("nucleo", (LADO - 2 * PROF + 0.04, LADO - 2 * PROF + 0.04, alto), (0, 0, alto / 2), junta)
    piel_op, nucleo_op, lados = hueco(piedra, junta) if hueco else (None, None, ())
    sill = []
    for k in range(n_hiladas):
        z = (k + 0.5) * h
        # largo útil de la cara: las hiladas pares llegan a la esquina en las caras ±X y las impares en las ±Y
        # (esquinas trabadas)
        cortes = [(0, PIEZA), (PIEZA, 2 * PIEZA)] if k % 2 == 0 else [(0, PIEZA / 2), (PIEZA / 2, 1.5 * PIEZA), (1.5 * PIEZA, 2 * PIEZA)]
        for eje in ("x", "y"):
            llega = (k % 2 == 0) == (eje == "x")
            largo = LADO if llega else LADO - 2 * PROF
            for lado in (-1, 1):
                for i, (a, b) in enumerate(cortes):
                    a, b = a / (2 * PIEZA) * largo, b / (2 * PIEZA) * largo
                    c, w = -largo / 2 + (a + b) / 2, (b - a) - JUNTA
                    pos = lado * (LADO / 2 - PROF / 2)
                    if eje == "x":
                        o = sillar(f"s{k}{eje}{lado}{i}", (PROF, w, h - JUNTA), (pos, c, z), piedra)
                        if piel_op and lado in lados and toca(piel_op, (pos, c, z), (PROF, w, h - JUNTA)):
                            restar(o, piel_op)
                        sill.append(o)
                    else:
                        sill.append(sillar(f"s{k}{eje}{lado}{i}", (w, PROF, h - JUNTA), (c, pos, z), piedra))
    # cara superior: cuatro piezas de 0,5 m con junta
    for ix in (-1, 1):
        for iy in (-1, 1):
            sill.append(sillar(f"top{ix}{iy}", (PIEZA - JUNTA, PIEZA - JUNTA, PROF), (ix * PIEZA / 2, iy * PIEZA / 2, alto - PROF / 2), piedra))
    if nucleo_op:
        restar(nucleo, nucleo_op, transferir=True)
    unidas = [unir(sill, "sillares"), unir([nucleo], "nucleo_junta")]
    if piel_op:
        limpiar([piel_op, nucleo_op])
    return exportar(nombre, unidas)


def muro():
    return hacer_muro("muro")


def muro_ventana():
    """Saetera de 0,2 × 0,8 m centrada a 1,5 m en la cara frontal (+X de Blender): la piel se corta en recto y el núcleo
    en embudo, que se abre hasta 0,44 × 1,04 m a 0,3 m de profundidad y acaba en un fondo oscuro."""
    def hueco(piedra, junta):
        oscuro = material("fondo_saetera", (0.02, 0.018, 0.015), 1.0)
        rect = [(y, z) for y in (-0.1, 0.1) for z in (1.1, 1.9)]
        piel = prisma("hueco_piel", rect, 0.40, 0.60, piedra)
        embudo = convexo("hueco_nucleo", [(0.47, y, z) for y, z in rect] +
                         [(0.20, y, z) for y in (-0.22, 0.22) for z in (0.98, 2.02)], oscuro)
        return piel, embudo, (1,)
    return hacer_muro("muro-ventana", hueco)


def muro_arco():
    """Hueco pasante (a lo largo de X de Blender = Z del GLB) de 0,8 × 2,0 m: jambas rectas hasta 1,6 m y medio punto
    de 0,4 m de radio encima. Las caras del corte, de piedra."""
    def hueco(piedra, junta):
        perfil = [(-0.4, -0.1), (0.4, -0.1)] + [(0.4 * math.cos(math.pi * i / 16), 1.6 + 0.4 * math.sin(math.pi * i / 16))
                                                for i in range(17)]
        return (prisma("hueco_piel", perfil, -0.6, 0.6, piedra), prisma("hueco_nucleo", perfil, -0.6, 0.6, piedra),
                (-1, 1))
    return hacer_muro("muro-arco", hueco)


def suelo():
    obj = reiniciar()
    mats = [obj.piedra_mat(f"piedra_losa_{i}", tono(c, obj)) for i, c in enumerate(SALA["losas"])]
    junta = material("junta_suelo", tuple(c * 0.45 for c in SALA["losas"][1]))
    medio = LADO / 2
    nucleo = box("nucleo", (LADO, LADO, GRUESO - BISEL), (0, 0, -GRUESO / 2 - BISEL / 2), junta)
    por_mat = {0: [], 1: []}
    for ix in (0, 1):
        for iy in (0, 1):
            por_mat[(ix + iy) % 2].append(sillar(f"losa{ix}{iy}", (medio - JUNTA, medio - JUNTA, GRUESO),
                                                 (-medio / 2 + ix * medio, -medio / 2 + iy * medio, -GRUESO / 2), mats[(ix + iy) % 2]))
    unidas = [unir(v, f"losas_{k}") for k, v in por_mat.items()]
    return exportar("suelo-piedra-1", unidas + [unir([nucleo], "nucleo_junta")])


def suelo_piedra_2():
    """Una sola losa de 1 m (segundo color de las losas) con junta perimetral."""
    obj = reiniciar()
    mat = obj.piedra_mat("piedra_losa_1", tono(SALA["losas"][1], obj))
    junta = material("junta_suelo", tuple(c * 0.45 for c in SALA["losas"][1]))
    nucleo = box("nucleo", (LADO, LADO, GRUESO - BISEL), (0, 0, -GRUESO / 2 - BISEL / 2), junta)
    losa = sillar("losa", (LADO - JUNTA, LADO - JUNTA, GRUESO), (0, 0, -GRUESO / 2), mat)
    return exportar("suelo-piedra-2", [unir([losa], "losa"), unir([nucleo], "nucleo_junta")])


def suelo_alfombra():
    """Losa con la cara superior de tela roja oscura (#7f1d1d) y un ribete dorado (#b45309) de 6 cm."""
    reiniciar()
    tela = material("tela_alfombra", srgb("#7f1d1d"), 1.0)
    ribete = material("ribete_alfombra", srgb("#b45309"), 0.9)
    base = material("base_alfombra", tuple(c * 0.45 for c in SALA["losas"][1]))
    grueso_tela, r = 0.012, 0.06
    cuerpo = box("base", (LADO, LADO, GRUESO - grueso_tela), (0, 0, -(GRUESO + grueso_tela) / 2), base)
    centro = box("tela", (LADO - 2 * r, LADO - 2 * r, grueso_tela), (0, 0, -grueso_tela / 2), tela)
    bordes = [box(f"ribete{i}", tam, loc, ribete) for i, (tam, loc) in enumerate([
        ((LADO, r, grueso_tela), (0, LADO / 2 - r / 2, -grueso_tela / 2)),
        ((LADO, r, grueso_tela), (0, -LADO / 2 + r / 2, -grueso_tela / 2)),
        ((r, LADO - 2 * r, grueso_tela), (LADO / 2 - r / 2, 0, -grueso_tela / 2)),
        ((r, LADO - 2 * r, grueso_tela), (-LADO / 2 + r / 2, 0, -grueso_tela / 2))])]
    return exportar("suelo-alfombra", [unir([cuerpo], "base"), unir([centro], "tela"), unir(bordes, "ribete")])


def tablas_madera(nombre, eje, tonos, ancho):
    """Materiales de madera horneables con las juntas de las bandas alineadas con las tablas de `ancho` m (origen del
    objeto en el del kit, para que las coordenadas de objeto coincidan con las del mundo del modelo)."""
    mats = []
    for i, t in enumerate(tonos):
        m = madera(f"{nombre}_{i}", eje, t, ancho / 20)
        onda = next(n for n in m.node_tree.nodes if n.type == "TEX_WAVE")
        onda.inputs["Phase Offset"].default_value = 2 * math.pi * 0.535
        mats.append(m)
    return mats


def suelo_madera():
    """Cinco tablas de 0,2 m a lo largo de X de Blender (Z del GLB), de dos tonos alternos."""
    reiniciar()
    mats = tablas_madera("suelo_madera", "Y", (1.5, 1.2), 0.2)
    junta = material("junta_madera", (0.03, 0.012, 0.005))
    nucleo = box("nucleo", (LADO, LADO, GRUESO - BISEL), (0, 0, -GRUESO / 2 - BISEL / 2), junta)
    por_mat = {0: [], 1: []}
    for i in range(5):
        o = sillar(f"tabla{i}", (LADO - JUNTA, 0.2 - JUNTA, GRUESO), (0, -0.4 + 0.2 * i, -GRUESO / 2), mats[i % 2])
        por_mat[i % 2].append(o)
    unidas = [unir(v, f"tablas_{k}") for k, v in por_mat.items()]
    return exportar("suelo-madera", unidas + [unir([nucleo], "nucleo_junta")])


def tarima():
    """Caja de madera de 1 × 1 × 0,4 m con canto de piedra (marco de 8 cm y 6 cm de alto en el borde superior)."""
    obj = reiniciar()
    mad = tablas_madera("madera_tarima", "Y", (1.0,), 0.12)[0]
    piedra = obj.piedra_mat("piedra_tarima", tono(SALA["losas"][0], obj))
    cuerpo = box("cuerpo", (LADO - 0.04, LADO - 0.04, 0.34), (0, 0, 0.17), mad)
    tapa = box("tapa", (LADO - 0.16, LADO - 0.16, 0.06), (0, 0, 0.37), mad)
    r = 0.08
    marco = [sillar(f"canto{i}", tam, loc, piedra) for i, (tam, loc) in enumerate([
        ((LADO, r, 0.06), (0, LADO / 2 - r / 2, 0.37)), ((LADO, r, 0.06), (0, -LADO / 2 + r / 2, 0.37)),
        ((r, LADO - 2 * r, 0.06), (LADO / 2 - r / 2, 0, 0.37)), ((r, LADO - 2 * r, 0.06), (-LADO / 2 + r / 2, 0, 0.37))])]
    return exportar("tarima", [unir([cuerpo, tapa], "madera"), unir(marco, "canto")])


def cuna(nombre, mat, largo, ancho, alto):
    """Cuña cerrada: el extremo alto en −X de Blender (−Z del GLB) y el bajo en +X; centrada en planta."""
    mx, my = largo / 2, ancho / 2
    V = [(-mx, -my, 0), (mx, -my, 0), (mx, my, 0), (-mx, my, 0), (-mx, -my, alto), (-mx, my, alto)]
    F = [(0, 3, 2, 1), (4, 1, 2, 5), (0, 4, 5, 3), (0, 1, 4), (3, 5, 2)]
    o = malla(nombre, V, F, [mat])
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    return o


def rampa():
    """Cuña de 1 × 2 m que sube de 0 a 0,4 m hacia −Z del GLB (punto bajo en +Z)."""
    obj = reiniciar()
    piedra = obj.piedra_mat("piedra_rampa", tono(SALA["losas"][0], obj))
    return exportar("rampa", [unir([cuna("cuna", piedra, 2.0, LADO, 0.4)], "cuna")])


def escalera():
    """Cinco peldaños de 0,2 m (0,4 m de huella) en 1 × 2 m, de 0 a 1,0 m hacia −Z del GLB (el punto bajo en +Z)."""
    obj = reiniciar()
    piedra = obj.piedra_mat("piedra_escalera", tono(SALA["losas"][0], obj))
    pelds = []
    for i in range(1, 6):
        alto = 0.2 * i
        x0 = 1.0 - 0.4 * i              # el peldaño i ocupa x ∈ [x0, x0 + 0,4] (el más alto, junto a −X)
        pelds.append(sillar(f"peldano{i}", (0.4, LADO, alto), (x0 + 0.2, 0, alto / 2), piedra))
    return exportar("escalera", [unir(pelds, "peldanos")])


def trampilla():
    """Tablero de madera de 1 × 1 × 0,05 m con marco de hierro, dos refuerzos y una argolla hundida en una placa."""
    reiniciar()
    mad = tablas_madera("madera_trampilla", "Y", (0.9,), 0.12)[0]
    hierro = material("hierro_trampilla", (0.06, 0.06, 0.07), 0.7)
    r, e = 0.07, 0.05
    tablero = box("tablero", (LADO - 2 * r, LADO - 2 * r, 0.03), (0, 0, 0.015), mad)
    hierros = [box(f"marco{i}", tam, loc, hierro) for i, (tam, loc) in enumerate([
        ((LADO, r, e), (0, LADO / 2 - r / 2, e / 2)), ((LADO, r, e), (0, -LADO / 2 + r / 2, e / 2)),
        ((r, LADO - 2 * r, e), (LADO / 2 - r / 2, 0, e / 2)), ((r, LADO - 2 * r, e), (-LADO / 2 + r / 2, 0, e / 2)),
        ((LADO - 2 * r, 0.05, 0.04), (0, 0.27, 0.02)), ((LADO - 2 * r, 0.05, 0.04), (0, -0.27, 0.02)),
        ((0.16, 0.16, 0.036), (0, 0, 0.018))])]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.06, minor_radius=0.011, major_segments=24, minor_segments=8,
                                     location=(0, 0, 0.038))
    argolla = bpy.context.object
    argolla.data.materials.append(hierro)
    return exportar("trampilla", [unir([tablero], "madera"), unir(hierros + [argolla], "hierro")])


PIEZAS = {"muro": muro, "muro-ventana": muro_ventana, "muro-arco": muro_arco, "suelo-piedra-1": suelo,
          "suelo-piedra-2": suelo_piedra_2, "suelo-alfombra": suelo_alfombra, "suelo-madera": suelo_madera,
          "tarima": tarima, "rampa": rampa, "escalera": escalera, "trampilla": trampilla}
PEDIDAS = [p for p in os.environ.get("KIT", "").split(",") if p] or list(PIEZAS)
desconocidas = [p for p in PEDIDAS if p not in PIEZAS]
if desconocidas:
    sys.exit(f"KIT: piezas desconocidas {desconocidas}; piezas: {', '.join(PIEZAS)}")

for pieza in PEDIDAS:
    t0 = time.time()
    path, final, horneados = PIEZAS[pieza]()
    bb = g.bbox([final])
    print("GLBINFO " + json.dumps({"file": str(path), "triangulos": g.triangulos(final), "horneados": horneados,
                                   "bbox": [[round(v, 4) for v in b] for b in bb], "segundos": round(time.time() - t0, 1)}))
print("OK exportar_kit")
