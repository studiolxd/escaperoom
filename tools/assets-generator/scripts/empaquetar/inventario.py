"""
Inventario de un pack, independiente del juego que lo vaya a usar: qué frames hay, de qué tipo, su PNG a 2×, su
lienzo lógico (1×) y su pivote. Lo usan los exportadores de scripts/empaquetar/exportadores/.

Fuentes:
- suelos y muros del generador de tiles (presets de packs/<id>/tiles.json, SVG -> PNG 2× en renders/tiles-png/);
- objetos, iconos, avatares y fx de packs/<id>/entregas/ (PNG 2×, ya a la escala del avatar).
"""
import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

import contexto


@dataclass
class Frame:
    nombre: str
    tipo: str                      # tile | muro (piezas del generador de tiles) | objeto | icono | avatar | fx
    png: Path                      # PNG a 2×
    lienzo_1x: list = None         # [ancho, alto] lógico a 1× (None en avatar: lo fija el juego)
    pivote: list = None            # objetos: [x, y] del centro de la celda en el suelo, fracción del lienzo
    colgado: bool = False          # objetos que cuelgan de un muro (pack.json objetos.colgados)
    grupo: str = None              # avatar: id del personaje


@dataclass
class Inventario:
    frames: list = field(default_factory=list)
    animaciones: list = field(default_factory=list)   # [{"key", "frames", "frameRate", "repeat"}] (avatar + fx)
    avatares: list = field(default_factory=list)      # [{"id", "label"}]
    avatar_origen: list = None


def tiles_png(pack):
    """Genera los SVG de tiles.json, los exporta y los rasteriza a PNG 2× en renders/tiles-png/{tiles,sprites}."""
    root = contexto.ROOT
    presets = sorted({v for k, v in pack.json("tiles.json").items() if not k.startswith("_")})
    src, dest = pack.renders / "tiles", pack.renders / "tiles-png"
    if dest.exists():
        shutil.rmtree(dest)
    if not presets:
        return dest
    subprocess.run(["python3", "scripts/tiles/tilegen.py", "build", *presets], cwd=root, check=True, capture_output=True)
    subprocess.run(["python3", "scripts/tiles/tilegen.py", "export", "--pack", pack.id], cwd=root, check=True,
                   capture_output=True)
    pares = []
    for svg in sorted(src.rglob("*.svg")):
        kind = "tiles" if svg.stem.startswith("tile-") else "sprites"
        (dest / kind).mkdir(parents=True, exist_ok=True)
        pares += [str(svg), str(dest / kind / f"{svg.stem}.png")]
    subprocess.run(["node", "scripts/tiles/rasterizar.mjs", "1", *pares], cwd=root, check=True)
    return dest


def montar(pack):
    inv = Inventario()
    ent = pack.entregas
    # --- suelos y muros ---
    tp = tiles_png(pack)
    for kind, tipo in (("tiles", "tile"), ("sprites", "muro")):
        for png in sorted((tp / kind).glob("*.png")):
            w, h = Image.open(png).size
            inv.frames.append(Frame(png.stem, tipo, png, [w // 2, h // 2]))
    # --- objetos, con su pivote (entregas/objetos/pivotes.json, de empaquetar_objeto.py) ---
    piv_path = ent / "objetos/pivotes.json"
    pivs = json.loads(piv_path.read_text()) if piv_path.exists() else {}
    for n, v in pack["objetos"].get("extra_pivotes", {}).items():    # frames sin empaquetar_objeto
        pivs.setdefault(n, v)
    colgados = tuple(pack["objetos"]["colgados"])
    objetos = {}
    for png in sorted((ent / "objetos/2x").glob("*.png")):
        n = png.stem
        f = Frame(n, "objeto", png, pivs[n]["lienzo_1x"], pivs[n]["pivote"], n.startswith(colgados))
        objetos[n] = f
        inv.frames.append(f)
    # alias: frames que el juego aún pide y que se han sustituido por otro
    for n, src_n in pack["objetos"].get("alias", {}).items():
        s = objetos[src_n]
        inv.frames.append(Frame(n, "objeto", s.png, s.lienzo_1x, s.pivote, s.colgado))
    # --- iconos ---
    for png in sorted((ent / "iconos/2x").glob("icon-*.png")):
        w, h = Image.open(png).size
        inv.frames.append(Frame(png.stem, "icono", png, [w // 2, h // 2]))
    # --- fx ---
    fx = pack.cfg.get("fx", [])
    for png in sorted((ent / "fx/2x").glob("fx-*.png")):
        inv.frames.append(Frame(png.stem, "fx", png, next(f["tamano_1x"] for f in fx if png.stem.startswith(f["key"] + "-"))))
    # --- avatares: cada personaje con su fragmento (animaciones y origen) de empaquetar_avatar.py ---
    etiquetas = pack["avatar"]["etiquetas"]
    for d in sorted(p for p in (ent / "avatares").glob("*") if p.is_dir()):
        for png in sorted((d / "2x").glob("avatar-*.png")):
            inv.frames.append(Frame(png.stem, "avatar", png, grupo=d.name))
        frag = d / "pack.config.fragment.json"
        if frag.exists():
            f = json.loads(frag.read_text())
            inv.animaciones += f.get("anims", [])
            inv.avatar_origen = f.get("avatarOrigin", inv.avatar_origen)
            inv.avatares += f.get("avatars", [{"id": d.name, "label": etiquetas.get(d.name, {"es": {"text": d.name}})}])
    inv.animaciones += [{"key": f["key"], "frames": [f"{f['key']}-{i}" for i in range(1, f["fotogramas"] + 1)],
                         "frameRate": f["frameRate"], "repeat": f["repeat"]} for f in fx]
    return inv
