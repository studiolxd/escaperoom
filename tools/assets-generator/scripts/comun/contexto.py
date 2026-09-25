"""
Pack y estilo activos, y sus rutas. Lo usan todos los scripts (también los de Blender).

Pack: argumento `--pack <id>`, variable de entorno `PACK`, o el único que haya en packs/.
Un pack (packs/<id>/pack.json) declara su estilo (estilos/<id>/estilo.json).
"""
import importlib.util
import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]      # assets-generator/
ESTILOS = ROOT / "estilos"
PACKS = ROOT / "packs"


def pack_id(pid=None):
    pid = pid or os.environ.get("PACK")
    if not pid:
        ids = sorted(p.name for p in PACKS.iterdir() if (p / "pack.json").exists())
        if len(ids) != 1:
            sys.exit(f"indica el pack (--pack <id> o PACK=<id>): {', '.join(ids)}")
        pid = ids[0]
    if not (PACKS / pid / "pack.json").exists():
        sys.exit(f"no existe packs/{pid}/pack.json")
    return pid


class Estilo:
    def __init__(self, eid):
        self.id = eid
        self.dir = ESTILOS / eid
        self.cfg = json.loads((self.dir / "estilo.json").read_text())
        self.renders = self.dir / "renders"

    def __getitem__(self, k):
        return self.cfg[k]


class Pack:
    def __init__(self, pid=None, validar=True):
        self.id = pack_id(pid)
        self.dir = PACKS / self.id
        self.cfg = json.loads((self.dir / "pack.json").read_text())
        self.estilo = Estilo(self.cfg["estilo"])
        self.fuentes = self.dir / "fuentes"
        self.renders = self.dir / "renders"
        self.entregas = self.dir / "entregas"
        self.salida = self.dir / "salida"
        if validar:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import validar as v
            errores = v.estructura(self)
            if errores:
                sys.exit(f"configuración incorrecta ({len(errores)}):\n  - " + "\n  - ".join(errores))

    def __getitem__(self, k):
        return self.cfg[k]

    def px_por_m(self):
        """Píxeles por metro a 1× (horizontal): ancho 1× del avatar / ancho del recorte fijo × alto del render /
        ortho de la cámara de personajes. Es la escala común de personajes, objetos y muros."""
        pj = self.estilo["personajes"]
        x0, _, x1, _ = pj["recorte"]
        return self["avatar"]["tamanos"]["1x"][0] / (x1 - x0) * pj["res"][1] / pj["ortho"]

    def px_por_m_vertical(self):
        """Píxeles por metro a 1× de una altura (vertical en el mundo): px_por_m × sin(elevación de la cámara)."""
        return self.px_por_m() * math.sin(math.radians(self.estilo["camara"]["elevacion_deg"]))

    def json(self, nombre):
        """Otro JSON de configuración del pack (objetos.json, pared.json, tiles.json)."""
        return json.loads((self.dir / nombre).read_text())

    def modulo(self, nombre):
        """Código propio del pack para Blender: packs/<id>/blender/<nombre>.py."""
        path = self.dir / "blender" / f"{nombre}.py"
        if str(path.parent) not in sys.path:
            sys.path.insert(0, str(path.parent))
        spec = importlib.util.spec_from_file_location(f"pack_{nombre}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod


def entorno():
    """Versiones validadas (entorno.json)."""
    return json.loads((ROOT / "entorno.json").read_text())


def blender(comprobar=True):
    """Ruta de Blender: variable BLENDER, `blender` en el PATH o la ruta por defecto de macOS. Avisa si su versión no es
    la validada en entorno.json (EEVEE puede cambiar los renders entre versiones)."""
    import shutil
    import subprocess
    env = entorno()
    ruta = os.environ.get("BLENDER") or shutil.which("blender") or env["blender_ruta_mac"]
    if not Path(ruta).exists():
        sys.exit(f"no encuentro Blender en {ruta}: define la variable BLENDER")
    if comprobar:
        v = subprocess.run([ruta, "--version"], capture_output=True, text=True).stdout.split("\n")[0]
        if env["blender"] not in v:
            print(f"AVISO: {v.strip()} no es la versión validada (Blender {env['blender']}): los renders pueden cambiar",
                  file=sys.stderr)
    return ruta


_cache = {}


def cargar(pid=None):
    pid = pack_id(pid)
    if pid not in _cache:
        _cache[pid] = Pack(pid)
    return _cache[pid]
