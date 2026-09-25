#!/usr/bin/env python3
"""
tilegen — generador de tiles isométricos 2:1 en SVG (rombo a sangre, fondo transparente).

Cada tile se dibuja en un "suelo" de 8×8 unidades proyectado a isométrico
(viewBox 128×64). Las texturas son periódicas en ese cuadrado, por lo que los
tiles encajan entre sí al repetirlos en un tablero iso.

Uso (desde assets-generator/). Todo preset se nombra <estilo>/<nombre> (vector-plano/piedra-1 =
estilos/vector-plano/tiles/presets/piedra-1.json -> estilos/vector-plano/renders/svg/piedra-1.svg):
  python3 scripts/tiles/tilegen.py build castillo-toon/piedra-1
  python3 scripts/tiles/tilegen.py build --all               # todos los presets de todos los estilos (+ export de todo)
  python3 scripts/tiles/tilegen.py new piedra castillo-toon/piedra-3 --seed 5 --set grid=4 --set jitter=0.6
  python3 scripts/tiles/tilegen.py new piedra piedra-3 --estilo castillo-toon   # igual, con el estilo aparte
  python3 scripts/tiles/tilegen.py list                      # presets y sus parámetros
  python3 scripts/tiles/tilegen.py defaults piedra           # parámetros por defecto de un tipo
  python3 scripts/tiles/tilegen.py svg vector-plano/pared-3 --set arms='["-u","+v"]'   # SVG a stdout con overrides (sin guardar)
  python3 scripts/tiles/tilegen.py esteticas                 # estilos con tiles
  python3 scripts/tiles/tilegen.py export --pack medieval-v1 # packs/medieval-v1/tiles.json -> packs/medieval-v1/renders/tiles/{tiles,sprites,…}
  python3 scripts/tiles/tilegen.py export --estilo vector-plano   # estilos/vector-plano/tiles/pack.json -> estilos/vector-plano/renders/pack/

Estilos: los tiles de un estilo viven en estilos/<id>/tiles/: estetica.json (paleta y proporciones de cada tipo:
colores de piedra, madera, mortero, alto de muro, tamaño de sillar…) y presets/. Un preset hereda de su estética y
solo guarda lo que cambia: defaults del tipo <- estetica.tipos[tipo] <- params del preset. Un parámetro que nombra
otro preset (floor_preset) sin prefijo se refiere al mismo estilo. Un pack (packs/<id>/tiles.json) mapea sus
nombres del juego a presets; un estilo puede tener su propio mapa de demostración (estilos/<id>/tiles/pack.json;
vector-plano, la estética original con los sprites de sprites.py, lo tiene).
"""
import argparse, base64, json, math, random, struct, sys, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # assets-generator/
ESTILOS = ROOT / "estilos"             # estilos/<id>/tiles/{estetica.json,presets/} y estilos/<id>/renders/svg/ (generado)
PACKS = ROOT / "packs"                 # packs/<id>/tiles.json: nombre-del-juego -> preset; export a packs/<id>/renders/tiles/


def _partes(name):
    """(estilo, nombre dentro del estilo) de un preset o de un SVG generado: siempre <estilo>/<nombre>."""
    if "/" not in name:
        sys.exit(f"preset sin estilo: {name!r} (usa <estilo>/<nombre>, p. ej. castillo-toon/piedra-1)")
    return tuple(name.split("/", 1))


def preset_path(name):
    e, n = _partes(name)
    return ESTILOS / e / "tiles" / "presets" / f"{n}.json"


def svg_path(name):
    e, n = _partes(name)
    return ESTILOS / e / "renders" / "svg" / f"{n}.svg"

L = 8.0  # lado del suelo
HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64" width="128" height="64">\n'
ISO = "matrix(8 -4 8 4 0 32)"  # suelo [0,8]² -> rombo (0,32) (64,0) (128,32) (64,64)

CLIP = '<defs><clipPath id="rombo"><polygon points="64,0 128,32 64,64 0,32"/></clipPath></defs>\n'


def rgb(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(v))) for v in c)


def shift(c, d):
    return [v + d for v in c]


def fmt(poly):
    return " ".join("%.3f,%.3f" % p for p in poly)


NOISE_PX = 256  # lado en px de la imagen de ruido (cubre el suelo 8×8)


def _png_la(w, h, rows):
    """PNG 8 bits gris+alfa. rows: lista de bytes (2 bytes por píxel)."""
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + r for r in rows)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 4, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _value_noise(w, h, nx, ny, octaves, seed):
    """Value noise fractal periódico en un toro w×h px: nx×ny celdas en la
    octava base (enteras -> periódico exacto), cada octava dobla celdas y
    reduce la amplitud a la mitad. Devuelve floats en [0,1]."""
    acc = [[0.0] * w for _ in range(h)]
    total = 0.0
    for o in range(octaves):
        cx, cy, amp = nx << o, ny << o, 0.5 ** o
        total += amp
        rnd = random.Random(seed * 1000 + o)
        lat = [[rnd.random() for _ in range(cx)] for _ in range(cy)]
        for j in range(h):
            v = j * cy / h
            j0 = int(v); tv = v - j0; tv = tv * tv * (3 - 2 * tv)
            r0, r1 = lat[j0 % cy], lat[(j0 + 1) % cy]
            row = acc[j]
            for i in range(w):
                u = i * cx / w
                i0 = int(u); tu = u - i0; tu = tu * tu * (3 - 2 * tu)
                a = r0[i0 % cx] + (r0[(i0 + 1) % cx] - r0[i0 % cx]) * tu
                b = r1[i0 % cx] + (r1[(i0 + 1) % cx] - r1[i0 % cx]) * tu
                row[i] += amp * (a + (b - a) * tv)
    # El value noise es más contrastado que el fractalNoise de feTurbulence al
    # que sustituye (distribución uniforme vs. gaussiana estrecha); se comprime
    # alrededor de 0.5 para que los presets mantengan la sutileza original.
    return [[0.5 + (v / total - 0.5) * 0.6 for v in row] for row in acc]


def noise_layer(freq, octaves, seed, alpha, offset, color=(0, 0, 0), opacity=0.5,
                box=(0, 0, L, L), transform=ISO, px=(8.944, 8.944)):
    """Capa de ruido sutil, periódica en el suelo (periodo 8 en u y v = el tile).

    `box`/`transform`/`px` permiten usarla en otro espacio (p. ej. una cara de
    muro en `gen_pared`): box=(x,y,w,h) en unidades de ese espacio y px = px de
    pantalla por unidad en cada eje, para que la densidad del ruido en pantalla
    sea la misma que en el suelo. El ruido es periódico en ambos ejes del box.

    Antes era feTurbulence con stitchTiles. Dos problemas: (1) su periodo era
    la región de filtro (128×64), que no coincide con el desplazamiento entre
    tiles vecinos, así que el ruido no casaba en la juntura y se veía un
    escalón de color (la "línea" entre tiles); (2) probado a arreglarlo con
    cuadrantes de 64×32 (<pattern>, <use>, <g translate>): librsvg NO
    implementa bien stitchTiles, la costura entre cuadrantes aparece a casi
    cualquier escala. Ahora el ruido se genera aquí (value noise fractal sobre
    un toro de 8×8 unidades de suelo, celdas enteras -> periódico exacto) y se
    embebe como <image> PNG gris+alfa dentro del grupo ISO, igual que el resto
    del dibujo: el periodo es el tile entero (no se repite dentro del tile).
    `freq` (un valor o "fu fv") está en ciclos por unidad de pantalla como en
    feTurbulence; se convierte a celdas por 8 unidades de suelo (1 unidad de
    suelo ≈ 8.94 px) y se redondea a entero.
    """
    fu, fv = (freq.split() if isinstance(freq, str) else (freq, freq))
    bx, by, bw, bh = box
    nu, nv = max(1, round(bw * px[0] * float(fu))), max(1, round(bh * px[1] * float(fv)))
    w = h = NOISE_PX
    n = _value_noise(w, h, nu, nv, octaves, seed)
    g = round(0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2])
    rows = [bytes(sum(((g, max(0, min(255, round((alpha * v + offset) * 255)))) for v in row), ())) for row in n]
    uri = base64.b64encode(_png_la(w, h, rows)).decode()
    return (f'<g transform="{transform}" opacity="{opacity}"><image x="{bx:g}" y="{by:g}" width="{bw:g}" height="{bh:g}" '
            f'preserveAspectRatio="none" href="data:image/png;base64,{uri}"/></g>')


# ---------------------------------------------------------------- MADERA
MADERA_DEFAULTS = {
    "seed": 7,
    "planks": 4,              # tablones a lo ancho (eje v)
    "base": [150, 104, 62],   # color base RGB
    "shade_range": 14,        # variación de tono entre tablones
    "grain_lines": 5,         # vetas por tablón
    "noise_alpha": 0.55,
    "dir": "u",               # eje de los tablones: "u" (izq→arriba) o "v" (izq→abajo, girado 90°)
}


