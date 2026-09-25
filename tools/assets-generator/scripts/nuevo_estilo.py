"""
Crea la estructura de un estilo nuevo.

Uso (desde assets-generator/):  python3 scripts/nuevo_estilo.py <id> [--desde <estilo>] [--sin-3d]

--desde copia estilo.json de otro estilo (cámara, luz, escala, personajes...) para ajustarlo; por defecto,
castillo-toon. --sin-3d crea un estilo solo de tiles (como vector-plano). La estética de tiles empieza vacía
(hereda los valores por defecto de cada tipo): crear presets con
`python3 scripts/tiles/tilegen.py new <tipo> <nombre> --estilo <id>`.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "comun"))
import contexto  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--desde", default="castillo-toon")
    ap.add_argument("--sin-3d", action="store_true")
    a = ap.parse_args()
    dest = contexto.ESTILOS / a.id
    if dest.exists():
        sys.exit(f"ya existe {dest}")
    if a.sin_3d:
        estilo = {"nombre": a.id, "descripcion": "Estilo solo de tiles."}
    else:
        estilo = json.loads((contexto.ESTILOS / a.desde / "estilo.json").read_text())
        estilo["nombre"], estilo["descripcion"] = a.id, f"(pendiente; parte de {a.desde})"
    (dest / "tiles" / "presets").mkdir(parents=True)
    (dest / "referencias").mkdir()
    (dest / "estilo.json").write_text(json.dumps(estilo, indent=2, ensure_ascii=False) + "\n")
    (dest / "tiles" / "estetica.json").write_text(json.dumps(
        {"nombre": a.id, "descripcion": "(pendiente)", "tipos": {}}, indent=2, ensure_ascii=False) + "\n")
    (dest / "tiles" / "presets" / ".gitkeep").write_text("")
    (dest / "referencias" / ".gitkeep").write_text("")
    (dest / "biblia.md").write_text(f"""# Biblia del estilo `{a.id}`

Fuente de verdad visual del estilo (ejemplo completo: `estilos/castillo-toon/biblia.md`).

## 1. Reglas generales
| Tema | Regla |
|---|---|
| Estilo | |
| Contorno | |
| Proporciones | |
| Luz | |
| Sombra | |
| Color | |

## 2. Caras

## 3. Master de cada personaje (vista, formato, plantilla de prompt, modelo)

## 4. Sprites de juego

## 5. Iconos de inventario
""")
    print(f"creado estilos/{a.id}" + ("" if a.sin_3d else f" (estilo.json copiado de {a.desde}: ajustarlo)"))


if __name__ == "__main__":
    main()
