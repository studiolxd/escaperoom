"""
Trazabilidad de las fuentes: resumen de las fichas de un pack (modelo, pasos y créditos de cada master) y aviso de
los masters sin ficha.

Uso (desde assets-generator/):  python3 scripts/fichas.py [--pack <id>]

Dónde van las fichas (una por master, al lado de sus fuentes):
- fuentes/personajes/<id>/ficha.json y fuentes/objetos/<id>/ficha.json
- fuentes/pared/fichas.json y fuentes/iconos/fichas.json (un objeto por imagen o grupo)
Formato: {"asset", "space": {"nombre", "url"}, "proceso", "pasos": [{"paso", "herramienta", "modelo", "creditos",
"fecha", "magnific" (id de la creación), "prompt", "referencias", "notas"}], "creditos_total", "notas"}.
Añadir el paso a la ficha cada vez que se genera o se retoca algo en Magnific (y la creación al Space del pack).
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "comun"))
import contexto  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack")
    a = ap.parse_args()
    pack = contexto.cargar(a.pack)
    fu = pack.fuentes
    total, sin = 0, []
    print(f"== fichas de packs/{pack.id}")
    for tipo in ("personajes", "objetos"):
        for d in sorted(p for p in (fu / tipo).glob("*") if p.is_dir()):
            f = d / "ficha.json"
            if not f.exists():
                sin.append(f"{tipo}/{d.name}")
                continue
            fi = json.loads(f.read_text())
            modelos = sorted({p.get("modelo") for p in fi["pasos"] if p.get("modelo")})
            total += fi.get("creditos_total", 0)
            print(f"  {tipo}/{d.name:14} {len(fi['pasos'])} pasos  {fi.get('creditos_total', 0):5} créditos  {', '.join(modelos)}")
    for tipo, ext in (("pared", "*.png"), ("iconos", "*.png")):
        f = fu / tipo / "fichas.json"
        fichas = json.loads(f.read_text()) if f.exists() else {}
        cub = {Path(v["asset"]).stem for k, v in fichas.items() if not k.startswith("_")} | set(fichas)
        for k, v in fichas.items():
            if not k.startswith("_"):
                total += v.get("creditos_total", sum(p.get("creditos", 0) for p in v.get("pasos", [])))
        print(f"  {tipo}: {len([k for k in fichas if not k.startswith('_')])} fichas")
        if tipo == "iconos":
            sin += [f"{tipo}/{p.name}" for p in sorted((fu / tipo).glob(ext)) if p.stem not in cub]
    print(f"créditos registrados: {total}")
    if sin:
        print(f"sin ficha ({len(sin)}):")
        for s in sin:
            print("  -", s)


if __name__ == "__main__":
    main()