def gen_madera(p):
    rnd = random.Random(p["seed"])
    base = p["base"]
    swap = p.get("dir", "u") == "v"
    # dir="v": se intercambian u y v dentro del suelo (matrix(0 1 1 0)): los tablones
    # corren a lo largo de v y las vetas con ellos. El resto del código no cambia.
    out = [HEAD, CLIP, '<g clip-path="url(#rombo)">\n', f'<g transform="{ISO}">\n',
           '<g transform="matrix(0 1 1 0 0 0)">\n' if swap else '']
    n = p["planks"]
    w = L / n
    # fondo opaco bajo los tablones: sus lados diagonales compartidos se
    # rasterizan con alfa parcial y sin esto quedaría una junta semitransparente.
    out.append(f'<rect x="-1" y="-1" width="10" height="10" fill="{rgb(base)}"/>')
    for i in range(n):
        v0 = i * w
        sh = rnd.uniform(-p["shade_range"], p["shade_range"])
        col = (base[0] + sh, base[1] + sh * 0.8, base[2] + sh * 0.5)
        # los rect sobresalen 1 unidad del cuadrado; el clip del rombo recorta.
        # Y los tablones se solapan 0.06 (≈0.25 px): dos rect adyacentes con lado
        # diagonal compartido dejan alfa parcial (0.5·0.5) justo en la junta.
        y0, y1 = (v0 - 1 if i == 0 else v0), (v0 + w + 1 if i == n - 1 else v0 + w + 0.06)
        out.append(f'<rect x="-1" y="{y0:.2f}" width="10" height="{y1 - y0:.2f}" fill="{rgb(col)}"/>')
        dark = rgb((col[0] - 38, col[1] - 30, col[2] - 20))
        for k in range(p["grain_lines"]):
            vv = v0 + w * (k + 0.5) / p["grain_lines"] + rnd.uniform(-0.08, 0.08)
            amp = rnd.uniform(0.03, 0.09)
            ph = rnd.uniform(0, 6.28)
            cycles = rnd.choice([1, 2])  # entero -> misma fase en u=0 y u=L, la veta encaja entre tiles
            freq = 2 * math.pi * cycles / L
            pts = " ".join("%.2f,%.2f" % (L * s / 32, vv + amp * math.sin(L * s / 32 * freq + ph)) for s in range(33))
            out.append(f'<polyline points="{pts}" fill="none" stroke="{dark}" stroke-width="{rnd.uniform(0.05, 0.12):.2f}" opacity="{rnd.uniform(0.35, 0.7):.2f}" stroke-linecap="round"/>')
    out.append("</g></g>\n" if swap else "</g>\n")
    out.append(noise_layer("0.6 0.16" if swap else "0.16 0.6", 3, 3, p["noise_alpha"], -0.2) + "\n")
    out.append("</g>\n</svg>\n")
    return "".join(out)


# ---------------------------------------------------------------- PIEDRA (losas Voronoi periódicas)
PIEDRA_DEFAULTS = {
    "seed": 3,
    "grid": 3,                # semillas por lado (3 -> 9 losas por tile)
    "jitter": 0.9,            # desplazamiento aleatorio de cada semilla (unidades de suelo)
    "gray_min": 152,          # tono mínimo de losa
    "gray_max": 192,          # tono máximo
    "tint": [4, 4, 0],        # matiz sumado al gris (R,G,B)
    "mortar": "#3a3836",      # color de junta
    "gap": 0.14,              # medio grosor de junta
    "shadow": 40,             # oscurecido de la sombra inferior-derecha
    "highlight": 26,          # aclarado del filo superior-izquierdo
    "noise_alpha": 0.3,
}


def _halfplane(poly, a, b):
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    dx, dy = b[0] - a[0], b[1] - a[1]
    f = lambda q: (q[0] - mx) * dx + (q[1] - my) * dy
    out = []
    for k in range(len(poly)):
        p, q = poly[k], poly[(k + 1) % len(poly)]
        fp, fq = f(p), f(q)
        if fp <= 0:
            out.append(p)
        if (fp <= 0) != (fq <= 0):
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def _clip_normal(poly, point, normal):
    # recorta poly quedándose con el lado de la recta (por point, normal a `normal`) hacia el que apunta `normal`
    px, py = point
    nx, ny = normal
    f = lambda q: (q[0] - px) * nx + (q[1] - py) * ny
    out = []
    n = len(poly)
    for k in range(n):
        p, q = poly[k], poly[(k + 1) % n]
        fp, fq = f(p), f(q)
        if fp >= 0:
            out.append(p)
        if (fp >= 0) != (fq >= 0):
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def _inset(poly, d):
    # erosiona poly recortando sucesivamente cada arista desplazada d hacia dentro.
    # A diferencia de un simple miter-join por intersección de aristas consecutivas,
    # este recorte por semiplanos no puede autointersecarse: en losas puntiagudas donde
    # el inset excede el ancho local, el vértice simplemente desaparece en vez de generar
    # un polígono en forma de lazo (el defecto visual de "grieta" cruzando la losa).
    n = len(poly)
    cx = sum(q[0] for q in poly) / n
    cy = sum(q[1] for q in poly) / n
    xs = [q[0] for q in poly]
    ys = [q[1] for q in poly]
    res = [(min(xs) - 1, min(ys) - 1), (max(xs) + 1, min(ys) - 1),
           (max(xs) + 1, max(ys) + 1), (min(xs) - 1, max(ys) + 1)]
    for k in range(n):
        p, q = poly[k], poly[(k + 1) % n]
        ex, ey = q[0] - p[0], q[1] - p[1]
        ln = math.hypot(ex, ey) or 1
        nx, ny = -ey / ln, ex / ln
        if (cx - p[0]) * nx + (cy - p[1]) * ny < 0:
            nx, ny = -nx, -ny
        res = _clip_normal(res, (p[0] + nx * d, p[1] + ny * d), (nx, ny))
        if not res:
            return poly
    return res


def _area(poly):
    n = len(poly)
    return abs(sum(poly[k][0] * poly[(k + 1) % n][1] - poly[(k + 1) % n][0] * poly[k][1] for k in range(n))) / 2


def gen_piedra(p):
    rnd = random.Random(p["seed"])
    G, J = p["grid"], p["jitter"]
    seeds = [((i + 0.5) * L / G + rnd.uniform(-J, J), (j + 0.5) * L / G + rnd.uniform(-J, J)) for i in range(G) for j in range(G)]
    allpts = [(x + ox * L, y + oy * L) for (x, y) in seeds for ox in (-1, 0, 1) for oy in (-1, 0, 1)]
    cells = []
    for (x, y) in seeds:
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                a = (x + ox * L, y + oy * L)
                if not (-L * 0.6 < a[0] < L * 1.6 and -L * 0.6 < a[1] < L * 1.6):
                    continue
                poly = [(a[0] - L, a[1] - L), (a[0] + L, a[1] - L), (a[0] + L, a[1] + L), (a[0] - L, a[1] + L)]
                for b in allpts:
                    if b != a:
                        poly = _halfplane(poly, a, b)
                if len(poly) >= 3 and _area(poly) >= 0.12:
                    cells.append((poly, (x, y)))
    pal = {}
    for s in seeds:
        g = rnd.uniform(p["gray_min"], p["gray_max"])
        pal[s] = [g + t for t in p["tint"]]
    gap = p["gap"]
    out = [HEAD, CLIP,
           '<g clip-path="url(#rombo)">\n', f'<g transform="{ISO}">\n',
           f'<rect x="-8" y="-8" width="24" height="24" fill="{p["mortar"]}"/>\n']
    for (poly, s) in cells:
        c = pal[s]
        out.append(f'<polygon points="{fmt(_inset(poly, gap))}" fill="{rgb(c)}" stroke="{rgb(c)}" stroke-width="0.18" stroke-linejoin="round"/>')
        d = rgb(shift(c, -p["shadow"]))
        out.append(f'<polygon points="{fmt(_inset(poly, gap + 0.10))}" fill="{d}" stroke="{d}" stroke-width="0.10" stroke-linejoin="round"/>')
        out.append(f'<polygon points="{fmt(_inset(poly, gap + 0.16))}" fill="{rgb(c)}" stroke="{rgb(shift(c, p["highlight"]))}" stroke-width="0.10" stroke-linejoin="round" transform="translate(-0.08 -0.08)"/>')
    out.append("</g>\n")
    out.append(noise_layer(0.8, 2, 11, p["noise_alpha"], -0.08) + '\n</g>\n</svg>\n')
    return "".join(out)


