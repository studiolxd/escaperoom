"""
Imágenes de entregas/ que se sacan de otra: las de la vista de inspección y las de los puzles.

Uso (desde assets-generator/):  python3 scripts/empaquetar/empaquetar_derivados.py [--pack <id>] [--salida <carpeta>] [--renders <carpeta>]

Lista en "derivados.imagenes" de pack.json: fuente (relativa al pack), recorte opcional ([x0, y0, x1, y1] o "alfa" =
caja del contenido), y lado_max (reducir sin deformar, como Image.thumbnail) o tamano (tamaño exacto), con metodo
bicubic | lanczos; o icono ({relleno, tamanos}: centrado en lienzos cuadrados, con {tamano} en la salida); o copia: true (archivo o carpeta hecha a mano, tal cual). Salida (por defecto packs/<pack>/entregas/) + la ruta "salida" de cada imagen.
"""
import argparse
import shutil
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comun"))
import contexto  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--pack")
ap.add_argument("--salida")
ap.add_argument("--renders", help="carpeta que sustituye a renders/ en las fuentes (por defecto packs/<pack>/renders)")
a = ap.parse_args()
PACK = contexto.cargar(a.pack)
OUT = Path(a.salida) if a.salida else PACK.entregas
METODOS = {"bicubic": Image.BICUBIC, "lanczos": Image.LANCZOS}

for d in PACK.cfg.get("derivados", {}).get("imagenes", []):
    if d.get("copia"):          # fuente hecha a mano: se copia tal cual (archivo o carpeta)
        src, dest = PACK.dir / d["fuente"], OUT / d["salida"]
        if src.is_dir():
            shutil.copytree(src, dest, dirs_exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, dest)
        print(d["salida"], "(copia)")
        continue
    fuente = PACK.dir / d["fuente"]
    if a.renders and d["fuente"].startswith("renders/"):
        fuente = Path(a.renders) / d["fuente"][len("renders/"):]
    im = Image.open(fuente)
    rec = d.get("recorte")
    if rec == "alfa":
        im = im.crop(im.getchannel("A").getbbox())
    elif rec:
        im = im.crop(tuple(rec))
    if "icono" in d:            # centrado en lienzos cuadrados, ocupando "relleno" del lado (como los iconos)
        for tag, lado in d["icono"]["tamanos"].items():
            c = im.copy()
            k = lado * d["icono"]["relleno"] / max(c.size)
            c = c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.LANCZOS)
            lienzo = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
            lienzo.alpha_composite(c, ((lado - c.width) // 2, (lado - c.height) // 2))
            dest = OUT / d["salida"].format(tamano=tag)
            dest.parent.mkdir(parents=True, exist_ok=True)
            lienzo.save(dest)
        print(d["salida"], "(icono)")
        continue
    metodo = METODOS[d.get("metodo", "bicubic")]
    if "tamano" in d:
        im = im.resize(tuple(d["tamano"]), metodo)
    elif "lado_max" in d:
        im = im.copy()
        im.thumbnail((d["lado_max"], d["lado_max"]), metodo)
    dest = OUT / d["salida"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest)
    print(d["salida"], im.size)
