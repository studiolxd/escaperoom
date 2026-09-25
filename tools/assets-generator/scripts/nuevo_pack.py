"""
Crea la estructura de un pack nuevo con su configuración mínima comentada.

Uso (desde assets-generator/):  python3 scripts/nuevo_pack.py <id> --estilo <estilo> [--desde <pack>]

--desde copia de otro pack lo que depende del juego y no de los assets (proyección, convenciones del avatar,
tamaños de iconos, exportador); sin él se usan los valores de EscapeRoom. collides (tileId -> choca) empieza vacío. No copia assets ni fuentes.
Después: rellenar pack.json, tiles.json, objetos.json y pared.json, y el código de blender/ (ver ../CLAUDE.md).
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "comun"))
import contexto  # noqa: E402

ESCAPEROOM = {
    "proyeccion": {"tileWidth": 64, "tileHeight": 32, "scale": 2},
    "collides": {},
    "exportador": "escaperoom",
    "avatar": {
        "animaciones": {"idle": {"fotogramas": 8, "tramo": [0.0, 1.0], "bucle": True},
                        "andar": {"fotogramas": 8, "tramo": [0.0, 1.0], "bucle": True},
                        "alcanzar": {"fotogramas": 4, "tramo": None, "bucle": False}},
        "acciones": {"idle": ["idle", 8], "andar": ["walk", 12], "alcanzar": ["interact", 8]},
        "direcciones": {"abajo-der": "e", "abajo-izq": "s", "arriba-izq": "w", "arriba-der": "n"},
        "tamanos": {"2x": [128, 192], "1x": [64, 96]},
        "origen_por_defecto": [0.5, 0.886],
    },
    "iconos_tamanos": {"1x": 64, "2x": 128, "master": 512},
}

OBJETOS_PY = '''"""
Constructores de los objetos del pack {id} para scripts/blender/render_objeto.py.

Cada constructor recibe la malla importada (o un marcador si el objeto es procedural) y devuelve (piezas fijas,
bisagras [(vacío, eje, grados al abrir)]). La configuración de cada objeto (GLB, escala, encuadre, estados,
orientaciones y medidas propias) está en ../objetos.json; render_objeto.py la deja en CFG antes de llamar.
Ejemplos completos: packs/medieval-v1/blender/objetos.py (bisagras, interiores, fuego, piezas procedurales).
"""
import math

import bpy
from mathutils import Matrix, Vector

import contexto
from geometria import bisagra, biselar, borrar_caras, box, caja_abierta, cortar, emisivo, madera, malla, material, separar

PACK = contexto.cargar()
CELL = PACK.estilo["celda_m"]
CFG = None             # configuración del objeto actual (la pone render_objeto.py)
scene = bpy.context.scene
SOLO_ACTIVO = []       # piezas que solo se ven en los estados activos
SOLO_REPOSO = []       # piezas que solo se ven fuera de los estados activos
MOVIMIENTOS = []       # (objeto, desplazamiento, giro en grados) que se aplican en los estados activos


def sin_cambios(body):
    """Objeto que se renderiza tal cual (sin estados que muevan piezas)."""
    return [], []


CONSTRUCTORES = {{
    # "cofre": construir_cofre,
    # "estatua": sin_cambios,
}}
'''

PARED_PY = '''"""
Escenas de pared del pack {id} para scripts/blender/render_pared.py (PARTE=<parte>, ver "salidas" de ../pared.json).