# ---------------------------------------------------------------- ALFOMBRA (fieltro)
ALFOMBRA_DEFAULTS = {
    "seed": 5,
    "color": "#9c1b23",       # rojo base
    "weave_color": "#7a1218", # trama tejida
    "weave_step": 0.5,        # paso de la trama (unidades de suelo)
    "weave_opacity": 0.35,
    "fine_alpha": 0.6,        # grano fino
    "blotch_alpha": 0.25,     # manchas suaves claras
    "weave_width": 0.03,      # grosor de la trama
    "motif": "none",          # "none" | "cuadros" | "rombos" (ver gen_alfombra); punto central opcional
    "motif_step": 2,          # paso del motivo (debe dividir 8)
    "motif_color": "#6e1016",
    "motif_width": 0.07,
    "motif_opacity": 0.6,
    "motif_dot": 0.12,        # radio del punto central (0 = sin punto)
}


def gen_alfombra(p):
    s = p["weave_step"]
    out = [HEAD, CLIP, "<defs>",

           f'<pattern id="trama" patternUnits="userSpaceOnUse" width="{s}" height="{s}">'
           f'<line x1="0" y1="{s/2}" x2="{s}" y2="{s/2}" stroke="{p["weave_color"]}" stroke-width="{p.get("weave_width", 0.03)}" opacity="{p["weave_opacity"]}"/>'
           f'<line x1="{s/2}" y1="0" x2="{s/2}" y2="{s}" stroke="{p["weave_color"]}" stroke-width="{p.get("weave_width", 0.03)}" opacity="{p["weave_opacity"]}"/>'
           "</pattern></defs>\n",
           '<g clip-path="url(#rombo)">\n', f'<g transform="{ISO}">\n',
           f'<rect x="-1" y="-1" width="10" height="10" fill="{p["color"]}"/>',
           '<rect x="-1" y="-1" width="10" height="10" fill="url(#trama)"/>']
    motif = p.get("motif", "none")
    if motif in ("cuadros", "rombos"):
        # Retícula de paso m (m divide 8 -> periódico), líneas explícitas que sobresalen
        # del cuadrado (no <pattern>) y un punto en cada centro de celda. OJO con la
        # proyección iso: las diagonales del suelo u±v=c salen en pantalla como líneas
        # verticales/horizontales ("cuadros", cuadrícula tipo tartán), y las líneas
        # a lo largo de u y v salen como rombos ("rombos").
        m = p["motif_step"]
        st = f'stroke="{p["motif_color"]}" stroke-width="{p["motif_width"]}" opacity="{p["motif_opacity"]}"'
        n = int(L / m)
        if motif == "cuadros":
            k = 0
            while k * m <= 2 * L + 2:
                c = k * m
                out.append(f'<line x1="{c + 2:.2f}" y1="-2" x2="-2" y2="{c + 2:.2f}" {st}/>')      # u+v = c
                out.append(f'<line x1="{c - L - 2:.2f}" y1="-2" x2="{c + 2:.2f}" y2="{L + 2:.2f}" {st}/>')  # u−v = c−L
                k += 1
            centers = [((i + 0.5) * m, (j + 0.5) * m) for i in range(-1, n + 1) for j in range(-1, n + 1)]
        else:
            for k in range(0, n + 1):
                c = k * m
                out.append(f'<line x1="{c}" y1="-2" x2="{c}" y2="{L + 2:.2f}" {st}/>')   # u = c
                out.append(f'<line x1="-2" y1="{c}" x2="{L + 2:.2f}" y2="{c}" {st}/>')   # v = c
            centers = [((i + 0.5) * m, (j + 0.5) * m) for i in range(n) for j in range(n)]
        if p["motif_dot"] > 0:
            for (cx, cy) in centers:
                out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{p["motif_dot"]}" fill="{p["motif_color"]}" opacity="{p["motif_opacity"]}"/>')
    out += ["</g>\n",
           noise_layer(1.4, 3, p["seed"], p["fine_alpha"], -0.15) + '\n',
           noise_layer(0.25, 2, p["seed"] + 4, p["blotch_alpha"], -0.05, (255, 217, 204)) + '\n',
           "</g>\n</svg>\n"]
    return "".join(out)


# ---------------------------------------------------------------- CESPED
CESPED_DEFAULTS = {
    "seed": 9,
    "base": [141, 198, 63],       # verde lima del suelo (referencia)
    "patch_color": [104, 160, 48],  # manchas oscuras del suelo
    "patches": 10,                # número de manchas oscuras
    "patch_radius": [0.8, 1.8],   # radio de las manchas (unidades de suelo)
    "patch_opacity": 0.4,
    # tonos de las briznas, de oscuro a claro; se eligen con los pesos de abajo
    "tones": [[108, 166, 44], [138, 196, 60], [165, 214, 78], [196, 230, 108]],
    "tone_weights": [3, 4, 4, 2],
    "grid": 10,                   # mechones por lado (grid×grid)
    "jitter": 0.45,               # desplazamiento aleatorio de cada mechón (suelo)
    "blades_per_tuft": 5,         # briznas altas por mechón
    "under_blades": 3,            # briznas cortas oscuras en la base de cada mechón
    "blade_h_min": 5.0,           # alto de brizna en px de pantalla (viewBox 128×64)
    "blade_h_max": 15.0,
    "blade_width": 1.5,           # ancho en la base (px)
    "lean": 0.8,                  # inclinación máx. respecto a la vertical (rad)
    "bend": 0.45,                 # curvatura (fracción del alto)
    "noise_alpha": 0.28,
}


def _iso(u, v):
    """Punto de suelo -> pantalla (misma matriz que ISO)."""
    return 8 * u + 8 * v, -4 * u + 4 * v + 32


def gen_cesped(p):
    """Césped estilo referencia: suelo verde lima con manchas oscuras y briznas
    afiladas *erguidas* (formas rellenas en espacio de pantalla, no trazos en el
    suelo), en varios tonos, ordenadas por profundidad.

    Encaje: las raíces viven en el suelo [0,8]² y se replican en toroide; como
    la brizna se dibuja en pantalla relativa a su raíz proyectada, la copia
    toroidal equivale a desplazar la brizna por el retículo de tiles en
    pantalla (±64,∓32), así la brizna que sale por un lado del rombo entra por
    el tile vecino exactamente donde debe. El orden de pintado (por y de raíz)
    es el mismo en todas las copias, así que el solape también coincide.
    """
    rnd = random.Random(p["seed"])
    G, J = p["grid"], p["jitter"]
    tones, weights = p["tones"], p["tone_weights"]
    out = [HEAD, CLIP, '<g clip-path="url(#rombo)">\n']

    # --- suelo: base + manchas oscuras irregulares (en suelo, periódicas)
    out.append(f'<g transform="{ISO}"><rect x="-1" y="-1" width="10" height="10" fill="{rgb(p["base"])}"/>')
    r0, r1 = p["patch_radius"]
    for _ in range(p["patches"]):
        cu, cv = rnd.uniform(0, L), rnd.uniform(0, L)
        r = rnd.uniform(r0, r1)
        n = 14
        radii = [r * rnd.uniform(0.8, 1.15) for _ in range(n)]
        for ou in (-1, 0, 1):
            for ov in (-1, 0, 1):
                x, y = cu + ou * L, cv + ov * L
                if not (-r1 * 1.3 <= x <= L + r1 * 1.3 and -r1 * 1.3 <= y <= L + r1 * 1.3):
                    continue
                pts = [(x + math.cos(2 * math.pi * k / n) * radii[k], y + math.sin(2 * math.pi * k / n) * radii[k])
                       for k in range(n)]
                out.append(f'<polygon points="{fmt(pts)}" fill="{rgb(p["patch_color"])}" opacity="{p["patch_opacity"]}"/>')
    out.append("</g>\n")

    # --- briznas (pantalla), recogidas y ordenadas por profundidad
    tufts = [((i + 0.5) * L / G + rnd.uniform(-J, J), (j + 0.5) * L / G + rnd.uniform(-J, J))
             for i in range(G) for j in range(G)]
    blades = []
    hmax = p["blade_h_max"]
    for (u, v) in tufts:
        # parámetros por brizna, fijos para todas las copias toroidales
        spec = []
        # briznas cortas y anchas del tono más oscuro en la base (dan cuerpo al
        # mechón, como la zona sombreada bajo las briznas de la referencia)
        for _ in range(p["under_blades"]):
            spec.append((
                rnd.uniform(-1.2, 1.2), rnd.uniform(-0.4, 0.4),
                rnd.uniform(p["blade_h_min"] * 0.6, p["blade_h_min"] * 1.3),
                rnd.uniform(-p["lean"] * 1.3, p["lean"] * 1.3),
                rnd.uniform(-p["bend"], p["bend"]),
                0, 0.9, -0.6,                                          # tono 0, se pinta antes que las altas
            ))
        for _ in range(p["blades_per_tuft"]):
            spec.append((
                rnd.uniform(-0.8, 0.8), rnd.uniform(-0.3, 0.3),        # desplazamiento de raíz (px)
                rnd.uniform(p["blade_h_min"], hmax),                   # alto
                rnd.uniform(-p["lean"], p["lean"]),                    # inclinación
                rnd.uniform(-p["bend"], p["bend"]),                    # curvatura
                rnd.choices(range(len(tones)), weights)[0],            # tono
                rnd.uniform(0.85, 1.0),                                # opacidad
                0.0,                                                   # ajuste de orden de pintado
            ))
        for ou in (-1, 0, 1):
            for ov in (-1, 0, 1):
                sx, sy = _iso(u + ou * L, v + ov * L)
                if not (-hmax <= sx <= 128 + hmax and 0 <= sy <= 64 + hmax):
                    continue
                for (dx, dy, h, lean, bend, ti, op, zoff) in spec:
                    x0, y0 = sx + dx, sy + dy
                    w = p["blade_width"] * (0.6 + 0.4 * h / hmax)
                    tx = x0 + math.sin(lean) * h + bend * h
                    ty = y0 - math.cos(lean) * h
                    cx = x0 + math.sin(lean) * h * 0.5 + bend * h * 0.15
                    cy = y0 - math.cos(lean) * h * 0.55
                    d = (f"M{x0 - w / 2:.2f},{y0:.2f} Q{cx - w / 4:.2f},{cy:.2f} {tx:.2f},{ty:.2f} "
                         f"Q{cx + w / 4:.2f},{cy:.2f} {x0 + w / 2:.2f},{y0:.2f} Z")
                    blades.append((y0 + zoff, f'<path d="{d}" fill="{rgb(tones[ti])}" opacity="{op:.2f}"/>'))
    blades.sort(key=lambda b: b[0])
    out.extend(b[1] for b in blades)

    out.append("\n" + noise_layer("0.05 0.3", 3, p["seed"] + 1, p["noise_alpha"], -0.14) + "\n")
    out.append("</g>\n</svg>\n")
    return "".join(out)


