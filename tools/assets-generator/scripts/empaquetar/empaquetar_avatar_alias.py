"""
Genera un personaje "alias": reutiliza los frames y el retrato ya entregados de otro personaje bajo un id distinto,
para poder simular la elección de los 8 personajes del reparto (`docs/personajes.md`) mientras los 7 que faltan
("Pendientes") no tengan su propio master/render. Marca el resultado como provisional (`alias_de` en el
fragmento) para poder localizarlo y sustituirlo cuando el personaje real se genere.

Uso (desde assets-generator/):
    python3 scripts/empaquetar/empaquetar_avatar_alias.py <alias> --de <personaje-fuente> [--pack <id>]

Escribe `entregas/avatares/<alias>/2x/` con ENLACES SIMBÓLICOS a los PNG de `entregas/avatares/<personaje-fuente>/2x/`
(mismos píxeles, solo cambia el nombre del frame: id de origen -> id del alias) y su propio
`pack.config.fragment.json` (animaciones y retrato renombrados, mismo `avatarOrigin`). `inventario.py` los recoge
igual que a un personaje real: no hace falta tocar `empaquetar_pack.py` ni el runtime del juego.

Nada de esto se versiona (entregas/ es local, ver CLAUDE.md): el paso reproducible de verdad es la copia final al
pack del juego (`packages/web/public/packs/<pack>/avatar/<alias>/`), donde SÍ importa no duplicar los PNG del
personaje fuente — ver docs/DEUDA.md y el LEEME de este pack para el comando exacto (enlaces simbólicos también
ahí, por el mismo motivo).
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comun"))
import contexto  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("alias")
ap.add_argument("--de", required=True, help="personaje fuente cuyos frames y retrato se reutilizan")
ap.add_argument("--pack")
a = ap.parse_args()
PACK = contexto.cargar(a.pack)

FUENTE_DIR = PACK.entregas / "avatares" / a.de
ALIAS_DIR = PACK.entregas / "avatares" / a.alias
SRC_2X = FUENTE_DIR / "2x"
if not SRC_2X.exists():
    sys.exit(f'no hay entrega para "{a.de}" en {SRC_2X}')

OUT_2X = ALIAS_DIR / "2x"
OUT_2X.mkdir(parents=True, exist_ok=True)


def renombrar(s: str) -> str:
    return s.replace(f"-{a.de}-", f"-{a.alias}-").replace(f"-{a.de}", f"-{a.alias}")


n = 0
for png in sorted(SRC_2X.glob("*.png")):
    dest = OUT_2X / renombrar(png.name)
    if dest.exists() or dest.is_symlink():
        dest.unlink()
    dest.symlink_to(Path("..", "..", a.de, "2x", png.name))
    n += 1

frag_fuente_path = FUENTE_DIR / "pack.config.fragment.json"
frag_fuente = json.loads(frag_fuente_path.read_text()) if frag_fuente_path.exists() else {}

frag = {
    "anims": [
        {**anim, "key": renombrar(anim["key"]), "frames": [renombrar(f) for f in anim["frames"]]}
        for anim in frag_fuente.get("anims", [])
    ],
    "alias_de": a.de,
}
if "avatarOrigin" in frag_fuente:
    frag["avatarOrigin"] = frag_fuente["avatarOrigin"]
if "portrait" in frag_fuente:
    frag["portrait"] = renombrar(frag_fuente["portrait"])

(ALIAS_DIR / "pack.config.fragment.json").write_text(json.dumps(frag, indent=2), encoding="utf-8")
print(f'alias "{a.alias}" <- "{a.de}": {n} frames enlazados, fragmento en {ALIAS_DIR / "pack.config.fragment.json"}')
