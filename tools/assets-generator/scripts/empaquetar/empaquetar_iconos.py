"""
Recorta iconos de inventario de imágenes con fondo gris liso y los empaqueta para el juego.

Uso (desde assets-generator/):
    python3 scripts/empaquetar/empaquetar_iconos.py [--pack <id>] [--salida <carpeta>] [<imagen>:<id1,id2,...> ...]

Sin imágenes, usa las "hojas" y los "alias" de "iconos" en pack.json (lo que se entrega). Las imágenes pueden ir con
su ruta o relativas a packs/<pack>/fuentes/iconos/. Los objetos de cada imagen se detectan como manchas separadas
sobre el fondo y se asignan a los ids en orden de lectura (filas de arriba abajo, cada fila de izquierda a
derecha); el id "-" descarta ese objeto.
Salida (por defecto packs/<pack>/entregas/iconos): {1x,2x,master}/icon-<id>.png (tamaños en "iconos" de pack.json,
transparentes) + preview.png. El objeto ocupa el "relleno" del estilo (iconos.relleno) del lado del icono.
"""

import argparse
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comun"))
import contexto  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--pack")
ap.add_argument("--salida")
ap.add_argument("imagenes", nargs="*", metavar="imagen:ids")
a = ap.parse_args()
PACK = contexto.cargar(a.pack)
OUT = Path(a.salida) if a.salida else PACK.entregas / "iconos"
SIZES = PACK["iconos"]["tamanos"]
HOJAS = a.imagenes or [f"{h['imagen']}:{','.join(h['ids'])}" for h in PACK["iconos"].get("hojas", [])]
ALIAS = {} if a.imagenes else PACK["iconos"].get("alias", {})
FILL = PACK.estilo["iconos"]["relleno"]  # el objeto ocupa este % del lado del icono


def extract(path):
    """Devuelve una lista de recortes RGBA (uno por objeto) en orden de lectura."""
    im = Image.open(path).convert("RGB")
    a = np.array(im).astype(np.int32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    diff = np.abs(a - bg).sum(2)
    alpha = np.clip((diff - 14) * 9, 0, 255).astype(np.uint8)

    # componentes a 1/8 de resolución (con dilatación para unir llama/mecha, etc.)
    k = 8
    small = Image.fromarray(alpha).resize((im.width // k, im.height // k), Image.BOX)
    small = small.point(lambda v: 255 if v > 20 else 0).filter(ImageFilter.MaxFilter(7))
    m = np.array(small) > 0
    lab = np.zeros(m.shape, int)
    boxes = []
    for y in range(m.shape[0]):
        for x in range(m.shape[1]):
            if m[y, x] and not lab[y, x]:
                n = len(boxes) + 1
                q = deque([(y, x)]); lab[y, x] = n
                x0 = x1 = x; y0 = y1 = y; area = 0
                while q:
                    cy, cx = q.popleft(); area += 1
                    x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < m.shape[0] and 0 <= nx < m.shape[1] and m[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; q.append((ny, nx))
                boxes.append((area, n, (x0 * k, y0 * k, (x1 + 1) * k, (y1 + 1) * k)))
    boxes = [b for b in boxes if b[0] > 60]
    row_h = np.median([b[2][3] - b[2][1] for b in boxes]) * 0.6
    boxes.sort(key=lambda b: (round(b[2][1] / row_h), b[2][0]))

    labels_full = np.array(Image.fromarray(lab.astype(np.uint8)).resize(im.size, Image.NEAREST))
    rgba = np.dstack([a.astype(np.uint8), alpha])
    crops = []
    for _, n, (x0, y0, x1, y1) in boxes:
        piece = rgba.copy()
        piece[..., 3] = np.where(labels_full == n, piece[..., 3], 0)
        img = Image.fromarray(piece)
        crops.append(img.crop(img.getchannel("A").getbbox()))
    return crops


def save_icon(crop, icon_id):
    for tag, side in SIZES.items():
        c = crop.copy()
        scale = side * FILL / max(c.size)
        c = c.resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))), Image.LANCZOS)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.alpha_composite(c, ((side - c.width) // 2, (side - c.height) // 2))
        folder = OUT / tag
        folder.mkdir(parents=True, exist_ok=True)
        canvas.save(folder / f"icon-{icon_id}.png")


ids_done = []
for arg in HOJAS:
    path, ids = arg.rsplit(":", 1)
    ids = ids.split(",")
    if not Path(path).exists() and (PACK.fuentes / "iconos" / path).exists():
        path = str(PACK.fuentes / "iconos" / path)
    crops = extract(path)
    if len(crops) != len(ids):
        print(f"AVISO {path}: {len(crops)} objetos detectados para {len(ids)} ids")
    for crop, icon_id in zip(crops, ids):
        if icon_id == "-":
            continue
        save_icon(crop, icon_id)
        ids_done.append(icon_id)
for icon_id, src_id in ALIAS.items():     # copias exactas (no salen en la previsualización)
    for tag in SIZES:
        (OUT / tag / f"icon-{icon_id}.png").write_bytes((OUT / tag / f"icon-{src_id}.png").read_bytes())

# Previsualización: 2x sobre panel oscuro y claro, y 1x
ids_done.sort()
cell = 150
prev = Image.new("RGB", (cell * len(ids_done), cell * 3), (255, 255, 255))
for i, icon_id in enumerate(ids_done):
    for r, (tag, bg) in enumerate((("2x", (28, 32, 44)), ("2x", (208, 208, 208)), ("1x", (28, 32, 44)))):
        tile = Image.new("RGBA", (cell, cell), bg + (255,))
        ic = Image.open(OUT / tag / f"icon-{icon_id}.png")
        tile.alpha_composite(ic, ((cell - ic.width) // 2, (cell - ic.height) // 2))
        prev.paste(tile.convert("RGB"), (i * cell, r * cell))
prev.save(OUT / "preview.png")
print("iconos:", ids_done)