# ---------------------------------------------------------------- TRAMPILLA (objeto sobre un suelo)
TRAMPILLA_DEFAULTS = {
    "seed": 4,
    "floor_preset": "vector-plano/piedra-1",   # suelo de fondo: cualquier preset (sin prefijo = del mismo estilo)
    "size": 4.2,                  # lado de la compuerta (unidades de suelo, centrada)
    "planks": 4,                  # tablones de la compuerta (a lo largo de u)
    "wood": [112, 78, 42],        # madera oscura y vieja; "floor" = la del suelo (si es madera)
    "shade_range": 10,            # con wood="floor" se toma también del suelo
    "grain_lines": 3,
    "gap": 0.07,                  # ranura entre tablones
    "frame": "#2a2522",           # marco/ranura perimetral (0 = sin marco)
    "frame_width": 0.06,          # fino: con 0.16 el usuario dijo que sobraban los bordes negros
    "edge_width": 0.05,           # filo oscuro arriba-izquierda (0 = sin filo)
    "edge_opacity": 0.25,
    "iron": [58, 58, 60],         # flejes, clavos y anilla
    "strap_width": 0.42,
    "ring_r": 0.5,
    "iron_thick": 1.0,            # grosor de los herrajes en px de pantalla (extrusión iso)
}


def gen_trampilla(p):
    rnd = random.Random(p["seed"])
    # 1) suelo: SVG completo del preset indicado
    ft, floor = load_preset(p["floor_preset"])
    svg = TYPES[ft][1](floor)
    # 2) compuerta en coordenadas de suelo, insertada ANTES de la(s) capa(s) de ruido
    #    del suelo para que comparta grano (noise_layer siempre empieza así):
    cut = svg.find(f'<g transform="{ISO}" opacity="')
    assert cut > 0, "el suelo no tiene noise_layer"
    S = p["size"]
    x0 = y0 = (L - S) / 2
    x1 = y1 = x0 + S
    wood, iron, shade = p["wood"], p["iron"], p["shade_range"]
    if wood == "floor":
        if ft != "madera":
            sys.exit(f'wood="floor" requiere un suelo de madera (el de {p["floor_preset"]} es {ft})')
        wood, shade = floor["base"], floor["shade_range"]
    g = [f'<g transform="{ISO}">']
    # marco: ranura oscura alrededor (la compuerta está encajada en el suelo)
    fw = p["frame_width"]
    if fw > 0:
        g.append(f'<rect x="{x0 - fw:.2f}" y="{y0 - fw:.2f}" width="{S + 2 * fw:.2f}" height="{S + 2 * fw:.2f}" fill="{p["frame"]}"/>')
    # tablones a lo largo de u con ranuras entre ellos
    n = p["planks"]
    pw = S / n
    for i in range(n):
        sh = rnd.uniform(-shade, shade)
        col = (wood[0] + sh, wood[1] + sh * 0.8, wood[2] + sh * 0.5)
        v0 = y0 + i * pw + (p["gap"] / 2 if i else 0)
        v1 = y0 + (i + 1) * pw - (p["gap"] / 2 if i < n - 1 else 0)
        g.append(f'<rect x="{x0:.2f}" y="{v0:.2f}" width="{S:.2f}" height="{v1 - v0:.2f}" fill="{rgb(col)}"/>')
        dark = rgb((col[0] - 34, col[1] - 26, col[2] - 16))
        for k in range(p["grain_lines"]):
            vv = v0 + (v1 - v0) * (k + 0.5) / p["grain_lines"] + rnd.uniform(-0.06, 0.06)
            amp, ph = rnd.uniform(0.02, 0.06), rnd.uniform(0, 6.28)
            pts = " ".join("%.2f,%.2f" % (x0 + S * t / 16, vv + amp * math.sin(t / 16 * 6.28 + ph)) for t in range(17))
            g.append(f'<polyline points="{pts}" fill="none" stroke="{dark}" stroke-width="{rnd.uniform(0.04, 0.08):.2f}" opacity="{rnd.uniform(0.4, 0.7):.2f}" stroke-linecap="round"/>')
    # filo oscuro fino arriba-izquierda (la compuerta queda un pelo hundida)
    if p.get("edge_width", 0) > 0:
        g.append(f'<path d="M{x0:.2f},{y1:.2f} L{x0:.2f},{y0:.2f} L{x1:.2f},{y0:.2f}" fill="none" stroke="#000" stroke-width="{p["edge_width"]}" opacity="{p["edge_opacity"]}"/>')
    # Herrajes SÓLIDOS con grosor isométrico: cada pieza de altura `iron_thick` px se
    # dibuja con sus dos caras laterales visibles en iso como caras explícitas con
    # tono propio (−u, abajo-izquierda, tono medio; +v, abajo-derecha, oscura) y la
    # cara superior clara desplazada t px hacia arriba en pantalla, que en suelo es
    # (+t/8, −t/8). Sin sombras: el volumen lo dan las caras.
    sw = p["strap_width"]
    ir, hi = rgb(iron), rgb(shift(iron, 40))
    side_u, side_v = rgb(shift(iron, -14)), rgb(shift(iron, -36))
    t = p["iron_thick"] / 8
    def solid_rect(x, y, w, h):
        # cara −u (borde u=x) y cara +v (borde v=y+h), luego la superior
        g.append(f'<polygon points="{x:.2f},{y:.2f} {x:.2f},{y + h:.2f} {x + t:.2f},{y + h - t:.2f} {x + t:.2f},{y - t:.2f}" fill="{side_u}"/>')
        g.append(f'<polygon points="{x:.2f},{y + h:.2f} {x + w:.2f},{y + h:.2f} {x + w + t:.2f},{y + h - t:.2f} {x + t:.2f},{y + h - t:.2f}" fill="{side_v}"/>')
        g.append(f'<rect x="{x + t:.2f}" y="{y - t:.2f}" width="{w:.2f}" height="{h:.2f}" fill="{ir}"/>')
    for fx in (x0 + S * 0.22, x1 - S * 0.22):
        l = fx - sw / 2
        solid_rect(l, y0 - 0.02, sw, S + 0.04)
        g.append(f'<line x1="{l + t + 0.05:.2f}" y1="{y0 - t:.2f}" x2="{l + t + 0.05:.2f}" y2="{y1 - t:.2f}" stroke="{hi}" stroke-width="0.06" opacity="0.7"/>')
        for ny in (y0 + 0.28, y1 - 0.28):
            g.append(f'<circle cx="{fx + t:.2f}" cy="{ny - t:.2f}" r="0.1" fill="{hi}"/>')
    # anilla tumbada (toro -> elipse en iso) con placa. El muro exterior visible del
    # toro es donde la normal mira al espectador: ángulo θ (atan2(v,u)) en (45°,225°);
    # de 135° a 225° domina −u (tono medio), de 45° a 135° domina +v (oscuro).
    r = p["ring_r"]
    cx, cy = (x0 + x1) / 2, y1 - r - 0.4
    pw_, ph_ = 0.64, 0.34
    solid_rect(cx - pw_ / 2, cy - r - 0.28, pw_, ph_)
    g.append(f'<circle cx="{cx + t:.2f}" cy="{cy - r - 0.28 + ph_ / 2 - t:.2f}" r="0.08" fill="{hi}"/>')
    rw = 0.18
    def arc(a0, a1, col):
        p0 = (cx + r * math.cos(math.radians(a0)), cy + r * math.sin(math.radians(a0)))
        p1 = (cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1)))
        g.append(f'<path d="M{p0[0]:.2f},{p0[1]:.2f} A{r:.2f},{r:.2f} 0 0 1 {p1[0]:.2f},{p1[1]:.2f}" fill="none" stroke="{col}" stroke-width="{rw}"/>')
    g.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="none" stroke="{side_v}" stroke-width="{rw}"/>')  # base (muro interior lejano y +v)
    arc(135, 225, side_u)
    g.append(f'<circle cx="{cx + t:.2f}" cy="{cy - t:.2f}" r="{r:.2f}" fill="none" stroke="{ir}" stroke-width="{rw}"/>')
    g.append(f'<circle cx="{cx + t - 0.03:.2f}" cy="{cy - t - 0.03:.2f}" r="{r:.2f}" fill="none" stroke="{hi}" stroke-width="0.05" opacity="0.6"/>')
    g.append("</g>\n")
    return svg[:cut] + "".join(g) + svg[cut:]


