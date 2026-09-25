"""
Validación de la configuración de estilos y packs.

- Estructura (tipos y campos obligatorios) de estilo.json, pack.json, objetos.json, pared.json y tiles.json: la
  comprueba contexto.cargar() cada vez que se carga un pack, para que un campo que falta dé un error claro y no un
  KeyError a mitad de un render.
- Referencias (archivos de fuentes/, presets de tiles, constructores de objetos, renders de empaquetado...): con
  este script, que también ejecuta scripts/verificar.py.

Uso (desde assets-generator/):  python3 scripts/comun/validar.py [--pack <id> | --todos]
"""
import argparse
import ast
import json
import sys
from pathlib import Path

NUM = (int, float)


class Opcional:
    def __init__(self, esquema):
        self.esquema = esquema


class Nulo:
    """Valor que puede ser null."""
    def __init__(self, esquema):
        self.esquema = esquema


class Mapa:
    """Diccionario de claves libres con valores del mismo esquema."""
    def __init__(self, esquema):
        self.esquema = esquema


def lista(esquema, n=None):
    return ("lista", esquema, n)


COLOR = lista(NUM, 3)

ESTILO_BASE = {"nombre": str, "descripcion": str}
ESTILO_3D = {
    "celda_m": NUM,
    "camara": {"elevacion_deg": NUM, "azimut_deg": NUM},
    "luz": {"derecha": NUM, "hacia_camara": NUM, "arriba": NUM, "energia": NUM},
    "fondo": {"color": COLOR, "fuerza": NUM},
    "sala": {"losas": lista(COLOR, 2), "muro": COLOR, "alto_muro_m": NUM, "grosor_muro_m": NUM},
    "personajes": {
        "altura_ref_m": NUM, "res": lista(int, 2), "ortho": NUM, "centro_z": NUM, "cabeza_deg": NUM,
        "sol_angulo_deg": NUM,
        "fondo_degradado": {"posiciones": lista(NUM, 2), "colores": lista(COLOR, 2), "fuerza": NUM},
        "direcciones_deg": Mapa(NUM), "recorte": lista(int, 4), "suelo_y": int,
        "metal": Nulo({"saturacion_max": NUM, "valor_min": NUM, "metalico": NUM, "rugosidad": lista(NUM, 2),
                       "tinte": COLOR}),
    },
    "objetos": {"res": int},
    "iconos": {"relleno": NUM},
}
PACK = {
    "id": str, "version": str, "estilo": str, "descripcion": Opcional(str),
    "proyeccion": {"tileWidth": int, "tileHeight": int, "scale": int},
    "collides": Mapa(bool),
    "referencia_escala": Nulo(str),
    "exportador": Opcional(str),
    "avatar": {
        "animaciones": Mapa({"fotogramas": int, "tramo": Nulo(lista(NUM, 2)), "bucle": bool}),
        "acciones": Mapa(lista((str, int), 2)),
        "direcciones": Mapa(str),
        "tamanos": Mapa(lista(int, 2)),
        "origen_por_defecto": lista(NUM, 2),
        "etiquetas": Mapa(Mapa({"text": str})),
    },
    "iconos": {"tamanos": Mapa(int), "hojas": Opcional(lista({"imagen": str, "ids": lista(str)})),
               "alias": Opcional(Mapa(str))},
    "derivados": Opcional({"imagenes": lista({
        "salida": str, "fuente": str, "copia": Opcional(bool), "recorte": Opcional((str, list)),
        "lado_max": Opcional(int), "tamano": Opcional(lista(int, 2)), "metodo": Opcional(str),
        "icono": Opcional({"relleno": NUM, "tamanos": Mapa(int)})})}),
    "blender_extra": Opcional(lista({"script": str, "salida": str})),
    "objetos": {"colgados": lista(str), "alias": Opcional(Mapa(str)), "extra_pivotes": Opcional(Mapa(dict))},
    "notas_salida": Opcional(lista(str)),
    "fx": Opcional(lista({"key": str, "fotogramas": int, "frameRate": int, "repeat": int, "tamano_1x": lista(int, 2),
                          "generador": Opcional(dict)})),
}
OBJETOS = {
    "estados_activos": lista(str),
    "render": Mapa({"glb": Nulo(str), "escala": Nulo(lista((str, NUM), 2)), "encuadre": lista(NUM, 2),
                    "frames": Mapa(str), "orientaciones": Opcional(lista(str)), "salida": Opcional(str),
                    "imagen": Opcional(str)}),
    "empaquetar": Mapa({"render": str, "ortho": NUM, "zc": NUM, "frames": Mapa(lista(str, 2))}),
}
PARED = {"encuadre": {"ortho": NUM, "centro_z": NUM}, "salidas": Mapa(str), "piezas": Mapa(lista((str, NUM), 4))}
TILES = Mapa(str)


