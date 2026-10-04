#!/usr/bin/env python3
"""
Exporta modelos 3D del pack para el modo 3D: Blender -> GLB sin optimizar (renders/glb/) -> optimizado
(packages/web/public/packs/<pack>/models|avatars/<id>.glb) + informe (renders/glb/informe.json).

Uso (desde assets-generator/):
    python3 scripts/exportar_3d.py --muestra                    # los siete modelos de muestra del encargo 7.3
    python3 scripts/exportar_3d.py --todo                        # todo lo de abajo + el catálogo (encargo 7.10a)
    python3 scripts/exportar_3d.py --objeto arca [--objeto ...]  # objetos de objetos.json (un GLB por estado)
    python3 scripts/exportar_3d.py --kit                         # el kit completo (spec §4.1)
    python3 scripts/exportar_3d.py --pared                       # piezas de pared (pared.json y las de la bodega)
    python3 scripts/exportar_3d.py --suelo                       # objetos pequeños de suelo (llave, yesquero, antorcha)
    python3 scripts/exportar_3d.py --avatar caballero-m
    python3 scripts/exportar_3d.py --catalogo                    # solo regenera el catálogo (generar_catalogo_3d.mjs)

`--todo` exporta los 24 objetos de objetos.json, el kit, las piezas de pared, los objetos de suelo y el caballero,
optimiza los GLB y regenera packages/shared/src/packs/<pack>.models3d.json desde packs/<pack>/modelos3d.json.

Presupuesto (specs/27 §7.1): objetos <= 2 MB y <= 30.000 triángulos con texturas <= 1024 px; avatar <= 4 MB y
<= 40.000 triángulos. Si un modelo se pasa, se deja en el mejor compromiso y el informe lo marca ("fuera_de_presupuesto").
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "comun"))
import contexto  # noqa: E402

RAIZ = contexto.ROOT
REPO = RAIZ.parents[1]
PRESUPUESTO = {"objeto": {"bytes": 2 * 1024 * 1024, "tris": 30000, "tex": 1024},
               "avatar": {"bytes": 4 * 1024 * 1024, "tris": 40000, "tex": 1024}}
MUESTRA = {"objetos": ["arca", "brasero"], "kit": ["muro", "suelo-piedra-1"], "avatares": ["caballero-m"]}


def blender(pack, script, entorno, ruta_blender):
    """Ejecuta un script de Blender y devuelve los GLBINFO que imprime."""
    env = {**os.environ, "PACK": pack.id, **entorno}
    r = subprocess.run([ruta_blender, "-b", "--python", str(RAIZ / "scripts" / "blender" / script)],
                       cwd=RAIZ, env=env, capture_output=True, text=True)
    if r.returncode != 0 or "Traceback" in r.stdout + r.stderr or f"OK {Path(script).stem}" not in r.stdout:
        sys.exit(f"{script} falló ({entorno}):\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    return [json.loads(l[len("GLBINFO "):]) for l in r.stdout.splitlines() if l.startswith("GLBINFO ")]


def optimizar(entrada, salida, tipo):
    p = PRESUPUESTO[tipo]
    salida.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["node", "scripts/optimizar_glb.mjs", str(entrada), str(salida), "--tex", str(p["tex"]),
                        "--tris", str(p["tris"])], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"optimizar_glb.mjs falló con {entrada}:\n{r.stdout}\n{r.stderr}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pack")
    ap.add_argument("--muestra", action="store_true")
    ap.add_argument("--objeto", action="append", default=[])
    ap.add_argument("--kit", action="store_true")
    ap.add_argument("--pared", action="store_true")
    ap.add_argument("--suelo", action="store_true")
    ap.add_argument("--todo", action="store_true")
    ap.add_argument("--catalogo", action="store_true")
    ap.add_argument("--avatar", action="append", default=[])
    a = ap.parse_args()
    pack = contexto.cargar(a.pack)
    objetos, avatares = list(a.objeto), list(a.avatar)
    kit = "todo" if a.kit else []          # "todo" o la lista de piezas del kit
    pared, suelo = a.pared, a.suelo
    if a.muestra:
        objetos += [o for o in MUESTRA["objetos"] if o not in objetos]
        kit = kit or MUESTRA["kit"]
        avatares += [v for v in MUESTRA["avatares"] if v not in avatares]
    if a.todo:
        objetos += [o for o in pack.json("objetos.json")["render"] if o not in objetos]
        kit, pared, suelo = "todo", True, True
        avatares += [v for v in MUESTRA["avatares"] if v not in avatares]
    if not (objetos or kit or avatares or pared or suelo):
        if a.catalogo:
            return catalogo(pack)
        ap.error("indica qué exportar (--muestra, --todo, --objeto, --kit, --pared, --suelo, --avatar, --catalogo)")

    b = contexto.blender()
    pub = REPO / "packages" / "web" / "public" / "packs" / pack.id
    informe = []
    t0 = time.time()

    trabajos = []   # (info de Blender, carpeta de salida, tipo)
    for o in objetos:
        trabajos += [(i, "models", "objeto") for i in blender(pack, "exportar_glb.py", {"OBJ": o}, b)]
    if kit:
        piezas = "" if kit == "todo" else ",".join(kit)
        trabajos += [(i, "models", "objeto") for i in blender(pack, "exportar_kit.py", {"KIT": piezas}, b)]
    if pared:
        trabajos += [(i, "models", "objeto") for i in blender(pack, "exportar_pared_glb.py", {}, b)]
    for v in avatares:
        trabajos += [(i, "avatars", "avatar") for i in blender(pack, "exportar_avatar.py", {"PERSONAJE": v}, b)]

    for info, carpeta, tipo in trabajos:
        entrada = Path(info["file"])
        salida = pub / carpeta / entrada.name
        r = optimizar(entrada, salida, tipo)
        p = PRESUPUESTO[tipo]
        r["id"] = entrada.stem
        r["file"] = str(salida.relative_to(REPO))
        r["sin_optimizar_bytes"] = entrada.stat().st_size
        r["horneados"] = info.get("horneados", [])
        r["segundos_blender"] = info["segundos"]
        fuera = []
        if r["bytes"] > p["bytes"]:
            fuera.append(f"peso {r['bytes']} > {p['bytes']}")
        if r["triangles"] > p["tris"]:
            fuera.append(f"triángulos {r['triangles']} > {p['tris']}")
        if any(max(t["w"], t["h"]) > p["tex"] for t in r["textures"]):
            fuera.append(f"textura > {p['tex']} px")
        r["fuera_de_presupuesto"] = fuera
        informe.append(r)
        print(json.dumps(r, ensure_ascii=False))

    ruta = pack.renders / "glb" / "informe.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(informe, indent=2, ensure_ascii=False) + "\n")
    print(f"OK {len(informe)} modelos en {time.time() - t0:.0f} s -> {ruta}")
    if a.todo or a.catalogo:
        catalogo(pack)


def catalogo(pack):
    """Regenera el catálogo versionado del pack con el generador (mide los GLB optimizados)."""
    r = subprocess.run(["node", "scripts/generar_catalogo_3d.mjs", "--pack", pack.id], cwd=RAIZ, capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        sys.exit(f"generar_catalogo_3d.mjs falló:\n{r.stderr}")


if __name__ == "__main__":
    main()