# ---------------------------------------------------------------- PARED (muro de piedra: sprite con altura)
K = 8.944  # px de pantalla que mide 1 unidad de suelo a lo largo de u o de v

PARED_DEFAULTS = {
    "seed": 5,
    "dir": "u",               # eje del muro recto: "u" (cara larga +v, mira abajo-derecha) o "v" (cara larga −u, abajo-izquierda)
    "arms": None,             # brazos desde el centro, p. ej. ["-u","+v"] (esquina), ["-u","+u","+v"] (T), los 4 (cruz), ["+u"] (remate); si se da, ignora dir
    "thick": 2.0,             # grosor (unidades de suelo), centrado en la celda
    "height": 64,             # alto del muro (px del viewBox, 2×)
    "canvas_h": 128,          # alto del lienzo; la base 128×64 va abajo (pivote abajo-centro)
    "courses": 7,             # hiladas
    "block_len": 2.0,         # largo de sillar (unidades de suelo; debe dividir 8 para que encaje)
    "gray_min": 148,          # tono de sillar (cara −u; las otras caras suman su sombra)
    "gray_max": 174,
    "tint": [4, 4, 0],
    "mortar": [84, 80, 74],   # junta
    "gap": 0.45,              # medio grosor de junta (px)
    "jitter": 0.12,           # irregularidad de las esquinas de cada sillar (px)
    "highlight": 16,          # filo claro arriba-izquierda de cada sillar
    "shadow": 20,             # filo oscuro abajo-derecha
    "edge_width": 0.5,        # grosor de los filos (px)
    "edge_opacity": 0.6,
    "shade_left": 0,          # luz única arriba-izquierda: cara −u (izquierda) clara…
    "shade_right": -34,       # …cara +v (derecha) oscura…
    "shade_top": 18,          # …y canto superior el más claro
    "foot_shadow": 4,         # sombra de contacto DENTRO de la cara (px de alto; 0 = sin ella)
    "foot_opacity": 0.2,
    "noise_alpha": 0.3,
    # elemento sobre la cara larga (la más larga visible; en empate, la +v con dir "u" y la −u con dir "v")
    "feature": "none",        # "none" | "antorcha" | "tapiz" | "ventana" | "arco"
    "feature_pos": 0.5,       # posición a lo largo de la cara (0..1)
    "torch_z": 30,            # altura de la anilla de la antorcha (px)
    "banner_color": [140, 26, 34],
    "banner_trim": [201, 160, 74],
    "window_w": 4,            # ancho de la aspillera (px)
    "window_h": 22,           # alto de la aspillera (px)
    "window_z": 26,           # altura de su base (px)
    "arch_w": 3.4,            # ancho del paso (unidades de suelo)
    "arch_h": 30,             # alto de las jambas (px); encima va el medio punto
}


def _wall_specs(p):
    """Sillares de cada marco de cara, deterministas por (seed, marco): 'cu' =
    caras −u (x = v·K), 'cv' = caras +v (x = u·K). Toda pieza (recto, esquina,
    T, cruz, remate) recorta el MISMO patrón de 8 unidades, así la sillería
    continúa de una pieza a la vecina. specs[marco][hilada] = lista de n
    (tono, jitter[8]); el sillar k (k mod n) va de k·bl+off a (k+1)·bl+off px."""
    bl = p["block_len"] * K
    n = int(round(L * K / bl))
    j = p["jitter"]
    out = {}
    for frame in ("cu", "cv"):
        rnd = random.Random(f'{p["seed"]}-{frame}')
        out[frame] = [[(rnd.uniform(p["gray_min"], p["gray_max"]), [rnd.uniform(-j, j) for _ in range(8)])
                       for _ in range(n)] for _ in range(p["courses"])]
    return out


def _blocks(p, specs, course, a_lo, a_hi):
    """Sillares de una hilada que tocan [a_lo, a_hi] (px): (a0, a1, tono, jitter)."""
    bl = p["block_len"] * K
    n = len(specs[course])
    off = bl / 2 if course % 2 else 0
    res = []
    for k in range(-1, n + 1):
        a0, a1 = k * bl + off, (k + 1) * bl + off
        if a1 > a_lo - 1 and a0 < a_hi + 1:
            gr, jt = specs[course][k % n]
            res.append((a0, a1, gr, jt))
    return res


def _masonry(p, specs, a_lo, a_hi, H, shade):
    """Sillería de una cara en su espacio: x a lo largo del muro (px, marco de 8
    unidades), y hacia ARRIBA (px; la matriz de la cara invierte y). Solo el
    tramo [a_lo, a_hi] (la cara se recorta a él). Hiladas de alto H/courses con
    juntas alternas (aparejo a soga)."""
    nc = p["courses"]
    ch = H / nc
    g, tint = p["gap"], p["tint"]
    ew, eo = p.get("edge_width", 0.7), p.get("edge_opacity", 0.8)
    out = [f'<rect x="{a_lo:.3f}" y="0" width="{a_hi - a_lo:.3f}" height="{H}" fill="{rgb(shift(p["mortar"], shade * 0.4))}"/>']
    for c in range(nc):
        z0, z1 = c * ch, (c + 1) * ch
        for (a0, a1, gr, jt) in _blocks(p, specs, c, a_lo, a_hi):
            col = [gr + shade + t for t in tint]
            pts = lambda d: [(a0 + d + jt[0], z0 + d + jt[1]), (a1 - d + jt[2], z0 + d + jt[3]),
                             (a1 - d + jt[4], z1 - d + jt[5]), (a0 + d + jt[6], z1 - d + jt[7])]
            out.append(f'<polygon points="{fmt(pts(g))}" fill="{rgb(col)}" stroke="{rgb(col)}" stroke-width="0.5" stroke-linejoin="round"/>')
            q = pts(g + ew * 0.6)  # BL, BR, TR, TL (y hacia arriba): luz arriba-izquierda, sombra abajo-derecha
            out.append(f'<polyline points="{fmt([q[0], q[3], q[2]])}" fill="none" stroke="{rgb(shift(col, p["highlight"]))}" stroke-width="{ew}" stroke-linejoin="round" opacity="{eo}"/>')
            out.append(f'<polyline points="{fmt([q[2], q[1], q[0]])}" fill="none" stroke="{rgb(shift(col, -p["shadow"]))}" stroke-width="{ew}" stroke-linejoin="round" opacity="{eo}"/>')
    if p["foot_shadow"] > 0:
        out.append(f'<rect x="{a_lo:.3f}" y="0" width="{a_hi - a_lo:.3f}" height="{p["foot_shadow"]}" fill="#000" opacity="{p["foot_opacity"]}"/>')
    return "".join(out)


def _wall_arms(p):
    arms = p.get("arms")
    if not arms:
        arms = ["-v", "+v"] if p.get("dir", "u") == "v" else ["-u", "+u"]
    bad = set(arms) - {"-u", "+u", "-v", "+v"}
    if bad:
        sys.exit(f"arms desconocidos: {sorted(bad)}")
    return set(arms)


def _merge_faces(faces):
    """Une caras colineales contiguas: (pos, a, b) con misma pos y b == a siguiente."""
    faces = sorted(faces)
    out = []
    for f in faces:
        if out and out[-1][0] == f[0] and abs(out[-1][2] - f[1]) < 1e-9:
            out[-1] = (f[0], out[-1][1], f[2])
        else:
            out.append(f)
    return out


