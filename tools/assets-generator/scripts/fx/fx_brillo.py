"""
Generador de brillos (fx): estrella de 4 puntas con halo y núcleo blanco que aparece, gira un poco y se apaga, con
dos estrellas satélite desfasadas. Para marcar objetos interactuables; reutilizable en cualquier pack o estilo.

Uso (desde assets-generator/):
    python3 scripts/fx/fx_brillo.py [--pack <id>] [--key fx-spark] [--salida <carpeta>]

Parámetros: el "generador" de la entrada de "fx" de pack.json con esa key (si lo tiene), sobre los de BASE:
color (RGB), nucleo (RGB), fotogramas, tamano_1x ([ancho, alto]), giro_deg, satelites (bool).
Salida por defecto: packs/<pack>/renders/fx/<key>/{1x,2x}/<key>-<n>.png + preview.png. Para entregarlo, copiarlo a
fuentes/fx/<key>/ y añadir la copia a "derivados" de pack.json (como fx-spark de medieval-v1, que se dibujó a mano).
"""
import argparse
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "comun"))
import contexto  # noqa: E402

BASE = {"color": [255, 205, 80], "nucleo": [255, 250, 225], "fotogramas": 16, "tamano_1x": [64, 64],
        "giro_deg": 25, "satelites": True}
SS = 8   # supermuestreo


def estrella(draw, cx, cy, r, grosor, ang, color):
    """Estrella de 4 puntas: rombos finos cruzados (punta larga r, cintura r·grosor)."""
    pts = []
    for k in range(8):
        a = ang + k * math.pi / 4
        rr = r if k % 2 == 0 else r * grosor
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    draw.polygon(pts, fill=color)


def fotograma(i, n, p, lado):
    """Fotograma i (1..n) a `lado` px: la estrella crece y se apaga con una campana; los satélites, desfasados."""
    W = lado * SS
    capa = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    halo = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    t = (i - 0.5) / n
    s = math.sin(math.pi * t)                              # 0 -> 1 -> 0
    ang = math.radians(p["giro_deg"]) * (t - 0.5) - math.pi / 2
    col = tuple(p["color"]) + (255,)
    dc, dh = ImageDraw.Draw(capa), ImageDraw.Draw(halo)
    c = W / 2
    r = 0.46 * W * s
    if r > 0.5:
        estrella(dh, c, c, r * 1.08, 0.3, ang, tuple(p["color"]) + (150,))
        estrella(dc, c, c, r, 0.2, ang, col)
        rn = r * 0.13
        dc.ellipse((c - rn, c - rn, c + rn, c + rn), fill=tuple(p["nucleo"]) + (255,))
    if p["satelites"]:
        for fase, (fx, fy), escala in ((0.25, (0.78, 0.22), 0.2), (0.4, (0.2, 0.72), 0.16)):
            ts = min(max((t - fase * 0.5) / 0.75, 0), 1)
            ss = math.sin(math.pi * ts)
            if ss > 0.05:
                estrella(dc, fx * W, fy * W, escala * W * ss, 0.25, ang * 1.5, tuple(p["color"]) + (int(200 * ss),))
    halo = halo.filter(ImageFilter.GaussianBlur(W * 0.02))
    out = Image.alpha_composite(halo, capa)
    return out.resize((lado, lado), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack")
    ap.add_argument("--key", default="fx-spark")
    ap.add_argument("--salida")
    a = ap.parse_args()
    PACK = contexto.cargar(a.pack)
    entrada = next((f for f in PACK.cfg.get("fx", []) if f["key"] == a.key), {})
    p = dict(BASE, **entrada.get("generador", {}))
    if "fotogramas" in entrada:
        p["fotogramas"] = entrada["fotogramas"]
    if "tamano_1x" in entrada:
        p["tamano_1x"] = entrada["tamano_1x"]
    out = Path(a.salida) if a.salida else PACK.renders / "fx" / a.key
    n, lado1 = p["fotogramas"], p["tamano_1x"][0]
    prev = Image.new("RGB", (lado1 * 2 * 8, lado1 * 2 * math.ceil(n / 8)), (11, 17, 32))
    for i in range(1, n + 1):
        for tag, lado in (("1x", lado1), ("2x", lado1 * 2)):
            (out / tag).mkdir(parents=True, exist_ok=True)
            im = fotograma(i, n, p, lado)
            im.save(out / tag / f"{a.key}-{i}.png")
            if tag == "2x":
                prev.paste(im, (((i - 1) % 8) * lado, ((i - 1) // 8) * lado), im)
    prev.save(out / "preview.png")
    print(out, n, "fotogramas")


if __name__ == "__main__":
    main()
