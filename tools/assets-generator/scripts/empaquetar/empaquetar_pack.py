"""
Monta la carpeta del pack para el juego: inventario del pack (scripts/empaquetar/inventario.py: tiles, objetos,
iconos, avatares y fx, con lienzos y pivotes) + exportador del formato del juego
(scripts/empaquetar/exportadores/<exportador>.py; "exportador" de pack.json, por defecto escaperoom).

Uso (desde assets-generator/):  python3 scripts/empaquetar/empaquetar_pack.py [--pack <id>] [--version <versión>] [--salida <carpeta>]

Salida por defecto: packs/<id>/salida/. Todo lo propio del pack (versión, proyección, collides, etiquetas de
personajes, objetos colgados, alias, fx) está en packs/<id>/pack.json.
"""
import argparse
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comun"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import contexto  # noqa: E402
import inventario  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--pack")
ap.add_argument("--version")
ap.add_argument("--salida")
a = ap.parse_args()
PACK = contexto.cargar(a.pack)
exportador = importlib.import_module(f"exportadores.{PACK.cfg.get('exportador', 'escaperoom')}")
dest = Path(a.salida) if a.salida else PACK.salida
cuenta, n_sizes, n_origins = exportador.exportar(PACK, inventario.montar(PACK), dest, a.version or PACK["version"])
print(f"{dest}: {cuenta}  sizes={n_sizes} origins={n_origins}")