def comprobar(dato, esquema, ruta, errores):
    """Añade a `errores` lo que no cumple el esquema. Los campos que empiezan por "_" son comentarios."""
    if isinstance(esquema, Opcional):
        esquema = esquema.esquema
    if isinstance(esquema, Nulo):
        if dato is None:
            return
        esquema = esquema.esquema
    if isinstance(esquema, dict):
        if not isinstance(dato, dict):
            errores.append(f"{ruta}: debería ser un objeto")
            return
        for k, sub in esquema.items():
            if k not in dato:
                if not isinstance(sub, Opcional):
                    errores.append(f"{ruta}.{k}: falta")
                continue
            comprobar(dato[k], sub, f"{ruta}.{k}", errores)
        return
    if isinstance(esquema, Mapa):
        if not isinstance(dato, dict):
            errores.append(f"{ruta}: debería ser un objeto")
            return
        for k, v in dato.items():
            if not k.startswith("_"):
                comprobar(v, esquema.esquema, f"{ruta}.{k}", errores)
        return
    if isinstance(esquema, tuple) and esquema and esquema[0] == "lista":
        _, sub, n = esquema
        if not isinstance(dato, list):
            errores.append(f"{ruta}: debería ser una lista")
            return
        if n is not None and len(dato) != n:
            errores.append(f"{ruta}: debería tener {n} elementos (tiene {len(dato)})")
        for i, v in enumerate(dato):
            comprobar(v, sub, f"{ruta}[{i}]", errores)
        return
    tipos = esquema if isinstance(esquema, tuple) else (esquema,)
    tipos = tuple(t for tt in tipos for t in (tt if isinstance(tt, tuple) else (tt,)))
    if isinstance(dato, bool) and bool not in tipos:
        errores.append(f"{ruta}: no debería ser true/false")
    elif not isinstance(dato, tipos):
        errores.append(f"{ruta}: tipo {type(dato).__name__}, se esperaba {'/'.join(t.__name__ for t in tipos)}")


def estructura(pack):
    """Errores de estructura del pack y de su estilo (lista vacía si todo está bien)."""
    e = []
    comprobar(pack.estilo.cfg, dict(ESTILO_BASE, **ESTILO_3D), f"estilos/{pack.estilo.id}/estilo.json", e)
    comprobar(pack.cfg, PACK, f"packs/{pack.id}/pack.json", e)
    for nombre, esq in (("objetos.json", OBJETOS), ("pared.json", PARED), ("tiles.json", TILES)):
        if (pack.dir / nombre).exists():
            comprobar(json.loads((pack.dir / nombre).read_text()), esq, f"packs/{pack.id}/{nombre}", e)
    return e


def claves_dict(path, nombre):
    """Claves literales del diccionario `nombre` de un módulo de Python, sin importarlo (usa bpy)."""
    for n in ast.walk(ast.parse(path.read_text())):
        if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == nombre for t in n.targets) \
                and isinstance(n.value, ast.Dict):
            return {k.value for k in n.value.keys if isinstance(k, ast.Constant)}
    return None


