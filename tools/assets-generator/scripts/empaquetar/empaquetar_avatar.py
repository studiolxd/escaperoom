"""
Empaqueta los fotogramas renderizados de un personaje para el pack del juego (EscapeRoom, game-runtime).

Uso (desde assets-generator/):
    python3 scripts/empaquetar/empaquetar_avatar.py [--pack <id>] <personaje> [--render <carpeta>] [--salida <carpeta>]

Por defecto lee packs/<pack>/renders/<personaje>/ (salida de render_animaciones.py: <anim>/<dir>/<prefijo>_<anim>_<dir>_<n>.png)
y escribe en packs/<pack>/entregas/avatares/<personaje>/{2x,1x}/avatar-<id>-<dir>-<accion>-<n>.png + preview +
pack.config.fragment.json + LEEME.md (el LEEME se escribe a mano).

Convenciones del runtime (packages/game-runtime/src/pack/avatar.ts), en "avatar" de pack.json:
- frames `avatar-<personaje>-<n|e|s|w>-<idle|walk|interact>-<i>` (personajes seleccionables), lienzo lógico
  "tamanos", origen del sprite (0.5, AVATAR_ORIGIN_Y).
- La proyección del runtime: pantalla = (dx - dy, dx + dy) → e = abajo-der, s = abajo-izq, w = arriba-izq, n = arriba-der.
Recorte fijo y fila del suelo del render: "personajes" de estilo.json (dependen de la cámara, no del personaje).
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comun"))
import contexto  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("personaje")
ap.add_argument("--pack")
ap.add_argument("--render")
ap.add_argument("--salida")
a = ap.parse_args()
PACK = contexto.cargar(a.pack)
AV, PJ = PACK["avatar"], PACK.estilo["personajes"]
CHAR_ID = a.personaje
SRC = Path(a.render) if a.render else PACK.renders / CHAR_ID
OUT = Path(a.salida) if a.salida else PACK.entregas / "avatares"

DIRS = AV["direcciones"]
ACTIONS = {k: tuple(v) for k, v in AV["acciones"].items()}  # animación del render -> (acción del runtime, fps)
SIZES = {k: tuple(v) for k, v in AV["tamanos"].items()}
PIVOT_Y_SRC = PJ["suelo_y"]  # fila del render donde cae el suelo bajo el personaje (ver render_animaciones.py)

# Recorte FIJO (2:3), igual para todos los personajes: pivote común para el runtime.
# Calculado con el caballero (1,75 m) + margen para armas/bastones y personajes algo más altos.
BOX = tuple(PJ["recorte"])
box = BOX
pivot_frac = (PIVOT_Y_SRC - box[1]) / (box[3] - box[1])
for f in sorted(SRC.glob("*/*/*.png")):
    a = np.array(Image.open(f))[..., 3] > 8
    ys, xs = np.where(a)
    if xs.min() < box[0] or xs.max() > box[2] or ys.min() < box[1] or ys.max() > box[3]:
        print("AVISO: se sale del recorte fijo:", f.name, (xs.min(), ys.min(), xs.max(), ys.max()))
print("recorte", box, "pivote (fracción de alto desde arriba):", round(pivot_frac, 3))

anims = []
for anim_src, (action, fps) in ACTIONS.items():
    for dir_src, d in DIRS.items():
        frames = sorted((SRC / anim_src / dir_src).glob("*.png"), key=lambda p: int(p.stem.rsplit("_", 1)[1]))
        names = []
        for i, f in enumerate(frames, start=1):
            crop = Image.open(f).crop(box)
            name = f"avatar-{CHAR_ID}-{d}-{action}-{i}"
            names.append(name)
            for tag, size in SIZES.items():
                folder = OUT / CHAR_ID / tag
                folder.mkdir(parents=True, exist_ok=True)
                crop.resize(size, Image.LANCZOS).save(folder / f"{name}.png")
        anims.append({"key": f"avatar-{CHAR_ID}-{d}-{action}", "frames": names, "frameRate": fps,
                      "repeat": 0 if action == "interact" else -1})

(OUT / CHAR_ID / "pack.config.fragment.json").write_text(
    json.dumps({"anims": anims, "avatarOrigin": [0.5, round(pivot_frac, 3)]}, indent=2), encoding="utf-8")

# Hoja de previsualización a 2× sobre claro y oscuro
order = ["s", "e", "n", "w"]
rows = [(a, d) for a in ("idle", "walk", "interact") for d in order]
W, H = SIZES["2x"]
cols = 8
sheet = Image.new("RGB", (W * cols * 2 + 20, H * len(rows)), (255, 255, 255))
for r, (a, d) in enumerate(rows):
    for side, bg in enumerate([(208, 208, 208), (11, 17, 32)]):
        for i in range(cols):
            p = OUT / CHAR_ID / "2x" / f"avatar-{CHAR_ID}-{d}-{a}-{i + 1}.png"
            cell = Image.new("RGBA", (W, H), bg + (255,))
            if p.exists():
                cell.alpha_composite(Image.open(p))
            sheet.paste(cell.convert("RGB"), (side * (W * cols + 20) + i * W, r * H))
sheet.save(OUT / CHAR_ID / "preview_2x.png")
print("frames:", len(list((OUT / CHAR_ID / "1x").glob("*.png"))))
