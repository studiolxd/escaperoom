"""
Genera por código las piezas de kit de muestra del modo 3D (specs/27 §4.1) y las exporta a GLB sin optimizar.

Uso (desde assets-generator/):
    PACK=medieval-v1 /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/exportar_kit.py [-- <salida>]

Salida por defecto: packs/<pack>/renders/glb/muro.glb y suelo-piedra-1.glb. Colores de estilo.json → sala (muro,
losas) y la piedra procedural del pack (piedra_mat) horneada a textura.
- muro: bloque de 1 × 1 × 2,4 m (alto = sala.alto_muro_m). Sillares con juntas biseladas: hiladas de 0,4 m de alto,
  piezas de 0,5 m a rompejuntas, en las cuatro caras y la superior.
- suelo-piedra-1: losa de 1 × 1 × 0,1 m con la cara superior en h = 0 (excepción de origen de las piezas de suelo) y
  cuatro losas de 0,5 m con junta biselada.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso  # noqa: E402  (prepara sys.path)

import bpy  # noqa: E402

import contexto  # noqa: E402
import glb_comun as g  # noqa: E402
from geometria import biselar, box, material  # noqa: E402

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


def muro():
    obj = reiniciar()
    piedra = obj.piedra_mat("piedra_muro", tono(SALA["muro"], obj))
    junta = material("junta_muro", tuple(c * 0.45 for c in SALA["muro"]))
    alto = SALA["alto_muro_m"]
    n_hiladas = round(alto / HILADA)
    h = alto / n_hiladas
    objs = [box("nucleo", (LADO - 2 * PROF + 0.04, LADO - 2 * PROF + 0.04, alto), (0, 0, alto / 2), junta)]
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
                        sill.append(sillar(f"s{k}{eje}{lado}{i}", (PROF, w, h - JUNTA), (pos, c, z), piedra))
                    else:
                        sill.append(sillar(f"s{k}{eje}{lado}{i}", (w, PROF, h - JUNTA), (c, pos, z), piedra))
    # cara superior: cuatro piezas de 0,5 m con junta
    for ix in (-1, 1):
        for iy in (-1, 1):
            sill.append(sillar(f"top{ix}{iy}", (PIEZA - JUNTA, PIEZA - JUNTA, PROF), (ix * PIEZA / 2, iy * PIEZA / 2, alto - PROF / 2), piedra))
    return exportar("muro", [unir(sill, "sillares"), unir(objs, "nucleo_junta")])


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


for fn in (muro, suelo):
    t0 = time.time()
    path, final, horneados = fn()
    bb = g.bbox([final])
    print("GLBINFO " + json.dumps({"file": str(path), "triangulos": g.triangulos(final), "horneados": horneados,
                                   "bbox": [[round(v, 4) for v in b] for b in bb], "segundos": round(time.time() - t0, 1)}))
print("OK exportar_kit")
