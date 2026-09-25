"""
Verificación de un pack: regenera todo desde fuentes/ en una carpeta temporal y lo compara con lo entregado.
Sirve para tocar el código (scripts, estilo, pack) sin miedo: si algo cambia, lo dice.

Uso (desde assets-generator/):
    python3 scripts/verificar.py [--pack <id>] [--rapido] [--jobs 2] [--solo objetos,pared,personajes,extra] [--tmp <dir>]

Pasos:
1. Validación de la configuración (scripts/comun/validar.py) y versión de Blender (entorno.json).
2. Renders de Blender de todos los objetos, paredes, personajes y "blender_extra" del pack en <tmp>/renders (con --rapido se usan los de
   packs/<pack>/renders sin volver a renderizar).
3. Empaquetado de objetos, avatares, iconos y derivados en <tmp>/entregas y comparación con packs/<pack>/entregas:
   PNG píxel a píxel, JSON por contenido (los .md se escriben a mano y no se comparan).
4. Carpeta del pack para el juego en <tmp>/salida y comparación con packs/<pack>/salida (si existe).
Termina con código 1 si hay diferencias.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageChops

sys.path.insert(0, str(Path(__file__).resolve().parent / "comun"))
import contexto  # noqa: E402
import validar  # noqa: E402

ROOT = contexto.ROOT


def run(cmd, env=None, log=None):
    r = subprocess.run(cmd, cwd=ROOT, env=dict(os.environ, **(env or {})), capture_output=True, text=True)
    if log:
        Path(log).write_text(r.stdout + r.stderr)
    if r.returncode != 0:
        raise RuntimeError(f"falló {' '.join(map(str, cmd))} {env or ''}\n{(r.stdout + r.stderr)[-1500:]}")
    return r.stdout


def comparar(base, nuevo, ignorar=(".md",)):
    """Diferencias entre dos carpetas: PNG por píxeles, JSON por contenido, el resto byte a byte."""
    def archivos(d):
        return {p.relative_to(d) for p in d.rglob("*") if p.is_file() and p.suffix not in ignorar and not p.name.startswith(".")}
    fa, fb = archivos(base), archivos(nuevo)
    dif = []
    for r in sorted(fa & fb):
        x, y = base / r, nuevo / r
        if r.suffix == ".png":
            ix, iy = Image.open(x), Image.open(y)
            if ix.size != iy.size or ImageChops.difference(ix.convert("RGBA"), iy.convert("RGBA")).getbbox():
                dif.append(f"distinto  {r}")
        elif r.suffix == ".json":
            if json.loads(x.read_text()) != json.loads(y.read_text()):
                dif.append(f"distinto  {r}")
        elif x.read_bytes() != y.read_bytes():
            dif.append(f"distinto  {r}")
    dif += [f"falta     {r}" for r in sorted(fa - fb)] + [f"sobra     {r}" for r in sorted(fb - fa)]
    return len(fa & fb), dif


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack")
    ap.add_argument("--rapido", action="store_true", help="no renderiza: usa packs/<pack>/renders")
    ap.add_argument("--jobs", type=int, default=2, help="renders de Blender en paralelo")
    ap.add_argument("--solo", help="partes de Blender a renderizar: objetos,pared,personajes,extra")
    ap.add_argument("--tmp")
    a = ap.parse_args()
    t0 = time.time()
    pack = contexto.Pack(contexto.pack_id(a.pack), validar=False)
    print(f"== verificar packs/{pack.id} (estilo {pack.estilo.id})")

    if not any(pack.fuentes.rglob("*.glb")) or not any(pack.entregas.rglob("*.png")):
        print(f"faltan los binarios locales de packs/{pack.id}/fuentes/ o entregas/ (no están en git): copiarlos "
              "de pipeline-assets o del almacenamiento que se decida")
        sys.exit(1)
    errores = validar.validar(pack)
    if errores:
        print("configuración incorrecta:\n  - " + "\n  - ".join(errores))
        sys.exit(1)
    print("configuración: correcta")

    tmp = Path(a.tmp) if a.tmp else Path(tempfile.mkdtemp(prefix=f"verificar-{pack.id}-"))
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "logs").mkdir(exist_ok=True)
    renders = pack.renders if a.rapido else tmp / "renders"
    print(f"carpeta temporal: {tmp}")

    # --- renders de Blender ---
    if not a.rapido:
        blender = contexto.blender()
        solo = set(a.solo.split(",")) if a.solo else {"objetos", "pared", "personajes", "extra"}
        tareas = []
        base = {"PACK": pack.id}
        if "objetos" in solo and (pack.dir / "objetos.json").exists():
            for k, v in pack.json("objetos.json")["render"].items():
                tareas.append((f"objeto {k}", dict(base, OBJ=k),
                               ["scripts/blender/render_objeto.py", renders / v.get("salida", k)]))
        if "pared" in solo and (pack.dir / "pared.json").exists():
            for parte, carpeta in pack.json("pared.json")["salidas"].items():
                tareas.append((f"pared {parte}", dict(base, PARTE=parte),
                               ["scripts/blender/render_pared.py", renders / carpeta]))
        if "personajes" in solo:
            for pj in sorted(p.name for p in (pack.fuentes / "personajes").glob("*") if p.is_dir()):
                src = pack.fuentes / "personajes" / pj / "mixamo"
                tareas.append((f"personaje {pj}", dict(base, PERSONAJE=pj),
                               ["scripts/blender/render_animaciones.py", src, renders / pj, pj.replace("-", "_")]))

        if "extra" in solo:
            for x in pack.cfg.get("blender_extra", []):
                tareas.append((f"extra {x['salida']}", base, [pack.dir / x["script"], renders / x["salida"]]))

        def blender_run(t):
            nombre, env, (script, *args) = t
            run([blender, "-b", "--python", script, "--", *map(str, args)], env,
                log=tmp / "logs" / f"{nombre.replace(' ', '_')}.txt")
            return nombre

        print(f"renders de Blender: {len(tareas)} tareas, {a.jobs} en paralelo")
        with ThreadPoolExecutor(a.jobs) as ex:
            for i, nombre in enumerate(ex.map(blender_run, tareas), 1):
                print(f"  [{i}/{len(tareas)}] {nombre}", flush=True)

    # --- entregas ---
    ent = tmp / "entregas"
    py, pk = sys.executable, ["--pack", pack.id]
    if (pack.dir / "objetos.json").exists():
        run([py, "scripts/empaquetar/empaquetar_objeto.py", *pk, "--todos", "--renders", renders, "--salida", ent / "objetos"])
    for pj in sorted(p.name for p in (pack.fuentes / "personajes").glob("*") if p.is_dir()):
        run([py, "scripts/empaquetar/empaquetar_avatar.py", *pk, pj, "--render", renders / pj, "--salida", ent / "avatares"])
    if pack["iconos"].get("hojas"):
        run([py, "scripts/empaquetar/empaquetar_iconos.py", *pk, "--salida", ent / "iconos"])
    run([py, "scripts/empaquetar/empaquetar_derivados.py", *pk, "--salida", ent, "--renders", renders])
    n, dif = comparar(pack.entregas, ent)
    print(f"entregas: {n} archivos comparados, {len(dif)} diferencias")
    for d in dif[:40]:
        print("  ", d)

    # --- carpeta del pack para el juego ---
    run([py, "scripts/empaquetar/empaquetar_pack.py", *pk, "--salida", tmp / "salida"])
    dif_s = []
    if pack.salida.exists():
        n_s, dif_s = comparar(pack.salida, tmp / "salida")
        print(f"salida: {n_s} archivos comparados, {len(dif_s)} diferencias")
        for d in dif_s[:20]:
            print("  ", d)
    else:
        print("salida: generada (no había packs/<pack>/salida con la que comparar)")

    print(f"== {'SIN DIFERENCIAS' if not dif and not dif_s else 'HAY DIFERENCIAS'} ({time.time() - t0:.0f} s)")
    sys.exit(1 if dif or dif_s else 0)


if __name__ == "__main__":
    main()