def _arch_outline(ac, w, hs, n=14):
    """Polígono (espacio de cara, y arriba) de un hueco de medio punto de ancho w
    centrado en ac: jambas hasta hs y semicírculo encima."""
    r = w / 2
    pts = [(ac - r, 0.0), (ac - r, hs)]
    pts += [(ac + r * math.cos(math.pi - math.pi * k / n), hs + r * math.sin(math.pi - math.pi * k / n)) for k in range(1, n)]
    pts += [(ac + r, hs), (ac + r, 0.0)]
    return pts


def _feature(p, kind, ac, H, shade, t, frame):
    """Elemento sobre una cara, en su espacio (x a lo largo en px, y arriba en px).
    Devuelve (svg_antes_del_ruido, svg_después_del_ruido). El arco además
    necesita recortar la cara: ver _arch_clip."""
    stone = lambda d: rgb([(p["gray_min"] + p["gray_max"]) / 2 + shade + d + tt for tt in p["tint"]])
    mortar = rgb(shift(p["mortar"], shade * 0.4))
    pre, post = [], []
    if kind == "antorcha":
        zt = p["torch_z"]
        iron, wood = "#3a3a3c", "#6b4a2a"
        post.append(f'<ellipse cx="{ac:.2f}" cy="{zt + 32:.2f}" rx="7" ry="10" fill="#000" opacity="0.16"/>')  # hollín
        post.append(f'<rect x="{ac - 1:.2f}" y="{zt - 7:.2f}" width="2" height="7.5" fill="{iron}"/>')       # soporte
        post.append(f'<polygon points="{fmt([(ac - 1.3, zt - 8), (ac + 1.3, zt - 8), (ac + 2.4, zt + 9), (ac - 0.2, zt + 9)])}" fill="{wood}"/>')  # mango
        post.append(f'<ellipse cx="{ac:.2f}" cy="{zt:.2f}" rx="3.2" ry="1.4" fill="{iron}"/>')               # anilla
        post.append(f'<ellipse cx="{ac + 1.1:.2f}" cy="{zt + 9.5:.2f}" rx="3.4" ry="1.6" fill="#2a2523"/>')   # cabeza (estopa)
        fl = lambda s, dy: (f'M{ac + 1.1 - 3.2 * s:.2f},{zt + 10 + dy:.2f} Q{ac + 1.1 - 3.6 * s:.2f},{zt + 10 + 9 * s + dy:.2f} '
                            f'{ac + 1.8:.2f},{zt + 10 + 20 * s + dy:.2f} Q{ac + 1.1 + 4.2 * s:.2f},{zt + 10 + 8 * s + dy:.2f} {ac + 1.1 + 3.2 * s:.2f},{zt + 10 + dy:.2f} Z')
        post.append(f'<path d="{fl(1.0, 0)}" fill="#e8641c"/>')
        post.append(f'<path d="{fl(0.6, 0.5)}" fill="#f7c33a"/>')
        post.append(f'<path d="{fl(0.3, 1.0)}" fill="#fff0a0"/>')
    elif kind == "tapiz":
        col, trim = rgb(p["banner_color"]), rgb(p["banner_trim"])
        w, zt, zb = 11, 54, 20
        post.append(f'<rect x="{ac - w - 2.5:.2f}" y="{zt:.2f}" width="{2 * w + 5:.2f}" height="1.6" fill="#6b4a2a"/>')  # barra
        for s in (-1, 1):
            post.append(f'<circle cx="{ac + s * (w + 2.5):.2f}" cy="{zt + 0.8:.2f}" r="1.7" fill="#7a5632"/>')
        cloth = [(ac - w, zt), (ac + w, zt), (ac + w, zb), (ac, zb - 8), (ac - w, zb)]
        post.append(f'<polygon points="{fmt(cloth)}" fill="{col}"/>')
        post.append(f'<polygon points="{fmt([(ac - w, zt - 1), (ac - w + 2.2, zt - 1), (ac - w + 2.2, zb + 1.3), (ac - w, zb)])}" fill="#000" opacity="0.18"/>')  # pliegue
        inner = [(ac - w + 2.4, zt - 2.4), (ac + w - 2.4, zt - 2.4), (ac + w - 2.4, zb + 1.2), (ac, zb - 4.8), (ac - w + 2.4, zb + 1.2)]
        post.append(f'<polygon points="{fmt(inner)}" fill="none" stroke="{trim}" stroke-width="1.1"/>')
        zc = (zt + zb) / 2 + 1
        post.append(f'<polygon points="{fmt([(ac, zc + 6), (ac + 5, zc), (ac, zc - 6), (ac - 5, zc)])}" fill="{trim}"/>')
        post.append(f'<polygon points="{fmt([(ac, zc + 3), (ac + 2.5, zc), (ac, zc - 3), (ac - 2.5, zc)])}" fill="{col}"/>')
    elif kind == "ventana":
        w, h, z0 = p["window_w"], p["window_h"], p["window_z"]
        fw, fh = 5.5, 5.0  # marco de sillares alrededor
        pre.append(f'<rect x="{ac - w / 2 - fw:.2f}" y="{z0 - fh:.2f}" width="{w + 2 * fw:.2f}" height="{h + 2 * fh:.2f}" fill="{mortar}"/>')
        g = p["gap"]
        # dintel, alféizar y dos jambas como sillares
        blocks = [(ac - w / 2 - fw, z0 + h, w + 2 * fw, fh), (ac - w / 2 - fw, z0 - fh, w + 2 * fw, fh),
                  (ac - w / 2 - fw, z0, fw, h), (ac + w / 2, z0, fw, h)]
        for (x, y, bw, bh) in blocks:
            pre.append(f'<rect x="{x + g:.2f}" y="{y + g:.2f}" width="{bw - 2 * g:.2f}" height="{bh - 2 * g:.2f}" fill="{stone(10)}"/>')
            pre.append(f'<polyline points="{fmt([(x + g, y + g), (x + g, y + bh - g), (x + bw - g, y + bh - g)])}" fill="none" stroke="{stone(24)}" stroke-width="0.6" opacity="0.7"/>')
        r = w / 2
        slit = [(ac - r, z0), (ac - r, z0 + h - r)] + [(ac + r * math.cos(math.pi - math.pi * k / 8), z0 + h - r + r * math.sin(math.pi - math.pi * k / 8)) for k in range(1, 8)] + [(ac + r, z0 + h - r), (ac + r, z0)]
        pre.append(f'<polygon points="{fmt(slit)}" fill="#1e1c1a"/>')
        pre.append(f'<polyline points="{fmt([(ac - r + 0.6, z0), (ac - r + 0.6, z0 + h - r)])}" fill="none" stroke="{stone(-30)}" stroke-width="1.2"/>')  # derrame interior
    elif kind == "arco":
        w, hs = p["arch_w"] * K, p["arch_h"]
        o = _arch_outline(ac, w, hs)
        # dovelas: anillo de sillares claros alrededor del hueco (la mitad interior la recorta el clip)
        pre.append(f'<polygon points="{fmt(o)}" fill="none" stroke="{stone(12)}" stroke-width="7" stroke-linejoin="round"/>')
        pre.append(f'<polygon points="{fmt(o)}" fill="none" stroke="{mortar}" stroke-width="0.9" stroke-linejoin="round"/>')
        r = w / 2
        for k in range(0, 10):  # juntas radiales del arco
            a = math.pi - math.pi * k / 9
            pre.append(f'<line x1="{ac + (r + 0.5) * math.cos(a):.2f}" y1="{hs + (r + 0.5) * math.sin(a):.2f}" x2="{ac + (r + 3.6) * math.cos(a):.2f}" y2="{hs + (r + 3.6) * math.sin(a):.2f}" stroke="{mortar}" stroke-width="0.8"/>')
        for z in (8, 16, 24):  # juntas de las jambas
            for s in (-1, 1):
                pre.append(f'<line x1="{ac + s * (r + 0.5):.2f}" y1="{z}" x2="{ac + s * (r + 3.6):.2f}" y2="{z}" stroke="{mortar}" stroke-width="0.8"/>')
        # Hueco: el contorno trasero o2 es el delantero desplazado el grosor t hacia
        # dentro del muro. Cara +v (frame cv, a = u·K): hacia −v, en pantalla (−8t, −4t)
        # = en el espacio de cara (−t·K, +8t); cara −u (cu, a = v·K): hacia +u, en
        # pantalla (+8t, −4t) = (+t·K, +8t). Superficies interiores visibles: la jamba
        # del lado hacia el que va el desplazamiento (paralelogramo barrido por ese
        # lado) y el intradós (banda entre los dos arcos); el suelo del paso NO se
        # pinta (se ve el tile de suelo de debajo). Todo recortado al hueco delantero.
        s = 1 if frame == "cu" else -1
        dz = 8 * t
        o2 = [(x + s * t * K, z + dz) for (x, z) in o]
        ja = ac + s * r  # lado del hueco cuya jamba se ve
        jamb = [(ja, 0), (ja, hs), (ja + s * t * K, hs + dz), (ja + s * t * K, dz)]
        arc, arc2 = o[1:-1], o2[1:-1]
        soffit = arc + arc2[::-1]
        jcol = stone(-4 + (p["shade_right"] if frame == "cu" else p["shade_left"]) - shade)
        post.append(f'<clipPath id="hueco"><polygon points="{fmt(o)}"/></clipPath><g clip-path="url(#hueco)">')
        post.append(f'<polygon points="{fmt(jamb)}" fill="{jcol}"/>')
        post.append(f'<polygon points="{fmt(soffit)}" fill="{stone(-30)}"/>')
        for z in (10, 20, 30):  # juntas de la jamba interior
            post.append(f'<line x1="{ja:.2f}" y1="{z}" x2="{ja + s * t * K:.2f}" y2="{z + dz:.2f}" stroke="{mortar}" stroke-width="0.7" opacity="0.8"/>')
        post.append("</g>")
    elif kind != "none":
        sys.exit(f"feature desconocida: {kind}")
    return "".join(pre), "".join(post)