render_pared.py deja aquí antes de llamar: OUT, IMG (fuentes/pared), FUENTES, REFERENCIA (FBX del personaje de
escala), PARED (pared.json) y las funciones colgar, importar, mat_imagen, render, quitar y sprites_sueltos.
Ejemplo completo: packs/medieval-v1/blender/pared.py.
"""
import bpy

import contexto

PACK = contexto.cargar()
scene = bpy.context.scene
OUT = IMG = FUENTES = REFERENCIA = PARED = None
colgar = importar = mat_imagen = render = quitar = sprites_sueltos = None


def todas():
    """Cada pieza de pared.json colgada, en las dos orientaciones."""
    sprites_sueltos(list(PARED))


PARTES = {{"todas": todas}}
'''


def escribir(path, texto):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(texto)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--estilo", required=True)
    ap.add_argument("--desde")
    a = ap.parse_args()
    dest = contexto.PACKS / a.id
    if dest.exists():
        sys.exit(f"ya existe {dest}")
    if not (contexto.ESTILOS / a.estilo / "estilo.json").exists():
        sys.exit(f"no existe el estilo estilos/{a.estilo} (créalo con scripts/nuevo_estilo.py)")
    base = ESCAPEROOM
    if a.desde:
        o = contexto.Pack(a.desde, validar=False)
        base = {"proyeccion": o["proyeccion"], "collides": {}, "exportador": o.cfg.get("exportador", "escaperoom"),
                "avatar": {k: v for k, v in o["avatar"].items() if k != "etiquetas"},
                "iconos_tamanos": o["iconos"]["tamanos"]}
    pack = {
        "id": a.id,
        "version": "0.1.0",
        "estilo": a.estilo,
        "descripcion": "",
        "proyeccion": base["proyeccion"],
        "collides": base["collides"],
        "referencia_escala": None,
        "exportador": base["exportador"],
        "blender_extra": [],
        "avatar": dict(base["avatar"], etiquetas={}),
        "iconos": {"_": "hojas: imagen de fuentes/iconos/ -> ids en orden de lectura ('-' = no se entrega). alias: copia de otro icono.",
                   "tamanos": base["iconos_tamanos"], "hojas": [], "alias": {}},
        "derivados": {"_": "imágenes de entregas/ que se sacan de otra (ver packs/medieval-v1/pack.json)", "imagenes": []},
        "objetos": {"_": "colgados: prefijos de frames que cuelgan de un muro. alias: frame pedido -> frame que lo sustituye.",
                    "colgados": [], "alias": {}},
        "fx": [],
        "notas_salida": [],
    }
    pack["_referencia_escala"] = "FBX del personaje de escala en las salas de prueba (p. ej. personajes/<id>/mixamo/idle.fbx); null = sin personaje"
    escribir(dest / "pack.json", json.dumps(pack, indent=2, ensure_ascii=False) + "\n")
    escribir(dest / "tiles.json", json.dumps({"_": f"nombre del juego -> preset de tiles ({a.estilo}/<preset>)"}, indent=2) + "\n")
    escribir(dest / "objetos.json", json.dumps({
        "_": "render: configuración de render_objeto.py por objeto (glb relativo a fuentes/, escala [eje, metros], encuadre [ortho, zc], frames {estado: frame}, orientaciones, salida). empaquetar: grupos de empaquetar_objeto.py (render = carpeta de renders/, ortho, zc, frames {frame del juego: [frame del render, orientación]}). Ejemplo: packs/medieval-v1/objetos.json.",
        "estados_activos": ["abierto", "abierta", "encendido", "activa", "movido", "hundida"],
        "render": {}, "empaquetar": {}}, indent=1, ensure_ascii=False) + "\n")
    escribir(dest / "pared.json", json.dumps({
        "_": "piezas: frame -> [imagen de fuentes/pared/, alto real en m, altura del centro, grosor del tablero; 0 = tela]. salidas: PARTE -> carpeta de renders/.",
        "encuadre": {"ortho": 3.0, "centro_z": 1.0}, "salidas": {"todas": "pared"}, "piezas": {}}, indent=1, ensure_ascii=False) + "\n")
    escribir(dest / "blender" / "objetos.py", OBJETOS_PY.format(id=a.id))
    escribir(dest / "blender" / "pared.py", PARED_PY.format(id=a.id))
    escribir(dest / "CLAUDE.md", f"""# Pack `{a.id}`

Estilo `{a.estilo}` (`../../estilos/{a.estilo}/`). Herramienta y estructura: `../../CLAUDE.md`.

## Requisitos del juego
- (pendiente)

## Decisiones
- (pendiente)
""")
    escribir(dest / "docs" / "personajes.md", f"# Fichas de personaje — pack `{a.id}`\n\nEstilo y plantillas de prompt: `estilos/{a.estilo}/biblia.md`.\n")
    for d in ("fuentes/personajes", "fuentes/objetos", "fuentes/pared", "fuentes/iconos", "fuentes/fx",
              "entregas/objetos", "entregas/iconos", "entregas/avatares", "entregas/fx"):
        escribir(dest / d / ".gitkeep", "")
    print(f"creado packs/{a.id} (estilo {a.estilo}). Siguiente: python3 scripts/comun/validar.py --pack {a.id}")


if __name__ == "__main__":
    main()
