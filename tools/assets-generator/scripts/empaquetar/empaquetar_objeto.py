"""
Empaqueta los sprites de un objeto (renders de render_objeto.py / render_pared.py) a la MISMA escala en píxeles que
los avatares.

Uso (desde assets-generator/):  python3 scripts/empaquetar/empaquetar_objeto.py [--pack <id>] [--renders <dir>] [--salida <dir>] <grupo> [<grupo> ...] | --todos

- Grupos en "empaquetar" de packs/<pack>/objetos.json: carpeta de renders/, encuadre del render (ortho, zc) y
  frames del juego -> (frame del render, orientación). Salida en packs/<pack>/entregas/objetos/{1x,2x,master}.
- Escala 1×: px por metro del avatar (ancho 1× / ancho del recorte fijo × alto del render / ortho de la cámara de
  personajes: con medieval-v1, 49,93 px/m; caballero de 1,75 m → 96 px; celda de 0,905 m → rombo de 64 px de ancho).
  2× = el doble. `master` = recorte a la resolución del render.
- Un único lienzo para todos los frames del objeto (estados y orientaciones): se sustituyen sin moverse.
- Pivote = centro de la celda en el suelo (donde se apoya el objeto), centrado en horizontal. Se imprime su
  posición normalizada para el documento del runtime; la esquina inferior del rombo queda media celda (1×) más abajo.
"""

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comun"))
import contexto  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--pack")
ap.add_argument("--todos", action="store_true")
ap.add_argument("--renders", help="carpeta de renders (por defecto packs/<pack>/renders)")
ap.add_argument("--salida", help="carpeta de entregas/objetos (por defecto packs/<pack>/entregas/objetos)")
ap.add_argument("grupos", nargs="*")
a = ap.parse_args()
PACK = contexto.cargar(a.pack)
PX_POR_M = PACK.px_por_m()                   # 1×: escala del avatar (recorte fijo sobre su render)
RES = PACK.estilo["objetos"]["res"]          # render de sprites de render_objeto.py (cuadrado)
MEDIA_CELDA = PACK["proyeccion"]["tileHeight"] // 2
ELEVACION = math.radians(PACK.estilo["camara"]["elevacion_deg"])
OBJETOS = PACK.json("objetos.json")["empaquetar"]
out = Path(a.salida) if a.salida else PACK.entregas / "objetos"
RENDERS = Path(a.renders) if a.renders else PACK.renders
for tag in ("1x", "2x", "master"):
    (out / tag).mkdir(parents=True, exist_ok=True)


def empaquetar(name):
    cfg = OBJETOS[name]
    src = RENDERS / cfg["render"]
    ims = {k: Image.open(src / f"sprite_{f}_{o}.png") for k, (f, o) in cfg["frames"].items()}
    k1 = PX_POR_M * cfg["ortho"] / RES           # px de 1× por px de render
    # pivote: el objetivo de la cámara (0,0,zc) está en el centro; el suelo (0,0,0) baja zc·sin(elevación)
    px = RES / 2
    py = RES / 2 + cfg["zc"] * math.sin(ELEVACION) * RES / cfg["ortho"]
    rombo = MEDIA_CELDA / k1                              # media altura del rombo de la celda, en px de render

    bb = [im.getbbox() for im in ims.values()]
    l, t = min(b[0] for b in bb), min(b[1] for b in bb)
    r, b_ = max(b[2] for b in bb), max(b[3] for b in bb)
    half = max(px - l, r - px) + 4 / k1
    top, bottom = t - 4 / k1, max(b_, py + rombo) + 2 / k1
    w1 = math.ceil(2 * half * k1 / 2) * 2        # lienzo 1× en px pares
    h1 = math.ceil((bottom - top) * k1 / 2) * 2
    box = (px - w1 / k1 / 2, bottom - h1 / k1, px + w1 / k1 / 2, bottom)
    piv = ((px - box[0]) / (box[2] - box[0]), (py - box[1]) / (box[3] - box[1]))

    for n, im in ims.items():
        c = im.crop(tuple(round(v) for v in box))
        c.resize((w1, h1), Image.LANCZOS).save(out / "1x" / f"{n}.png")
        c.resize((2 * w1, 2 * h1), Image.LANCZOS).save(out / "2x" / f"{n}.png")
        c.save(out / "master" / f"{n}.png")
    # pivotes de todos los frames (los lee empaquetar_pack.py): fracción del lienzo del centro de la celda en el suelo
    piv_path = out / "pivotes.json"
    pivs = json.loads(piv_path.read_text()) if piv_path.exists() else {}
    for n in ims:
        pivs[n] = {"lienzo_1x": [w1, h1], "pivote": [round(piv[0], 4), round(piv[1], 4)]}
    piv_path.write_text(json.dumps(dict(sorted(pivs.items())), indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({"objeto": name, "lienzo_1x": [w1, h1], "lienzo_2x": [2 * w1, 2 * h1],
                      "pivote_celda": [round(piv[0], 3), round(piv[1], 3)],
                      "pivote_px_1x": [round(piv[0] * w1, 1), round(piv[1] * h1, 1)], "frames": list(ims)}))


for g in (list(OBJETOS) if a.todos else a.grupos):
    empaquetar(g)