def gen_pared(p):
    """Pieza de muro: centro de la celda (cuadrado de lado `thick`) más los
    brazos `arms` hasta el borde de la celda. Recto = dos brazos opuestos,
    esquina = dos en ángulo, T = tres, cruz = cuatro, remate = uno. Se dibujan
    solo las caras que miran al jugador: −u (izquierda, iluminada), +v (derecha,
    en sombra) y el canto superior; cada rectángulo ocupado aporta su cara −u /
    +v si no hay otro rectángulo pegado a ese lado, y las caras colineales se
    funden en una. Cada cara se dibuja en su espacio 2D (x a lo largo, en px
    del marco de 8 unidades; y = altura en px) y una matriz afín la proyecta:
    x_pant = 8·u + 8·v, y_pant = −4·u + 4·v + Y0 − z. Los bordes verticales caen
    en x entero, así las piezas contiguas casan sin costura, y el patrón de
    sillares es el mismo en todas las piezas. La pieza anterior (orden de
    pintado por x+y) tapa el canto corto de la siguiente. Fondo transparente,
    sin suelo: el suelo es el tile de debajo."""
    H, CH, t = p["height"], p["canvas_h"], p["thick"]
    Y0 = CH - 32
    c0, c1 = (L - t) / 2, (L + t) / 2
    arms = _wall_arms(p)
    specs = _wall_specs(p)
    # caras −u: (u, va, vb); caras +v: (v, ua, ub)
    left = [(0.0, c0, c1)] if "-u" in arms else [(c0, c0, c1)]
    if "-v" in arms: left.append((c0, 0.0, c0))
    if "+v" in arms: left.append((c0, c1, L))
    right = [(L, c0, c1)] if "+v" in arms else [(c1, c0, c1)]
    if "-u" in arms: right.append((c1, 0.0, c0))
    if "+u" in arms: right.append((c1, c1, L))
    faces = []  # (profundidad, id, matriz, marco, a_lo, a_hi, sombra)
    for (u, va, vb) in _merge_faces(left):
        if vb - va < 1e-9:
            continue  # con thick = 8 (bloque de celda completa) los brazos no añaden caras
        faces.append((u + vb, f"cu{u:g}_{va:g}", f"matrix({8 / K:.5f} {4 / K:.5f} 0 -1 {8 * u:.3f} {Y0 - 4 * u:.3f})", "cu", va * K, vb * K, p["shade_left"]))
    for (v, ua, ub) in _merge_faces(right):
        if ub - ua < 1e-9:
            continue
        faces.append((v + ub, f"cv{v:g}_{ua:g}", f"matrix({8 / K:.5f} {-4 / K:.5f} 0 -1 {8 * v:.3f} {Y0 + 4 * v:.3f})", "cv", ua * K, ub * K, p["shade_right"]))
    out = [HEAD.replace('viewBox="0 0 128 64" width="128" height="64"', f'viewBox="0 0 128 {CH}" width="128" height="{CH}"')]
    kind = p.get("feature", "none")
    # cara larga; en empate (bloque de celda completa, thick 8) decide dir: "u" -> cara +v, "v" -> cara −u
    feat_face = max(faces, key=lambda f: (f[5] - f[4], f[3] == ("cu" if p["dir"] == "v" else "cv")))[1] if kind != "none" else None
    for (_, cid, m, frame, a_lo, a_hi, sh) in sorted(faces):  # de atrás hacia delante
        pre = post = ""
        clip = f'<rect x="{a_lo:.3f}" y="0" width="{a_hi - a_lo:.3f}" height="{H}"/>'
        if cid == feat_face:
            ac = a_lo + (a_hi - a_lo) * p["feature_pos"]
            pre, post = _feature(p, kind, ac, H, sh, t, frame)
            if kind == "arco":  # el hueco se recorta de la cara (clip-rule evenodd) y deja ver el fondo
                o = _arch_outline(ac, p["arch_w"] * K, p["arch_h"])
                clip = (f'<path d="M{a_lo:.3f},0 H{a_hi:.3f} V{H} H{a_lo:.3f} Z M{fmt(o).replace(" ", " L")} Z" clip-rule="evenodd"/>')
        out.append(f'<clipPath id="{cid}">{clip}</clipPath>\n')
        out.append(f'<g transform="{m}"><g clip-path="url(#{cid})">{_masonry(p, specs[frame], a_lo, a_hi, H, sh)}{pre}\n')
        out.append(noise_layer(0.8, 2, p["seed"] + 11, p["noise_alpha"], -0.08, box=(a_lo, 0, a_hi - a_lo, H), transform="matrix(1 0 0 1 0 0)", px=(1, 1)))
        out.append(f"</g>{post}</g>\n")
    # canto superior: los sillares de la hilada superior de cada tramo, vistos desde
    # arriba. Los tramos a lo largo de u (brazos ∓u y el centro, si hay brazos u)
    # siguen el marco 'cv'; los tramos a lo largo de v, el marco 'cu'.
    runs = []  # (eje, a, b) en unidades: rango a lo largo del eje; el otro eje es [c0,c1]
    if arms & {"-u", "+u"}:
        runs.append(("u", 0.0 if "-u" in arms else c0, L if "+u" in arms else c1))
        if "-v" in arms: runs.append(("v", 0.0, c0))
        if "+v" in arms: runs.append(("v", c1, L))
    else:
        runs.append(("v", 0.0 if "-v" in arms else c0, L if "+v" in arms else c1))
    runs = [r for r in runs if r[2] - r[1] > 1e-9]
    iso_top = f"matrix(8 -4 8 4 0 {Y0 - H})"
    g = p["gap"] / K
    top = [f'<g transform="{iso_top}">']
    for (axis, a, b) in runs:
        ru = (a, b, c0, c1) if axis == "u" else (c0, c1, a, b)
        top.append(f'<rect x="{ru[0]:.3f}" y="{ru[2]:.3f}" width="{ru[1] - ru[0]:.3f}" height="{ru[3] - ru[2]:.3f}" fill="{rgb(shift(p["mortar"], p["shade_top"] * 0.4))}"/>')
    # Si el muro es más grueso que un sillar (p. ej. thick = 8, bloque de celda
    # completa), la tapa se divide en filas de ~block_len con juntas alternas.
    nrows = max(1, int(round(t / p["block_len"])))
    rh = t / nrows
    for (axis, a, b) in runs:
        for r in range(nrows):
            course = (p["courses"] - 1 - r) % p["courses"]
            w0 = c0 + r * rh
            for (a0, a1, gr, _) in _blocks(p, specs["cv" if axis == "u" else "cu"], course, a * K, b * K):
                b0, b1 = max(a, a0 / K) + g, min(b, a1 / K) - g
                if b1 <= b0:
                    continue
                col = rgb([gr + p["shade_top"] + tt for tt in p["tint"]])
                if axis == "u":
                    top.append(f'<rect x="{b0:.3f}" y="{w0 + g:.3f}" width="{b1 - b0:.3f}" height="{rh - 2 * g:.3f}" fill="{col}"/>')
                else:
                    top.append(f'<rect x="{w0 + g:.3f}" y="{b0:.3f}" width="{rh - 2 * g:.3f}" height="{b1 - b0:.3f}" fill="{col}"/>')
    top.append("</g>\n")
    out.append("".join(top))
    # ruido del canto: una capa por tramo (cada una periódica en su rango)
    for (axis, a, b) in runs:
        box = (a, c0, b - a, t) if axis == "u" else (c0, a, t, b - a)
        out.append(noise_layer(0.8, 2, p["seed"] + 12, p["noise_alpha"], -0.08, box=box, transform=iso_top) + "\n")
    out.append("</svg>\n")
    return "".join(out)


import sprites  # objetos del pack (tipo "sprite"); usa rgb/shift/fmt/K de aquí