def referencias(pack):
    """Errores de referencias: archivos, presets, constructores y carpetas de render que no existen."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tiles"))
    import tilegen
    e, P = [], pack.dir
    fu = pack.fuentes
    if pack["referencia_escala"] and not (fu / pack["referencia_escala"]).exists():
        e.append(f"pack.json referencia_escala: no existe fuentes/{pack['referencia_escala']}")
    for pj in sorted(p for p in (fu / "personajes").glob("*") if p.is_dir()):
        for anim in pack["avatar"]["animaciones"]:
            if not (pj / "mixamo" / f"{anim}.fbx").exists():
                e.append(f"personajes/{pj.name}: falta mixamo/{anim}.fbx (avatar.animaciones)")
    if (P / "tiles.json").exists():
        for k, v in pack.json("tiles.json").items():
            if not k.startswith("_") and not tilegen.preset_path(v).exists():
                e.append(f"tiles.json {k}: no existe el preset {v}")
    for h in pack["iconos"].get("hojas", []):
        if not (fu / "iconos" / h["imagen"]).exists():
            e.append(f"iconos.hojas: no existe fuentes/iconos/{h['imagen']}")
    for d in pack.cfg.get("derivados", {}).get("imagenes", []):
        if d["fuente"].startswith("fuentes/") and not (P / d["fuente"]).exists():
            e.append(f"derivados {d['salida']}: no existe {d['fuente']}")
    for x in pack.cfg.get("blender_extra", []):
        if not (P / x["script"]).exists():
            e.append(f"blender_extra: no existe packs/{pack.id}/{x['script']}")
    exp = pack.cfg.get("exportador", "escaperoom")
    if not (Path(__file__).resolve().parents[1] / "empaquetar" / "exportadores" / f"{exp}.py").exists():
        e.append(f"pack.json exportador: no existe scripts/empaquetar/exportadores/{exp}.py")
    salidas = set()
    if (P / "objetos.json").exists():
        o = pack.json("objetos.json")
        cons = claves_dict(P / "blender" / "objetos.py", "CONSTRUCTORES") if (P / "blender/objetos.py").exists() else set()
        for k, v in o["render"].items():
            salidas.add(v.get("salida", k))
            for campo in ("glb", "imagen"):
                if v.get(campo) and not (fu / v[campo]).exists():
                    e.append(f"objetos.json render.{k}.{campo}: no existe fuentes/{v[campo]}")
            if cons is not None and k not in cons:
                e.append(f"objetos.json render.{k}: no hay constructor en blender/objetos.py (CONSTRUCTORES)")
    if (P / "pared.json").exists():
        pa = pack.json("pared.json")
        salidas |= set(pa["salidas"].values())
        for k, v in pa["piezas"].items():
            if not (fu / "pared" / f"{v[0]}.png").exists():
                e.append(f"pared.json piezas.{k}: no existe fuentes/pared/{v[0]}.png")
        partes = claves_dict(P / "blender" / "pared.py", "PARTES") if (P / "blender/pared.py").exists() else set()
        for parte in pa["salidas"]:
            if partes is not None and parte not in partes:
                e.append(f"pared.json salidas.{parte}: no hay PARTES['{parte}'] en blender/pared.py")
    if (P / "objetos.json").exists():
        for k, v in pack.json("objetos.json")["empaquetar"].items():
            if v["render"] not in salidas:
                e.append(f"objetos.json empaquetar.{k}: ningún render escribe en renders/{v['render']}")
    return e


def validar(pack, refs=True):
    return estructura(pack) + (referencias(pack) if refs else [])


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import contexto
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack")
    ap.add_argument("--todos", action="store_true")
    a = ap.parse_args()
    ids = sorted(p.parent.name for p in contexto.PACKS.glob("*/pack.json")) if a.todos else [contexto.pack_id(a.pack)]
    total = 0
    for pid in ids:
        errores = validar(contexto.Pack(pid, validar=False))
        total += len(errores)
        print(f"packs/{pid}: {'correcto' if not errores else f'{len(errores)} errores'}")
        for x in errores:
            print("  -", x)
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
