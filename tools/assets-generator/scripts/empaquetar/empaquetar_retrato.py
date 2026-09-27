"""
Genera el retrato (avatar de cara) de un personaje a partir de su `master.png`, para el selector de personaje del
lobby (`packages/web/src/components/game-session/character-picker.tsx`, `PackAvatarSchema.portrait`).

Uso (desde assets-generator/):
    python3 scripts/empaquetar/empaquetar_retrato.py [--pack <id>] <personaje> [--tamano 256]

Lee `packs/<pack>/fuentes/personajes/<personaje>/{master.png,ficha.json}`. `ficha.json` debe declarar el encuadre
en `retrato: {x, y, lado}` (rectángulo cuadrado en píxeles del master a resolución completa, cabeza + arranque de
hombros): lo decide a mano quien mira el master (no hay detección de cara automática) y queda anotado ahí para que
el retrato sea reproducible sin volver a mirar la imagen.

El master se genera sobre fondo gris plano uniforme (prompt de `ficha.json`, paso "master"): el recorte se
recompone con transparencia quitando ese color (umbral con pluma sobre la distancia de color al fondo, muestreado
de una esquina del master lejos del personaje) en vez de con un modelo de segmentación, porque el fondo es de un
solo color y sin ruido.

Escribe `entregas/avatares/<personaje>/2x/retrato-<personaje>.png` (mismo nivel que los frames de
`empaquetar_avatar.py`, para que `inventario.py` lo recoja igual) y añade `"portrait": "retrato-<personaje>"` a su
`pack.config.fragment.json` (se conserva lo que ya hubiera escrito `empaquetar_avatar.py`).
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comun"))
import contexto  # noqa: E402

# Distancia de color al fondo (0-255 por canal, euclídea): por debajo de BG_LO es fondo (alpha 0), por encima de
# BG_HI es personaje (alpha 255), en medio se interpola (antialias de los bordes del master contra el gris).
BG_LO, BG_HI = 12.0, 35.0

ap = argparse.ArgumentParser()
ap.add_argument("personaje")
ap.add_argument("--pack")
ap.add_argument("--tamano", type=int, default=256)
a = ap.parse_args()
PACK = contexto.cargar(a.pack)
CHAR_ID = a.personaje

FUENTE = PACK.fuentes / "personajes" / CHAR_ID
ficha_path = FUENTE / "ficha.json"
if not ficha_path.exists():
    sys.exit(f'no existe {ficha_path}')
ficha = json.loads(ficha_path.read_text())
retrato = ficha.get("retrato")
if not retrato:
    sys.exit(
        f'ficha.json de "{CHAR_ID}" no declara "retrato": {{x, y, lado}} (encuadre de la cara sobre master.png).'
    )

master_path = FUENTE / "master.png"
if not master_path.exists():
    sys.exit(f'no existe {master_path}')
master = Image.open(master_path).convert("RGB")
master_arr = np.array(master).astype(float)

x, y, lado = retrato["x"], retrato["y"], retrato["lado"]
box = (x, y, x + lado, y + lado)
crop = master_arr[box[1]:box[3], box[0]:box[2]]

# Fondo: esquina superior izquierda del master completo (siempre fuera del personaje, sea cual sea el encuadre).
bg = master_arr[0:5, 0:5].reshape(-1, 3).mean(axis=0)
dist = np.sqrt(((crop - bg) ** 2).sum(axis=2))
alpha = np.clip((dist - BG_LO) / (BG_HI - BG_LO), 0, 1) * 255
rgba = np.dstack([crop, alpha]).astype(np.uint8)

retrato_img = Image.fromarray(rgba).resize((a.tamano, a.tamano), Image.LANCZOS)

OUT = PACK.entregas / "avatares" / CHAR_ID / "2x"
OUT.mkdir(parents=True, exist_ok=True)
nombre = f"retrato-{CHAR_ID}"
dest = OUT / f"{nombre}.png"
retrato_img.save(dest)
print("retrato:", dest, retrato_img.size)

frag_path = PACK.entregas / "avatares" / CHAR_ID / "pack.config.fragment.json"
frag = json.loads(frag_path.read_text()) if frag_path.exists() else {}
frag["portrait"] = nombre
frag_path.write_text(json.dumps(frag, indent=2), encoding="utf-8")
print("fragmento:", frag_path, "-> portrait:", nombre)