TYPES = {
    "madera": (MADERA_DEFAULTS, gen_madera),
    "piedra": (PIEDRA_DEFAULTS, gen_piedra),
    "alfombra": (ALFOMBRA_DEFAULTS, gen_alfombra),
    "cesped": (CESPED_DEFAULTS, gen_cesped),
    "trampilla": (TRAMPILLA_DEFAULTS, gen_trampilla),
    "pared": (PARED_DEFAULTS, gen_pared),
    "sprite": (sprites.SPRITE_DEFAULTS, sprites.gen_sprite),
}


# ---------------------------------------------------------------- CLI
def estetica_de(name):
    """Estilo de un preset: su prefijo (castillo-toon/piedra-1)."""
    return _partes(name)[0]


def load_estetica(eid):
    path = ESTILOS / eid / "tiles" / "estetica.json"
    return json.loads(path.read_text()) if path.exists() else {}


def all_presets():
    names = []
    for d in sorted(ESTILOS.glob("*/tiles/presets")):
        e = d.parent.parent.name
        names += [f"{e}/{p.relative_to(d).with_suffix('')}" for p in d.rglob("*.json")]
    return sorted(names)


def load_preset(name):
    """Parámetros = defaults del tipo <- los de su estética para ese tipo <- los del preset."""
    path = preset_path(name)
    if not path.exists():
        sys.exit(f"no existe el preset {path}")
    data = json.loads(path.read_text())
    t = data["type"]
    if t not in TYPES:
        sys.exit(f"tipo desconocido: {t}")
    params = dict(TYPES[t][0])
    params.update(load_estetica(estetica_de(name)).get("tipos", {}).get(t, {}))
    params.update(data.get("params", {}))
    for k, v in params.items():     # referencias a otros presets sin prefijo = del mismo estilo
        if k.endswith("_preset") and isinstance(v, str) and "/" not in v:
            params[k] = f"{estetica_de(name)}/{v}"
    return t, params


def build(name):
    """Genera estilos/<estilo>/renders/svg/<nombre>.svg. Un generador puede devolver
    un dict nombre -> svg (avatar, fx-spark): entonces escribe un archivo por
    entrada. Devuelve la lista de nombres escritos."""
    t, params = load_preset(name)
    svg = TYPES[t][1](params)
    e = estetica_de(name)       # varios archivos (avatar, fx-spark): se nombran dentro del estilo del preset
    outs = {(k if "/" in k else f"{e}/{k}"): v for k, v in svg.items()} if isinstance(svg, dict) else {name: svg}
    for (nm, body) in outs.items():
        svg_path(nm).parent.mkdir(parents=True, exist_ok=True)
        svg_path(nm).write_text(body)
    names = list(outs)
    print(f"{name}: {t} -> {svg_path(names[0]).relative_to(ROOT)}" + (f" … ({len(names)} archivos)" if len(names) > 1 else ""))
    return names


def pack_folder(name):
    """Carpeta de pack/ que espera el script del juego según el nombre del frame."""
    for (prefix, sub) in (("tile", "tiles"), ("icon-", "icons"), ("avatar", "avatar"), ("fx-", "fx")):
        if name.startswith(prefix):
            return sub
    return "sprites"


def export(pack=None, estilo=None):
    """Copia los SVG generados a <destino>/<carpeta>/<nombre>.svg con los nombres
    del juego según el mapa (nombre -> preset). Carpetas (las que espera el script
    del juego, que elige el tipo de cada frame por carpeta): tiles/ (tile*),
    icons/ (icon-*), avatar/ (avatar-*), fx/ (fx-*), sprites/ (resto).
    Con pack: packs/<id>/tiles.json -> packs/<id>/renders/tiles/. Con estilo: su mapa de
    demostración, estilos/<id>/tiles/pack.json -> estilos/<id>/renders/pack/.
    Se vacía el destino antes (solo sus carpetas de tipo) para no dejar copias
    viejas. Solo copia lo que está en el mapa."""
    import shutil
    if pack:
        path, dest = PACKS / pack / "tiles.json", PACKS / pack / "renders" / "tiles"
    elif estilo:
        path, dest = ESTILOS / estilo / "tiles" / "pack.json", ESTILOS / estilo / "renders" / "pack"
    else:
        sys.exit("export: indica --pack <id> o --estilo <id>")
    if not path.exists():
        sys.exit(f"no existe {path.relative_to(ROOT)}")
    m = {k: v for k, v in json.loads(path.read_text()).items() if not k.startswith("_")}
    for sub in ("tiles", "sprites", "icons", "avatar", "fx"):
        if (dest / sub).exists():
            shutil.rmtree(dest / sub)
    for name, preset in m.items():
        sub = pack_folder(name)
        src = svg_path(preset)
        # presets de varios archivos (avatar, fx-spark): se copian todos con su propio nombre
        outs = [preset] if src.exists() else build(preset)
        for nm in outs:
            dst = dest / sub / (f"{name}.svg" if len(outs) == 1 else f"{_partes(nm)[1]}.svg")
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(svg_path(nm).read_bytes())
        print(f"{dest.relative_to(ROOT)}/{sub}/{name if len(outs) == 1 else name + '-*'}.svg  <-  {preset}" + (f" ({len(outs)} archivos)" if len(outs) > 1 else ""))


def parse_value(v):
    try:
        return json.loads(v)
    except json.JSONDecodeError:
        return v


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("names", nargs="*"); b.add_argument("--all", action="store_true")
    n = sub.add_parser("new"); n.add_argument("type", choices=TYPES); n.add_argument("name")
    n.add_argument("--seed", type=int); n.add_argument("--set", action="append", default=[], metavar="clave=valor")
    n.add_argument("--from", dest="base", help="preset del que partir (copia sus params)")
    n.add_argument("--estilo", help="guarda el preset en estilos/<estilo>/tiles/presets/ (hereda de su estetica.json)")
    sub.add_parser("list")
    sub.add_parser("esteticas", help="estilos con tiles (estilos/*/tiles/estetica.json)")
    e = sub.add_parser("export", help="copia los SVG con los nombres del juego (packs/<id>/tiles.json o estilos/<id>/tiles/pack.json)")
    e.add_argument("--pack"); e.add_argument("--estilo")
    d = sub.add_parser("defaults"); d.add_argument("type", choices=TYPES)
    s = sub.add_parser("svg", help="imprime el SVG de un preset (con overrides --set) sin guardarlo; lo usa preview.mjs")
    s.add_argument("name"); s.add_argument("--set", action="append", default=[], metavar="clave=valor")
    a = ap.parse_args()

    if a.cmd == "build":
        names = all_presets() if a.all else a.names
        if not names:
            sys.exit("indica presets o --all")
        for nm in names:
            build(nm)
        if a.all:
            for pk in sorted(ESTILOS.glob("*/tiles/pack.json")):
                export(estilo=pk.parent.parent.name)
            for pk in sorted(PACKS.glob("*/tiles.json")):
                export(pk.parent.name)
    elif a.cmd == "new":
        if a.estilo and "/" not in a.name:
            a.name = f"{a.estilo}/{a.name}"
        if not (ESTILOS / estetica_de(a.name) / "tiles" / "estetica.json").exists():
            sys.exit(f"no existe estilos/{estetica_de(a.name)}/tiles/estetica.json")
        path = preset_path(a.name)
        if path.exists():
            sys.exit(f"ya existe {path}; elige otro nombre para no perder el anterior")
        params = {}
        if a.base:
            bt, bp = load_preset(a.base)
            if bt != a.type:
                sys.exit(f"{a.base} es de tipo {bt}, no {a.type}")
            params = bp
        if a.seed is not None:
            params["seed"] = a.seed
        for kv in a.set:
            k, _, v = kv.partition("=")
            if k not in TYPES[a.type][0]:
                sys.exit(f"parámetro desconocido para {a.type}: {k}")
            params[k] = parse_value(v)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"type": a.type, "params": params}, indent=2, ensure_ascii=False) + "\n")
        print(f"creado {path.relative_to(ROOT)}")
        build(a.name)
    elif a.cmd == "export":
        export(a.pack, a.estilo)
    elif a.cmd == "esteticas":
        ids = sorted(p.parent.parent.name for p in ESTILOS.glob("*/tiles/estetica.json"))
        for eid in ids:
            e = load_estetica(eid)
            n = sum(1 for nm in all_presets() if estetica_de(nm) == eid)
            print(f"{eid:16} {n:3} presets  {e.get('descripcion', '')}")
    elif a.cmd == "svg":
        t, params = load_preset(a.name)
        for kv in a.set:
            k, _, v = kv.partition("=")
            params[k] = parse_value(v)
        sys.stdout.write(TYPES[t][1](params))
    elif a.cmd == "list":
        for nm in all_presets():
            data = json.loads(preset_path(nm).read_text())
            print(f"{nm:28} {data['type']:9} {json.dumps(data.get('params', {}), ensure_ascii=False)}")
    elif a.cmd == "defaults":
        print(json.dumps(TYPES[a.type][0], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
