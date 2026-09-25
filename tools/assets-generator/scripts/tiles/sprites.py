"""
sprites — objetos del pack (columnas, muebles, objetos con estados, iconos,
avatar y efectos) en el mismo lenguaje que los tiles: rellenos planos, trazos
finos, luz única arriba-izquierda (cara −u clara, cara +v oscura, tapa la más
clara), fondo transparente, pivote abajo-centro.

Tipo de preset: {"type": "sprite", "params": {"kind": "arca", "state": "abierta"}}.
El nombre del preset es el nombre del archivo del pack. `SIZES` da el lienzo a
1× (el del pack); aquí se genera a 2×. Algunos kinds ("avatar", "fx-spark")
devuelven varios archivos (dict nombre -> svg).

Geometría: la celda del sprite es el rombo 128×64 apoyado abajo-centro del
lienzo; el suelo [0,8]² se proyecta con la misma matriz que los tiles
(x = x0 + 8u + 8v, y = yc − 4u + 4v − z, z = altura en px). Los objetos de
pared se dibujan en el plano v = 0 (borde trasero-izquierdo de la celda), que
coincide con la cara +v del bloque de muro de la celda de detrás.
"""
import math, random

K = 8.944  # px de pantalla por unidad de suelo (igual que tilegen.K)


def rgb(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(v))) for v in c)


def shift(c, d):
    return [v + d for v in c]


def fmt(poly):
    return " ".join("%.3f,%.3f" % p for p in poly)

# paleta común
WOOD, DWOOD, STONE, IRON = (150, 104, 62), (112, 78, 42), (160, 158, 152), (58, 58, 60)
GOLD, RED, WATER, CLAY, CREAM = (201, 160, 74), (140, 26, 34), (70, 120, 170), (176, 110, 70), (232, 220, 190)
SKIN, HAIR, TUNIC, BLUE = (228, 188, 156), (74, 50, 30), (210, 210, 208), (52, 82, 140)

SIZES = {  # lienzo a 1× (el pack); el SVG sale a 2×
    "columna": (64, 128), "columna-base": (64, 48), "columna-capital": (64, 48),
    "tile-20": (64, 48), "tile-21": (64, 48),
    "antorcha": (64, 96), "barril": (64, 64), "barriles": (96, 96), "estandarte": (64, 96),
    "tapiz-dragones": (96, 96), "trono": (128, 128), "cuadro-rey": (96, 96), "cuadro-reino": (96, 96),
    "tapiz-7-dragones": (96, 96), "armario": (96, 128), "arca": (96, 96), "brasero": (96, 96),
    "estatua-caballero": (96, 128), "placa": (64, 48), "puerta": (96, 128), "mural": (96, 96),
    "ranura": (64, 48), "compartimento": (96, 96), "mesa": (128, 96), "reja": (96, 96),
    "mirilla": (64, 64), "sarcofago": (128, 96), "altar": (96, 128), "canal": (64, 64),
    "compuerta": (96, 96), "relicario": (96, 96), "vasijas-8": (128, 96),
    "icon": (64, 64), "avatar": (64, 96), "fx-spark": (64, 64),
}


class S:
    """Lienzo de sprite (2×) con la celda apoyada abajo-centro."""

    def __init__(self, kind):
        w, h = SIZES[kind]
        self.W, self.H = 2 * w, 2 * h
        self.x0, self.yc = self.W / 2 - 64, self.H - 32
        self.out = []
        self.n = 0

    # --- proyección
    def p(self, u, v, z=0.0):
        return (self.x0 + 8 * u + 8 * v, self.yc - 4 * u + 4 * v - z)

    def face(self):
        """Transform del plano de pared v=0: (a px a lo largo de u, z px arriba)."""
        return f"matrix({8 / K:.5f} {-4 / K:.5f} 0 -1 {self.x0:.2f} {self.yc:.2f})"

    # --- primitivas
    def add(self, s):
        self.out.append(s)

    def poly(self, pts, fill, stroke=None, sw=0.6, op=1.0, extra=""):
        st = f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"' if stroke else ""
        o = f' opacity="{op}"' if op < 1 else ""
        self.add(f'<polygon points="{fmt(pts)}" fill="{fill}"{st}{o}{extra}/>')

    def fpoly(self, pts3, fill, **kw):
        self.poly([self.p(*q) for q in pts3], fill, **kw)

    def ell(self, cx, cy, rx, ry, fill, stroke=None, sw=0.6, op=1.0):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        o = f' opacity="{op}"' if op < 1 else ""
        self.add(f'<ellipse cx="{cx:.2f}" cy="{cy:.2f}" rx="{rx:.2f}" ry="{ry:.2f}" fill="{fill}"{st}{o}/>')

    def line(self, a, b, stroke, sw=0.8, op=1.0, cap="round"):
        o = f' opacity="{op}"' if op < 1 else ""
        self.add(f'<line x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="{cap}"{o}/>')

    def path(self, d, fill, stroke=None, sw=0.6, op=1.0):
        st = f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"' if stroke else ""
        o = f' opacity="{op}"' if op < 1 else ""
        self.add(f'<path d="{d}" fill="{fill}"{st}{o}/>')

    def box(self, u0, u1, v0, v1, z0, h, col, edge=True, top=True, left=True, right=True):
        """Caja iso: cara −u clara, cara +v oscura, tapa la más clara. Contorno fino."""
        z1 = z0 + h
        st = rgb(shift(col, -46)) if edge else None
        if left:
            self.fpoly([(u0, v0, z0), (u0, v1, z0), (u0, v1, z1), (u0, v0, z1)], rgb(shift(col, 8)), stroke=st, sw=0.5)
        if right:
            self.fpoly([(u0, v1, z0), (u1, v1, z0), (u1, v1, z1), (u0, v1, z1)], rgb(shift(col, -30)), stroke=st, sw=0.5)
        if top:
            self.fpoly([(u0, v0, z1), (u1, v0, z1), (u1, v1, z1), (u0, v1, z1)], rgb(shift(col, 26)), stroke=st, sw=0.5)

    def cyl(self, u, v, r, z0, h, col, edge=True):
        """Cilindro vertical: elipse base, cuerpo en tres bandas planas, tapa clara."""
        cx, cy = self.p(u, v, z0)
        rx, ry = 11.31 * r, 5.66 * r
        st = rgb(shift(col, -46)) if edge else None
        self.ell(cx, cy, rx, ry, rgb(shift(col, -30)), stroke=st, sw=0.5)
        for (x0, x1, d) in ((-rx, -rx / 3, 8), (-rx / 3, rx / 3, -6), (rx / 3, rx, -30)):
            self.poly([(cx + x0, cy - h), (cx + x1, cy - h), (cx + x1, cy), (cx + x0, cy)], rgb(shift(col, d)))
        if edge:
            self.line((cx - rx, cy - h), (cx - rx, cy), st, 0.5)
            self.line((cx + rx, cy - h), (cx + rx, cy), st, 0.5)
        self.ell(cx, cy - h, rx, ry, rgb(shift(col, 26)), stroke=st, sw=0.5)
        return cx, cy - h, rx, ry

    def flame(self, cx, cy, s=1.0, lean=0.0):
        """Llama en tres tonos planos, base en (cx,cy), alto ≈ 20·s px."""
        def fl(k, dy):
            w, hh = 3.2 * s * k, 20 * s * k
            return (f"M{cx - w:.2f},{cy - dy:.2f} Q{cx - w - 0.4 * s:.2f},{cy - dy - hh * 0.45:.2f} {cx + lean * hh:.2f},{cy - dy - hh:.2f} "
                    f"Q{cx + w + 0.8 * s:.2f},{cy - dy - hh * 0.4:.2f} {cx + w:.2f},{cy - dy:.2f} Z")
        self.path(fl(1.0, 0), "#e8641c")
        self.path(fl(0.62, 0.5 * s), "#f7c33a")
        self.path(fl(0.3, 1.0 * s), "#fff0a0")

    def svg(self):
        return (f'<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.W} {self.H}" '
                f'width="{self.W}" height="{self.H}">\n' + "\n".join(self.out) + "\n</svg>\n")


# ---------------------------------------------------------------- columnas
def k_columna(s, st):
    r = 1.7
    zt = s.H - 32 - 8 - 26          # tope del fuste: deja sitio a collarín + ábaco
    s.cyl(4, 4, r * 1.25, 0, 6, STONE)                  # plinto
    top = s.cyl(4, 4, r, 6, zt - 6, STONE)              # fuste
    cx, cy = s.p(4, 4)
    rx = 11.31 * r
    for k in (-0.55, -0.15, 0.25, 0.65):                # acanaladuras
        s.line((cx + rx * k, top[1] + 2), (cx + rx * k, cy - 8), rgb(shift(STONE, -40)), 0.6, 0.35)
    s.cyl(4, 4, r * 1.15, zt, 8, STONE)                 # collarín
    s.box(4 - r * 1.35, 4 + r * 1.35, 4 - r * 1.35, 4 + r * 1.35, zt + 8, 10, STONE)  # ábaco


def k_columna_base(s, st):
    s.box(1.6, 6.4, 1.6, 6.4, 0, 12, STONE)
    s.cyl(4, 4, 2.1, 12, 6, STONE)


def k_columna_capital(s, st):
    s.cyl(4, 4, 1.7, 0, 10, STONE)
    s.cyl(4, 4, 2.0, 10, 6, STONE)
    s.box(1.6, 6.4, 1.6, 6.4, 16, 10, STONE)


# ---------------------------------------------------------------- suelo con altura
def k_tile_20(s, st):  # umbral de puerta: losa a lo largo de u
    s.box(0, 8, 2.6, 5.4, 0, 4, shift(STONE, -10))
    a, b = s.p(1, 4, 4), s.p(7, 4, 4)
    s.line(a, b, rgb(shift(STONE, -50)), 0.7, 0.5)  # desgaste central


def k_tile_21(s, st):  # escalón: huella + contrahuella
    s.box(0, 8, 3, 8, 0, 10, STONE)
    s.box(0, 8, 5.5, 8, 10, 10, STONE)


# ---------------------------------------------------------------- pared: antorcha, estandarte, tapices, cuadros
def k_antorcha(s, st):
    """Antorcha de pared apagada, grande (lienzo 64×96): soporte, anilla, mango y cabeza."""
    iron, wood = rgb(IRON), rgb(DWOOD)
    s.add(f'<g transform="{s.face()}">')
    a, z = 4 * K, 80
    s.add(f'<rect x="{a - 3:.2f}" y="{z - 22:.2f}" width="6" height="24" fill="{iron}"/>')
    s.poly([(a - 4, z - 26), (a + 4, z - 26), (a + 7, z + 34), (a - 1, z + 34)], wood, stroke=rgb(shift(DWOOD, -50)), sw=0.6)
    for k in (0.3, 0.6):
        s.line((a - 4 + 3 * k + 2, z - 26 + 60 * k), (a + 1 + 3 * k + 2, z - 26 + 60 * k), rgb(shift(DWOOD, -40)), 0.8, 0.6)
    s.ell(a, z, 9, 4, iron, stroke=rgb(shift(IRON, -30)), sw=0.6)
    s.ell(a + 3, z + 36, 10, 5, "#2a2523", stroke="#161412", sw=0.6)
    s.poly([(a - 7, z + 36), (a + 13, z + 36), (a + 11, z + 48), (a - 5, z + 48)], "#3a322c")
    s.add("</g>")


def _banner(s, a, zt, zb, w, col, trim, motif=True):
    s.add(f'<rect x="{a - w - 3.5:.2f}" y="{zt:.2f}" width="{2 * w + 7:.2f}" height="2.2" fill="{rgb(DWOOD)}"/>')
    for k in (-1, 1):
        s.add(f'<circle cx="{a + k * (w + 3.5):.2f}" cy="{zt + 1.1:.2f}" r="2.3" fill="{rgb(shift(DWOOD, 14))}"/>')
    s.poly([(a - w, zt), (a + w, zt), (a + w, zb), (a, zb - 0.55 * w), (a - w, zb)], rgb(col))
    s.poly([(a - w, zt), (a - w + 3, zt), (a - w + 3, zb + 1.7), (a - w, zb)], "#000", op=0.18)
    s.poly([(a - w + 3.4, zt - 3.4), (a + w - 3.4, zt - 3.4), (a + w - 3.4, zb + 1.9), (a, zb - 0.55 * w + 6.5), (a - w + 3.4, zb + 1.9)],
           "none", stroke=rgb(trim), sw=1.5)
    if motif:
        zc = (zt + zb) / 2 + 2
        s.poly([(a, zc + 8), (a + 6.5, zc), (a, zc - 8), (a - 6.5, zc)], rgb(trim))
        s.poly([(a, zc + 4), (a + 3.2, zc), (a, zc - 4), (a - 3.2, zc)], rgb(col))


def k_estandarte(s, st):
    s.add(f'<g transform="{s.face()}">')
    _banner(s, 4 * K, 130, 40, 17, RED, GOLD)
    s.add("</g>")


def _dragon(s, cx, cy, sc, col):
    """Dragón estilizado (silueta plana): cuerpo en S, ala, cabeza y cola."""
    body = (f"M{cx - 16 * sc:.2f},{cy + 6 * sc:.2f} C{cx - 10 * sc:.2f},{cy - 10 * sc:.2f} {cx + 2 * sc:.2f},{cy + 12 * sc:.2f} {cx + 10 * sc:.2f},{cy - 2 * sc:.2f} "
            f"L{cx + 16 * sc:.2f},{cy - 6 * sc:.2f} L{cx + 15 * sc:.2f},{cy:.2f} L{cx + 10 * sc:.2f},{cy + 2 * sc:.2f} "
            f"C{cx + 2 * sc:.2f},{cy + 16 * sc:.2f} {cx - 8 * sc:.2f},{cy - 4 * sc:.2f} {cx - 15 * sc:.2f},{cy + 9 * sc:.2f} Z")
    s.path(body, col)
    s.poly([(cx - 4 * sc, cy - 2 * sc), (cx - 12 * sc, cy - 16 * sc), (cx + 2 * sc, cy - 12 * sc), (cx + 4 * sc, cy - 2 * sc)], col)  # ala
    s.poly([(cx + 14 * sc, cy - 7 * sc), (cx + 17 * sc, cy - 11 * sc), (cx + 18 * sc, cy - 6 * sc)], col)  # cuerno


def k_tapiz_dragones(s, st):
    s.add(f'<g transform="{s.face()}">')
    a = 4 * K
    _banner(s, a, 150, 30, 30, (44, 62, 110), GOLD, motif=False)
    _dragon(s, a, 100, 1.4, rgb(GOLD))
    s.add("</g>")


def k_tapiz_7_dragones(s, st):
    s.add(f'<g transform="{s.face()}">')
    a = 4 * K
    _banner(s, a, 150, 30, 30, RED, GOLD, motif=False)
    pos = [(-17, 122), (0, 122), (17, 122), (-17, 96), (0, 96), (17, 96), (0, 70)]
    for (dx, z) in pos:
        _dragon(s, a + dx, z, 0.45, rgb(GOLD))
    s.add("</g>")


def _frame(s, a, z0, z1, w, tilt=0.0):
    """Marco dorado en el plano de pared, centrado en a; devuelve el interior."""
    g = f'<g transform="rotate({tilt:.1f} {a:.2f} {(z0 + z1) / 2:.2f})">' if tilt else "<g>"
    s.add(g)
    s.poly([(a - w, z0), (a + w, z0), (a + w, z1), (a - w, z1)], rgb(GOLD), stroke=rgb(shift(GOLD, -70)), sw=0.8)
    s.poly([(a - w + 3.5, z0 + 3.5), (a + w - 3.5, z0 + 3.5), (a + w - 3.5, z1 - 3.5), (a - w + 3.5, z1 - 3.5)], "none", stroke=rgb(shift(GOLD, -60)), sw=0.7)
    return (a - w + 4.5, z0 + 4.5, a + w - 4.5, z1 - 4.5)


def k_cuadro_rey(s, st):
    s.add(f'<g transform="{s.face()}">')
    a = 4 * K
    if st == "torcido":  # escondite revelado detrás
        s.poly([(a - 22, 60), (a + 22, 60), (a + 22, 118), (a - 22, 118)], "#1e1a17")
        s.poly([(a - 14, 66), (a + 4, 66), (a + 4, 78), (a - 14, 78)], rgb(shift(GOLD, -20)))  # objeto dentro
    x0, y0, x1, y1 = _frame(s, a, 52, 130, 26, tilt=-14 if st == "torcido" else 0)
    s.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], "#5a3a3a")
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    s.poly([(cx - 13, y0 + 0.5), (cx + 13, y0 + 0.5), (cx + 10, cy - 4), (cx - 10, cy - 4)], rgb(RED))       # manto
    s.add(f'<circle cx="{cx:.2f}" cy="{cy + 10:.2f}" r="9" fill="{rgb(SKIN)}"/>')
    s.poly([(cx - 9, cy + 16), (cx + 9, cy + 16), (cx + 8, cy + 24), (cx - 3, cy + 27), (cx - 8, cy + 24)], rgb(GOLD))  # corona
    s.poly([(cx - 8, cy + 24), (cx - 5, cy + 30), (cx - 2, cy + 24), (cx + 1, cy + 30), (cx + 4, cy + 24), (cx + 8, cy + 24)], rgb(GOLD))
    s.add(f'<circle cx="{cx - 3.5:.2f}" cy="{cy + 12:.2f}" r="1" fill="#2a2523"/><circle cx="{cx + 3.5:.2f}" cy="{cy + 12:.2f}" r="1" fill="#2a2523"/>')
    s.poly([(cx - 6, cy + 4), (cx + 6, cy + 4), (cx + 3, cy - 4), (cx - 3, cy - 4)], "#e8e0d0")  # barba
    s.add("</g></g>")


def k_cuadro_reino(s, st):
    s.add(f'<g transform="{s.face()}">')
    a = 4 * K
    x0, y0, x1, y1 = _frame(s, a, 52, 130, 26)
    s.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], "#8fb6d8")                                   # cielo
    s.poly([(x0, y0), (x1, y0), (x1, y0 + 22), (x0 + 20, y0 + 12), (x0, y0 + 24)], "#6f9a4e")     # colinas
    n = 4 if st == "4torres" else 3
    xs = [x0 + 8 + k * (x1 - x0 - 16) / (n - 1) for k in range(n)]
    s.poly([(xs[0] - 3, y0 + 16), (xs[-1] + 3, y0 + 16), (xs[-1] + 3, y0 + 32), (xs[0] - 3, y0 + 32)], rgb(shift(STONE, -20)))  # muralla
    for x in xs:
        s.poly([(x - 4, y0 + 14), (x + 4, y0 + 14), (x + 4, y0 + 44), (x - 4, y0 + 44)], rgb(STONE))
        s.poly([(x - 5, y0 + 44), (x + 5, y0 + 44), (x, y0 + 54)], rgb(RED))
    s.add("</g></g>")


# ---------------------------------------------------------------- muebles y objetos
def k_trono(s, st):
    s.box(1.5, 6.5, 1.5, 6.5, 0, 12, DWOOD)                       # tarima
    s.box(2.2, 5.8, 2.6, 5.8, 12, 22, DWOOD)                      # asiento
    s.fpoly([(2.4, 2.8, 34), (5.6, 2.8, 34), (5.6, 5.6, 34), (2.4, 5.6, 34)], rgb(RED))   # cojín
    s.box(2.2, 5.8, 2.2, 2.9, 12, 96, DWOOD)                      # respaldo (fondo de la celda)
    for u in (2.2, 5.2):                                          # brazos
        s.box(u, u + 0.6, 2.9, 5.8, 34, 14, DWOOD)
    cx, cy = s.p(4, 2.5, 108)
    s.poly([(cx - 22, cy + 4), (cx, cy - 18), (cx + 22, cy + 4)], rgb(DWOOD), stroke=rgb(shift(DWOOD, -46)), sw=0.5)  # remate
    s.poly([(cx - 5, cy - 2), (cx, cy - 12), (cx + 5, cy - 2), (cx, cy + 4)], rgb(GOLD))
    for z in (30, 60, 90):
        a, b = s.p(2.2, 2.2, z), s.p(5.8, 2.2, z)
        s.line(a, b, rgb(GOLD), 1.2, 0.8)


def k_armario(s, st):
    s.box(1.2, 6.8, 2.0, 5.2, 0, 4, DWOOD)                        # zócalo
    s.box(1.4, 6.6, 2.2, 5.0, 4, 176, WOOD, right=st != "abierto")
    if st == "abierto":
        # frente abierto: interior oscuro con baldas, puertas abatidas a los lados
        s.fpoly([(1.4, 5.0, 4), (6.6, 5.0, 4), (6.6, 5.0, 180), (1.4, 5.0, 180)], "#2a221c")
        for z in (50, 96, 142):
            s.fpoly([(1.5, 5.0, z), (6.5, 5.0, z), (6.5, 4.4, z), (1.5, 4.4, z)], rgb(shift(WOOD, -20)))
        s.fpoly([(1.4, 5.0, 4), (1.4, 7.4, 4), (1.4, 7.4, 180), (1.4, 5.0, 180)], rgb(shift(WOOD, -30)), stroke=rgb(shift(WOOD, -60)), sw=0.5)
        s.fpoly([(6.6, 5.0, 4), (6.6, 7.4, 4), (6.6, 7.4, 180), (6.6, 5.0, 180)], rgb(shift(WOOD, -30)), stroke=rgb(shift(WOOD, -60)), sw=0.5)
    else:
        a, b = s.p(4.0, 5.0, 8), s.p(4.0, 5.0, 176)
        s.line(a, b, rgb(shift(WOOD, -60)), 1.0)
        for (u, z) in ((3.6, 92), (4.4, 92)):
            x, y = s.p(u, 5.0, z)
            s.ell(x, y, 1.6, 1.6, rgb(IRON))
        for z in (30, 150):
            s.line(s.p(1.4, 5.0, z), s.p(6.6, 5.0, z), rgb(shift(WOOD, -50)), 0.7, 0.6)
    s.box(1.2, 6.8, 2.0, 5.2, 180, 6, DWOOD)                      # cornisa


def k_arca(s, st):
    s.box(1.6, 6.4, 2.4, 5.6, 0, 30, DWOOD)
    for v in (3.0, 5.0):                                          # flejes
        s.fpoly([(1.6, v - 0.25, 0), (1.6, v + 0.25, 0), (1.6, v + 0.25, 30), (1.6, v - 0.25, 30)], rgb(IRON))
    for u in (2.4, 5.6):
        s.fpoly([(u - 0.25, 5.6, 0), (u + 0.25, 5.6, 0), (u + 0.25, 5.6, 30), (u - 0.25, 5.6, 30)], rgb(IRON))
    if st == "abierta":
        s.fpoly([(1.8, 2.6, 30), (6.2, 2.6, 30), (6.2, 5.4, 30), (1.8, 5.4, 30)], "#1e1a17")
        s.fpoly([(2.4, 3.2, 31), (5.6, 3.2, 31), (5.6, 4.8, 31), (2.4, 4.8, 31)], rgb(GOLD), op=0.9)
        s.box(1.6, 6.4, 2.4, 2.9, 30, 44, DWOOD)                  # tapa levantada (de canto al fondo)
    else:
        s.box(1.6, 6.4, 2.4, 5.6, 30, 8, DWOOD)
        x, y = s.p(4, 5.6, 22)
        s.poly([(x - 3, y), (x + 3, y), (x + 3, y + 6), (x - 3, y + 6)], rgb(IRON))  # cerradura
        s.ell(x, y + 3, 1, 1, rgb(GOLD))


def k_brasero(s, st):
    for (u, v) in ((2.6, 4.0), (5.4, 4.0), (4.0, 5.6)):           # patas
        s.box(u - 0.25, u + 0.25, v - 0.25, v + 0.25, 0, 24, IRON, edge=False)
    top = s.cyl(4, 4, 2.2, 24, 14, IRON)
    s.ell(top[0], top[1], top[2] * 0.82, top[3] * 0.82, "#2a2523")
    if st == "encendido":
        s.ell(top[0], top[1], top[2] * 0.7, top[3] * 0.7, "#c8461c")
        for (dx, sc) in ((-8, 0.8), (0, 1.3), (8, 0.9)):
            s.flame(top[0] + dx, top[1] + 1, sc)
    else:
        for (dx, dy) in ((-6, 0), (5, -1), (0, 2)):
            s.ell(top[0] + dx, top[1] + dy, 4, 2, "#4a4340")


def k_estatua_caballero(s, st):
    s.box(2.0, 6.0, 2.0, 6.0, 0, 28, STONE)                       # pedestal
    g = rgb(STONE)
    cx, cy = s.p(4, 4, 28)
    d = rgb(shift(STONE, -46))
    s.poly([(cx - 9, cy), (cx + 9, cy), (cx + 11, cy - 60), (cx - 11, cy - 60)], g, stroke=d, sw=0.6)     # cuerpo
    s.poly([(cx - 9, cy - 60), (cx + 9, cy - 60), (cx + 12, cy - 70), (cx - 12, cy - 70)], rgb(shift(STONE, 8)), stroke=d, sw=0.6)  # hombros
    s.add(f'<circle cx="{cx:.2f}" cy="{cy - 82:.2f}" r="10" fill="{rgb(shift(STONE, 12))}" stroke="{d}" stroke-width="0.6"/>')  # yelmo
    s.line((cx - 7, cy - 82), (cx + 7, cy - 82), d, 1.2)          # visera
    s.poly([(cx - 22, cy - 62), (cx - 6, cy - 62), (cx - 6, cy - 30), (cx - 14, cy - 22), (cx - 22, cy - 30)], rgb(shift(STONE, -14)), stroke=d, sw=0.6)  # escudo
    s.line((cx + 14, cy - 8), (cx + 14, cy - 72), d, 2.2)         # espada
    s.line((cx + 9, cy - 62), (cx + 19, cy - 62), d, 2.2)


def k_placa(s, st):
    h = {"arriba": 6, "hundida": 1.5}.get(st, 4)
    col = shift(STONE, -30) if st == "hundida" else STONE
    s.box(2.2, 5.8, 2.2, 5.8, 0, h, col)
    s.fpoly([(2.8, 2.8, h), (5.2, 2.8, h), (5.2, 5.2, h), (2.8, 5.2, h)], "none", stroke=rgb(shift(col, -50)), sw=0.7, op=0.6)


def k_puerta(s, st):
    # jambas y dintel de piedra en el plano v=0; hoja de madera
    s.add(f'<g transform="{s.face()}">')
    a, w, h = 4 * K, 22, 120
    s.poly([(a - w - 8, 0), (a - w, 0), (a - w, h + 8), (a - w - 8, h + 8)], rgb(STONE), stroke=rgb(shift(STONE, -46)), sw=0.6)
    s.poly([(a + w, 0), (a + w + 8, 0), (a + w + 8, h + 8), (a + w, h + 8)], rgb(STONE), stroke=rgb(shift(STONE, -46)), sw=0.6)
    s.poly([(a - w - 8, h + 8), (a + w + 8, h + 8), (a + w + 8, h + 20), (a - w - 8, h + 20)], rgb(shift(STONE, 10)), stroke=rgb(shift(STONE, -46)), sw=0.6)
    if st == "abierta":
        s.poly([(a - w, 0), (a + w, 0), (a + w, h + 8), (a - w, h + 8)], "#1a1614")
        s.add("</g>")
        # hoja abierta hacia el jugador: en el plano u = u0 (perpendicular a la pared)
        u0 = 4 - w / K
        s.fpoly([(u0, 0, 0), (u0, 2 * w / K, 0), (u0, 2 * w / K, h + 8), (u0, 0, h + 8)], rgb(WOOD), stroke=rgb(shift(WOOD, -60)), sw=0.6)
        for k in (0.33, 0.66):
            s.line(s.p(u0, 2 * w / K * k, 2), s.p(u0, 2 * w / K * k, h + 4), rgb(shift(WOOD, -50)), 0.7, 0.7)
        for z in (28, h - 20):
            s.fpoly([(u0, 0.2, z), (u0, 2 * w / K - 0.2, z), (u0, 2 * w / K - 0.2, z + 5), (u0, 0.2, z + 5)], rgb(IRON))
        return
    s.poly([(a - w, 0), (a + w, 0), (a + w, h + 8), (a - w, h + 8)], rgb(WOOD))
    for k in range(1, 4):
        x = a - w + 2 * w * k / 4
        s.line((x, 2), (x, h + 6), rgb(shift(WOOD, -50)), 0.8, 0.7)
    for z in (28, h - 20):
        s.poly([(a - w + 1, z), (a + w - 1, z), (a + w - 1, z + 5), (a - w + 1, z + 5)], rgb(IRON))
        for x in (a - w + 5, a, a + w - 5):
            s.add(f'<circle cx="{x:.2f}" cy="{z + 2.5:.2f}" r="1" fill="{rgb(shift(IRON, 50))}"/>')
    s.add(f'<circle cx="{a + w - 7:.2f}" cy="{h / 2:.2f}" r="2.6" fill="{rgb(IRON)}"/>')
    s.add("</g>")


def k_mural(s, st):
    s.add(f'<g transform="{s.face()}">')
    a, w, z0, n = 4 * K, 28, 50, 4
    s.poly([(a - w - 3, z0 - 3), (a + w + 3, z0 - 3), (a + w + 3, z0 + 2 * w + 3), (a - w - 3, z0 + 2 * w + 3)], rgb(STONE), stroke=rgb(shift(STONE, -46)), sw=0.6)
    pal = ["#2f5f9e", "#d8d0c0", "#b8352c", "#c9a04a"]
    rnd = random.Random(3)
    cell = 2 * w / n
    for i in range(n):
        for j in range(n):
            ring = max(abs(i - 1.5), abs(j - 1.5))  # 0.5 centro, 1.5 borde
            if st == "completo":
                col = pal[0] if ring > 1 else pal[2]
                inner = pal[3] if ring > 1 else pal[1]
            elif st == "desordenado":
                col, inner = rnd.choice(pal), rnd.choice(pal)
            else:
                col, inner = pal[1], pal[1]
            x, z = a - w + i * cell, z0 + j * cell
            s.poly([(x + 0.6, z + 0.6), (x + cell - 0.6, z + 0.6), (x + cell - 0.6, z + cell - 0.6), (x + 0.6, z + cell - 0.6)], col)
            c = cell / 2
            s.poly([(x + c, z + 2.5), (x + cell - 2.5, z + c), (x + c, z + cell - 2.5), (x + 2.5, z + c)], inner)
    s.add("</g>")


def _chalice(s, cx, cy, sc=1.0, col=GOLD):
    g, d = rgb(col), rgb(shift(col, -70))
    s.ell(cx, cy, 7 * sc, 2.6 * sc, g, stroke=d, sw=0.5)                                       # pie
    s.poly([(cx - 1.6 * sc, cy), (cx + 1.6 * sc, cy), (cx + 1.6 * sc, cy - 9 * sc), (cx - 1.6 * sc, cy - 9 * sc)], g, stroke=d, sw=0.5)
    s.poly([(cx - 7 * sc, cy - 20 * sc), (cx + 7 * sc, cy - 20 * sc), (cx + 4 * sc, cy - 9 * sc), (cx - 4 * sc, cy - 9 * sc)], g, stroke=d, sw=0.5)  # copa
    s.ell(cx, cy - 20 * sc, 7 * sc, 2.4 * sc, rgb(shift(col, 30)), stroke=d, sw=0.5)


def k_ranura(s, st):
    s.box(2.6, 5.4, 2.6, 5.4, 0, 18, STONE)
    cx, cy = s.p(4, 4, 18)
    s.ell(cx, cy, 6, 3, "#2a2523")
    if st == "con-caliz":
        _chalice(s, cx, cy - 1)


def k_compartimento(s, st):
    s.add(f'<g transform="{s.face()}">')
    a, w, z0, h = 4 * K, 20, 56, 40
    s.poly([(a - w - 4, z0 - 4), (a + w + 4, z0 - 4), (a + w + 4, z0 + h + 4), (a - w - 4, z0 + h + 4)], rgb(shift(STONE, -12)), stroke=rgb(shift(STONE, -46)), sw=0.6)
    if st == "abierto":
        s.poly([(a - w, z0), (a + w, z0), (a + w, z0 + h), (a - w, z0 + h)], "#1e1a17")
        s.poly([(a - w, z0 + 4), (a - w + 4, z0 + 4), (a - w + 4, z0 + h - 4), (a - w, z0 + h - 4)], rgb(shift(STONE, -30)))  # derrame
        s.poly([(a - 8, z0 + 6), (a + 8, z0 + 6), (a + 8, z0 + 14), (a - 8, z0 + 14)], rgb(shift(GOLD, -10)))               # objeto
        s.poly([(a + w, z0), (a + w + 30, z0 + 14), (a + w + 30, z0 + h + 14), (a + w, z0 + h)], rgb(STONE), stroke=rgb(shift(STONE, -46)), sw=0.6)  # losa abierta
    else:
        s.poly([(a - w, z0), (a + w, z0), (a + w, z0 + h), (a - w, z0 + h)], rgb(STONE), stroke=rgb(shift(STONE, -46)), sw=0.6)
        s.line((a - w + 6, z0 + h / 2), (a + w - 6, z0 + h / 2), rgb(shift(STONE, -40)), 0.8, 0.6)
    s.add("</g>")


def k_mesa(s, st):
    for (u, v) in ((-1.2, 1.8), (9.2, 1.8), (-1.2, 6.2), (9.2, 6.2)):   # patas (mesa de 2 celdas de largo)
        s.box(u - 0.3, u + 0.3, v - 0.3, v + 0.3, 0, 30, DWOOD, edge=False)
    s.box(-1.6, 9.6, 1.4, 6.6, 30, 5, WOOD)
    for k in range(1, 4):
        s.line(s.p(-1.6, 1.4 + 5.2 * k / 4, 35), s.p(9.6, 1.4 + 5.2 * k / 4, 35), rgb(shift(WOOD, -40)), 0.6, 0.6)
    if st != "mesa":
        for (u, v) in ((0.5, 4), (2.5, 4), (4.5, 4), (6.5, 4), (8.5, 4)):
            top = s.cyl(u, v, 0.45, 35, 9, shift(CLAY, -10) if st != "activa" else GOLD)
            s.ell(top[0], top[1], top[2] * 0.7, top[3] * 0.7, "#5a2a2a" if st != "activa" else "#f7c33a")
        if st == "activa":
            s.fpoly([(0, 3.3, 35), (9, 3.3, 35), (9, 4.7, 35), (0, 4.7, 35)], "#fff0a0", op=0.25)


def k_reja(s, st):
    s.add(f'<g transform="{s.face()}">')
    a, w, h = 4 * K, 24, 116
    s.poly([(a - w - 8, 0), (a - w, 0), (a - w, h + 8), (a - w - 8, h + 8)], rgb(STONE), stroke=rgb(shift(STONE, -46)), sw=0.6)
    s.poly([(a + w, 0), (a + w + 8, 0), (a + w + 8, h + 8), (a + w, h + 8)], rgb(STONE), stroke=rgb(shift(STONE, -46)), sw=0.6)
    s.poly([(a - w - 8, h + 8), (a + w + 8, h + 8), (a + w + 8, h + 20), (a - w - 8, h + 20)], rgb(shift(STONE, 10)), stroke=rgb(shift(STONE, -46)), sw=0.6)
    s.poly([(a - w, 0), (a + w, 0), (a + w, h + 8), (a - w, h + 8)], "#1a1614", op=0.6)
    if st == "abierta":
        s.add("</g>")
        u0 = 4 - w / K
        for k in range(6):
            v = 0.3 + (2 * w / K - 0.6) * k / 5
            s.line(s.p(u0, v, 2), s.p(u0, v, h + 2), rgb(IRON), 2.2)
        for z in (12, h / 2, h - 8):
            s.line(s.p(u0, 0, z), s.p(u0, 2 * w / K, z), rgb(shift(IRON, -20)), 2.6)
        return
    for k in range(6):
        x = a - w + 3 + (2 * w - 6) * k / 5
        s.line((x, 2), (x, h + 4), rgb(IRON), 2.2)
    for z in (12, h / 2, h - 8):
        s.line((a - w, z), (a + w, z), rgb(shift(IRON, -20)), 2.6)
    s.add("</g>")


def k_mirilla(s, st):
    s.add(f'<g transform="{s.face()}">')
    a, z = 4 * K, 70
    s.add(f'<circle cx="{a:.2f}" cy="{z:.2f}" r="24" fill="{rgb(IRON)}" stroke="{rgb(shift(IRON, -30))}" stroke-width="1"/>')
    s.add(f'<circle cx="{a:.2f}" cy="{z:.2f}" r="19" fill="none" stroke="{rgb(shift(IRON, 40))}" stroke-width="1" opacity="0.7"/>')
    s.poly([(a - 12, z - 3.5), (a + 12, z - 3.5), (a + 12, z + 3.5), (a - 12, z + 3.5)], "#111")
    s.poly([(a - 12, z - 3.5), (a + 12, z - 3.5), (a + 12, z - 1.5), (a - 12, z - 1.5)], "#3a3a3c")
    for k in range(4):
        ang = math.pi / 4 + k * math.pi / 2
        s.add(f'<circle cx="{a + 20.5 * math.cos(ang):.2f}" cy="{z + 20.5 * math.sin(ang):.2f}" r="2" fill="{rgb(shift(IRON, 50))}"/>')
    s.add("</g>")


def k_sarcofago(s, st):
    s.box(-1.4, 9.4, 2.2, 5.8, 0, 26, STONE)
    s.box(-1.2, 9.2, 2.4, 5.6, 26, 8, shift(STONE, 6))
    # figura yacente en relieve (contorno)
    d = rgb(shift(STONE, -46))
    s.fpoly([(0.4, 3.2, 34), (7.4, 3.2, 34), (7.4, 4.8, 34), (0.4, 4.8, 34)], rgb(shift(STONE, 16)), stroke=d, sw=0.6)
    cx, cy = s.p(7.9, 4.0, 34)
    s.ell(cx, cy, 5, 2.6, rgb(shift(STONE, 20)), stroke=d, sw=0.6)
    s.line(s.p(1.5, 4.0, 35), s.p(6.5, 4.0, 35), d, 1.4, 0.7)          # espada


def k_altar(s, st):
    s.box(1.2, 6.8, 1.2, 6.8, 0, 8, STONE)
    s.box(1.8, 6.2, 1.8, 6.2, 8, 40, shift(STONE, -8))
    s.box(1.2, 6.8, 1.2, 6.8, 48, 8, STONE)
    cx, cy = s.p(4, 4, 56)
    s.ell(cx, cy, 20, 10, rgb(shift(STONE, -40)), stroke=rgb(shift(STONE, -60)), sw=0.6)   # pila
    if st == "con-agua":
        s.ell(cx, cy, 16, 8, rgb(WATER))
        s.ell(cx - 4, cy - 2, 6, 2, "#fff", op=0.35)
    else:
        s.ell(cx, cy, 16, 8, "#4a4643")
    s.box(1.8, 6.2, 1.8, 2.3, 56, 40, shift(STONE, -4))              # retablo trasero
    s.fpoly([(2.6, 1.8, 66), (5.4, 1.8, 66), (5.4, 1.8, 90), (2.6, 1.8, 90)], rgb(GOLD), op=0.9)


def k_canal(s, st):
    s.box(0, 8, 2.5, 5.5, 0, 6, STONE, top=False)
    s.fpoly([(0, 2.5, 6), (8, 2.5, 6), (8, 3.1, 6), (0, 3.1, 6)], rgb(shift(STONE, 26)))
    s.fpoly([(0, 4.9, 6), (8, 4.9, 6), (8, 5.5, 6), (0, 5.5, 6)], rgb(shift(STONE, 26)))
    s.fpoly([(0, 3.1, 6), (8, 3.1, 6), (8, 3.1, 2), (0, 3.1, 2)], rgb(shift(STONE, -40)))
    s.fpoly([(0, 3.1, 2), (8, 3.1, 2), (8, 4.9, 2), (0, 4.9, 2)], rgb(WATER))
    for k in range(4):
        s.line(s.p(0.8 + 2 * k, 3.6, 2.5), s.p(1.8 + 2 * k, 3.8, 2.5), "#fff", 0.8, 0.4)


def k_compuerta(s, st):
    s.add(f'<g transform="{s.face()}">')
    a, w, h = 4 * K, 18, 70
    for x in (a - w - 6, a + w):
        s.poly([(x, 0), (x + 6, 0), (x + 6, h + 40), (x, h + 40)], rgb(STONE), stroke=rgb(shift(STONE, -46)), sw=0.6)
    s.poly([(a - w - 6, h + 40), (a + w + 6, h + 40), (a + w + 6, h + 48), (a - w - 6, h + 48)], rgb(shift(DWOOD, -10)))
    z0 = 40 if st == "abierta" else 0
    s.poly([(a - w, z0), (a + w, z0), (a + w, z0 + h), (a - w, z0 + h)], rgb(WOOD), stroke=rgb(shift(WOOD, -60)), sw=0.6)
    for k in range(1, 5):
        s.line((a - w + 1, z0 + h * k / 5), (a + w - 1, z0 + h * k / 5), rgb(shift(WOOD, -50)), 0.7, 0.7)
    s.poly([(a - w + 1, z0 + h - 6), (a + w - 1, z0 + h - 6), (a + w - 1, z0 + h - 2), (a - w + 1, z0 + h - 2)], rgb(IRON))
    s.line((a, z0 + h), (a, h + 40), rgb(shift(IRON, 20)), 1.4)     # cadena
    if st == "abierta":
        s.poly([(a - w, 0), (a + w, 0), (a + w, 40), (a - w, 40)], rgb(WATER), op=0.85)
    s.add("</g>")


def k_relicario(s, st):
    s.box(2.4, 5.6, 2.4, 5.6, 0, 20, STONE)                          # peana
    s.box(2.9, 5.1, 3.1, 4.9, 20, 16, GOLD)
    if st == "abierto":
        s.fpoly([(3.0, 3.2, 36), (5.0, 3.2, 36), (5.0, 4.8, 36), (3.0, 4.8, 36)], "#3a2a2a")
        s.fpoly([(3.6, 3.6, 37), (4.4, 3.6, 37), (4.4, 4.4, 37), (3.6, 4.4, 37)], "#fff0a0")
        s.box(2.9, 5.1, 3.1, 3.4, 36, 18, GOLD)                      # tapa levantada
    else:
        s.box(2.9, 5.1, 3.1, 4.9, 36, 6, GOLD)
        x, y = s.p(4.0, 4.9, 30)
        if st == "sellado":
            s.ell(x, y, 2.6, 2.6, rgb(RED), stroke=rgb(shift(RED, -50)), sw=0.5)
        else:
            s.ell(x, y, 1.2, 1.2, rgb(IRON))
    for u in (3.2, 4.8):
        s.line(s.p(u, 4.9, 21), s.p(u, 4.9, 41), rgb(shift(GOLD, -60)), 0.6, 0.7)


def _pot(s, u, v, r, h, col):
    cx, cy = s.p(u, v)
    rx, ry = 11.31 * r, 5.66 * r
    d = rgb(shift(col, -60))
    s.path(f"M{cx - rx * 0.6:.2f},{cy:.2f} Q{cx - rx * 1.5:.2f},{cy - h * 0.5:.2f} {cx - rx * 0.55:.2f},{cy - h:.2f} "
           f"L{cx + rx * 0.55:.2f},{cy - h:.2f} Q{cx + rx * 1.5:.2f},{cy - h * 0.5:.2f} {cx + rx * 0.6:.2f},{cy:.2f} Z", rgb(col), stroke=d, sw=0.5)
    s.path(f"M{cx - rx * 0.6:.2f},{cy:.2f} Q{cx - rx * 1.5:.2f},{cy - h * 0.5:.2f} {cx - rx * 0.55:.2f},{cy - h:.2f} L{cx - rx * 0.2:.2f},{cy - h:.2f} "
           f"Q{cx - rx * 0.9:.2f},{cy - h * 0.5:.2f} {cx - rx * 0.25:.2f},{cy:.2f} Z", rgb(shift(col, 14)))
    s.ell(cx, cy - h, rx * 0.55, ry * 0.55, "#3a2a20", stroke=d, sw=0.5)


def k_vasijas_8(s, st):
    rnd = random.Random(8)
    for (u, v) in ((-1.0, 2.2), (1.6, 1.8), (4.2, 2.0), (6.8, 2.4), (0.0, 5.0), (2.6, 5.6), (5.2, 5.3), (7.8, 5.8)):
        _pot(s, u, v, 0.85, rnd.uniform(26, 36), shift(CLAY, rnd.randint(-16, 16)))


def _barrel(s, u, v, col=WOOD):
    cx, cy = s.p(u, v)
    r, h = 1.5, 40
    rx, ry = 11.31 * r, 5.66 * r
    d = rgb(shift(col, -60))
    body = (f"M{cx - rx:.2f},{cy:.2f} Q{cx - rx * 1.35:.2f},{cy - h / 2:.2f} {cx - rx:.2f},{cy - h:.2f} L{cx + rx:.2f},{cy - h:.2f} "
            f"Q{cx + rx * 1.35:.2f},{cy - h / 2:.2f} {cx + rx:.2f},{cy:.2f} Z")
    s.ell(cx, cy, rx, ry, rgb(shift(col, -30)))
    s.path(body, rgb(col), stroke=d, sw=0.5)
    s.path(f"M{cx + rx * 0.3:.2f},{cy:.2f} Q{cx + rx * 0.4:.2f},{cy - h / 2:.2f} {cx + rx * 0.3:.2f},{cy - h:.2f} L{cx + rx:.2f},{cy - h:.2f} "
           f"Q{cx + rx * 1.35:.2f},{cy - h / 2:.2f} {cx + rx:.2f},{cy:.2f} Z", rgb(shift(col, -30)))
    for k in (-0.6, -0.2, 0.2, 0.6):
        s.path(f"M{cx + rx * k:.2f},{cy - h:.2f} Q{cx + rx * k * 1.3:.2f},{cy - h / 2:.2f} {cx + rx * k:.2f},{cy:.2f}", "none", stroke=d, sw=0.5, op=0.5)
    for z in (h * 0.22, h * 0.78):
        s.path(f"M{cx - rx * (1 + 0.3 * (1 - abs(z / h - 0.5) * 2)):.2f},{cy - z:.2f} L{cx + rx * (1 + 0.3 * (1 - abs(z / h - 0.5) * 2)):.2f},{cy - z:.2f}", "none", stroke=rgb(IRON), sw=2.4)
    s.ell(cx, cy - h, rx, ry, rgb(shift(col, 20)), stroke=d, sw=0.5)


def k_barril(s, st):
    if st == "movido":
        cx, cy = s.p(4, 4)
        s.ell(cx, cy, 14, 7, "#141210")                               # hueco revelado
        _barrel(s, 5.4, 5.6)
    else:
        _barrel(s, 4, 4)


def k_barriles(s, st):
    _barrel(s, 2.4, 3.0)
    _barrel(s, 5.6, 3.0)
    _barrel(s, 4.0, 5.6)


# ---------------------------------------------------------------- iconos (64×64)
def k_icon(s, st):
    c = 64
    if st == "antorcha":
        s.poly([(c - 6, 112), (c + 2, 108), (c + 24, 62), (c + 16, 58)], rgb(DWOOD), stroke=rgb(shift(DWOOD, -50)), sw=1)
        s.ell(c + 20, 58, 12, 7, "#2a2523")
        s.flame(c + 20, 58, 2.2)
    elif st == "caliz":
        _chalice(s, c, 108, 3.6)
    elif st == "espejo":
        s.ell(c, 56, 32, 40, rgb(GOLD), stroke=rgb(shift(GOLD, -70)), sw=1.2)
        s.ell(c, 56, 24, 32, "#a9d3e6")
        s.line((c - 12, 40), (c + 4, 72), "#fff", 5, 0.6)
        s.poly([(c - 5, 92), (c + 5, 92), (c + 4, 118), (c - 4, 118)], rgb(GOLD), stroke=rgb(shift(GOLD, -70)), sw=1.2)
    elif st.startswith("llave-"):
        col = {"bronce": (176, 110, 60), "plata": (200, 204, 210), "oro": GOLD}[st[6:]]
        d = rgb(shift(col, -70))
        s.add(f'<g transform="rotate(-40 {c} {c})">')
        s.add(f'<circle cx="{c - 26}" cy="{c}" r="16" fill="none" stroke="{rgb(col)}" stroke-width="9"/>')
        s.add(f'<circle cx="{c - 26}" cy="{c}" r="16" fill="none" stroke="{d}" stroke-width="1.2"/>')
        s.poly([(c - 10, c - 4), (c + 38, c - 4), (c + 38, c + 4), (c - 10, c + 4)], rgb(col), stroke=d, sw=1.2)
        s.poly([(c + 22, c + 4), (c + 28, c + 4), (c + 28, c + 16), (c + 22, c + 16)], rgb(col), stroke=d, sw=1.2)
        s.poly([(c + 32, c + 4), (c + 38, c + 4), (c + 38, c + 14), (c + 32, c + 14)], rgb(col), stroke=d, sw=1.2)
        s.add("</g>")
    elif st == "mechero":  # eslabón y pedernal
        s.path(f"M{c - 30},{c + 10} C{c - 34},{c - 22} {c + 4},{c - 26} {c + 8},{c - 2} C{c + 10},{c + 14} {c - 6},{c + 16} {c - 10},{c + 4}",
               "none", stroke=rgb(IRON), sw=9)
        s.path(f"M{c - 30},{c + 10} C{c - 34},{c - 22} {c + 4},{c - 26} {c + 8},{c - 2} C{c + 10},{c + 14} {c - 6},{c + 16} {c - 10},{c + 4}",
               "none", stroke=rgb(shift(IRON, 50)), sw=1.4, op=0.6)
        s.poly([(c + 8, c + 22), (c + 30, c + 14), (c + 36, c + 30), (c + 18, c + 38)], "#7a7266", stroke="#4a4540", sw=1.2)
        for (dx, dy) in ((10, -18), (18, -24), (24, -14)):
            s.poly([(c + dx, c + dy), (c + dx + 3, c + dy - 6), (c + dx + 5, c + dy + 1)], "#f7c33a")
    elif st == "pergamino":
        s.poly([(c - 30, 40), (c + 30, 40), (c + 30, 88), (c - 30, 88)], rgb(CREAM), stroke="#a08a5a", sw=1.2)
        for y in (52, 60, 68, 76):
            s.line((c - 22, y), (c + 22 - (8 if y == 76 else 0), y), "#8a7450", 1.6, 0.7)
        s.ell(c, 40, 32, 7, rgb(shift(CREAM, -18)), stroke="#a08a5a", sw=1.2)
        s.ell(c, 88, 32, 7, rgb(shift(CREAM, -18)), stroke="#a08a5a", sw=1.2)
    elif st == "busto":
        d = rgb(shift(STONE, -46))
        s.poly([(c - 16, 118), (c + 16, 118), (c + 13, 100), (c - 13, 100)], rgb(shift(STONE, -10)), stroke=d, sw=1.2)  # peana
        s.poly([(c - 20, 100), (c + 20, 100), (c + 15, 62), (c - 15, 62)], rgb(STONE), stroke=d, sw=1.2)  # hombros/torso
        s.poly([(c - 6, 66), (c + 6, 66), (c + 6, 56), (c - 6, 56)], rgb(shift(STONE, -14)))  # cuello
        s.add(f'<circle cx="{c}" cy="44" r="18" fill="{rgb(shift(STONE, 12))}" stroke="{d}" stroke-width="1.2"/>')  # cabeza
        s.line((c - 9, 36), (c - 3, 52), "#fff", 3, 0.25)  # filo claro
    elif st == "vela":
        s.ell(c, 108, 26, 9, rgb(IRON), stroke=rgb(shift(IRON, -30)), sw=1)
        s.poly([(c - 10, 106), (c + 10, 106), (c + 10, 52), (c - 10, 52)], rgb(CREAM), stroke="#a08a5a", sw=1)
        s.poly([(c - 10, 52), (c + 10, 52), (c + 6, 58), (c - 4, 60)], "#d9c9a0")
        s.line((c, 52), (c, 44), "#2a2523", 2)
        s.flame(c, 46, 1.4)
    else:
        raise SystemExit(f"icono desconocido: {st}")


# ---------------------------------------------------------------- avatar (28 frames)
def _avatar_frame(d, anim, k):
    """Personaje sencillo, base tintable (túnica gris clara). d: n/e/s/w."""
    s = S("avatar")
    cx, gy = 64, s.yc + 18          # pies
    skin, hair, tun, dark = rgb(SKIN), rgb(HAIR), rgb(TUNIC), rgb(shift(TUNIC, -70))
    step = [6, 0, -6, 0][k] if anim == "walk" else 0
    bob = ([0, 2, 0, 2][k] if anim == "walk" else [0, 1][k] if anim == "idle" else 0)
    mirror = d == "w"
    s.add(f'<g transform="translate({2 * cx if mirror else 0} 0) scale({-1 if mirror else 1} 1)">')
    side = d in ("e", "w")
    # piernas
    for (dx, sw) in ((-7, step), (7, -step)):
        lx = cx + (dx * 0.4 if side else dx)
        s.poly([(lx - 5, gy - 30 + bob), (lx + 5, gy - 30 + bob), (lx + 5 + (sw if side else 0), gy), (lx - 5 + (sw if side else 0), gy)], "#4a3a30", stroke="#2a2018", sw=0.8)
    # túnica
    s.poly([(cx - 15, gy - 30 + bob), (cx + 15, gy - 30 + bob), (cx + 12, gy - 72 + bob), (cx - 12, gy - 72 + bob)], tun, stroke=dark, sw=0.8)
    s.poly([(cx - 14, gy - 44 + bob), (cx + 14, gy - 44 + bob), (cx + 14, gy - 40 + bob), (cx - 14, gy - 40 + bob)], "#6b4a2a")  # cinturón
    # brazos
    arm_dx = 14
    for (sd, sw) in ((-1, -step), (1, step)):
        if anim == "interact" and sd == 1:
            s.poly([(cx + 10, gy - 70 + bob), (cx + 16, gy - 72 + bob), (cx + 30, gy - 84 + bob), (cx + 26, gy - 90 + bob)], skin, stroke=dark, sw=0.8)
            continue
        if side and sd == -1:
            continue
        ax = cx + sd * arm_dx
        s.poly([(ax - 4, gy - 70 + bob), (ax + 4, gy - 70 + bob), (ax + 4 + (sw * 0.6 if side else 0), gy - 42 + bob), (ax - 4 + (sw * 0.6 if side else 0), gy - 42 + bob)], skin, stroke=dark, sw=0.8)
    # cabeza
    hy = gy - 88 + bob
    s.add(f'<circle cx="{cx}" cy="{hy:.1f}" r="15" fill="{skin}" stroke="{dark}" stroke-width="0.8"/>')
    if d == "n":
        s.path(f"M{cx - 15},{hy} A15,15 0 0 1 {cx + 15},{hy} L{cx + 13},{hy + 8} L{cx - 13},{hy + 8} Z", hair)
    else:
        s.path(f"M{cx - 15},{hy - 2} A15,15 0 0 1 {cx + 15},{hy - 2} L{cx + 15},{hy - 6} L{cx - 15},{hy - 6} Z", hair)
        s.path(f"M{cx - 15},{hy - 4} A15,15 0 0 1 {cx + 15},{hy - 4} L{cx + 12},{hy - 2} L{cx - 12},{hy - 2} Z", hair)
        if side:
            s.add(f'<circle cx="{cx + 8}" cy="{hy + 1:.1f}" r="1.8" fill="#2a2018"/>')
        else:
            s.add(f'<circle cx="{cx - 5}" cy="{hy + 1:.1f}" r="1.8" fill="#2a2018"/><circle cx="{cx + 5}" cy="{hy + 1:.1f}" r="1.8" fill="#2a2018"/>')
            s.line((cx - 3, hy + 8), (cx + 3, hy + 8), "#a06a5a", 1.2)
    s.add("</g>")
    return s.svg()


def k_avatar(s, st):
    out = {}
    for d in ("n", "e", "s", "w"):
        for k in range(2):
            out[f"avatar-{d}-idle-{k + 1}"] = _avatar_frame(d, "idle", k)
        for k in range(4):
            out[f"avatar-{d}-walk-{k + 1}"] = _avatar_frame(d, "walk", k)
        out[f"avatar-{d}-interact-1"] = _avatar_frame(d, "interact", 0)
    return out


# ---------------------------------------------------------------- efectos (64 frames)
def k_fx_spark(s, st):
    out = {}
    rnd = random.Random(5)
    parts = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(0.4, 1.0), rnd.uniform(0.2, 0.7)) for _ in range(9)]
    for i in range(64):
        f = S("fx-spark")
        t = i / 63
        env = math.sin(math.pi * t)
        c = 64
        rot = t * 90
        rr = 6 + 30 * env
        for (col, sc, op) in (("#f7c33a", 1.0, 0.9), ("#fff0a0", 0.55, 1.0)):
            pts = []
            for k in range(8):
                ang = math.radians(rot + k * 45)
                r = rr * sc if k % 2 == 0 else rr * sc * 0.28
                pts.append((c + r * math.cos(ang), c + r * math.sin(ang)))
            f.poly(pts, col, op=op * max(env, 0.05))
        for (ang, sp, ph) in parts:
            tt = (t + ph) % 1
            d = 8 + 46 * tt * sp
            f.add(f'<circle cx="{c + d * math.cos(ang):.2f}" cy="{c + d * math.sin(ang) - 8 * tt:.2f}" r="{2.6 * (1 - tt) + 0.6:.2f}" fill="#f7c33a" opacity="{(1 - tt) * 0.9:.2f}"/>')
        out[f"fx-spark-{i + 1}"] = f.svg()
    return out


KINDS = {
    "columna": k_columna, "columna-base": k_columna_base, "columna-capital": k_columna_capital,
    "tile-20": k_tile_20, "tile-21": k_tile_21,
    "antorcha": k_antorcha, "barril": k_barril, "barriles": k_barriles, "estandarte": k_estandarte,
    "tapiz-dragones": k_tapiz_dragones, "trono": k_trono, "cuadro-rey": k_cuadro_rey, "cuadro-reino": k_cuadro_reino,
    "tapiz-7-dragones": k_tapiz_7_dragones, "armario": k_armario, "arca": k_arca, "brasero": k_brasero,
    "estatua-caballero": k_estatua_caballero, "placa": k_placa, "puerta": k_puerta, "mural": k_mural,
    "ranura": k_ranura, "compartimento": k_compartimento, "mesa": k_mesa, "reja": k_reja, "mirilla": k_mirilla,
    "sarcofago": k_sarcofago, "altar": k_altar, "canal": k_canal, "compuerta": k_compuerta, "relicario": k_relicario,
    "vasijas-8": k_vasijas_8, "icon": k_icon, "avatar": k_avatar, "fx-spark": k_fx_spark,
}

SPRITE_DEFAULTS = {"kind": "barril", "state": ""}


def gen_sprite(p):
    kind = p["kind"]
    if kind not in KINDS:
        raise SystemExit(f"kind desconocido: {kind}")
    s = S(kind)
    r = KINDS[kind](s, p.get("state", ""))
    return r if isinstance(r, dict) else s.svg()


# presets del pack: nombre -> (kind, state). Los que no aparecen (tiles, muros) son presets propios.
PACK_SPRITES = {
    "columna": ("columna", ""), "columna-base": ("columna-base", ""), "columna-capital": ("columna-capital", ""),
    "tile-20": ("tile-20", ""), "tile-21": ("tile-21", ""),
    "antorcha": ("antorcha", "apagada"), "barril-suelto": ("barril", "suelto"), "barriles": ("barriles", ""),
    "estandarte": ("estandarte", ""), "tapiz-dragones": ("tapiz-dragones", ""),
    "trono": ("trono", ""), "cuadro-rey": ("cuadro-rey", ""), "cuadro-rey-torcido": ("cuadro-rey", "torcido"),
    "cuadro-reino": ("cuadro-reino", ""), "cuadro-reino-4torres": ("cuadro-reino", "4torres"),
    "tapiz-7-dragones": ("tapiz-7-dragones", ""), "armario": ("armario", "cerrado"), "armario-abierto": ("armario", "abierto"),
    "arca": ("arca", "cerrada"), "arca-cerrada": ("arca", "cerrada"), "arca-abierta": ("arca", "abierta"),
    "brasero": ("brasero", "apagado"), "brasero-apagado": ("brasero", "apagado"), "brasero-encendido": ("brasero", "encendido"),
    "estatua-caballero": ("estatua-caballero", ""),
    "placa-piedra": ("placa", "piedra"), "placa-arriba": ("placa", "arriba"), "placa-hundida": ("placa", "hundida"),
    "puerta-madera": ("puerta", "cerrada"), "puerta-cerrada": ("puerta", "cerrada"), "puerta-abierta": ("puerta", "abierta"),
    "mural-azulejos": ("mural", "azulejos"), "mural-desordenado": ("mural", "desordenado"), "mural-completo": ("mural", "completo"),
    "ranura-caliz": ("ranura", "vacia"), "ranura-vacia": ("ranura", "vacia"), "ranura-con-caliz": ("ranura", "con-caliz"),
    "compartimento": ("compartimento", "cerrado"), "compartimento-cerrado": ("compartimento", "cerrado"), "compartimento-abierto": ("compartimento", "abierto"),
    "barril-cerrado": ("barril", "cerrado"), "barril-movido": ("barril", "movido"),
    "mesa-catas": ("mesa", "catas"), "mesa": ("mesa", "mesa"), "mesa-activa": ("mesa", "activa"),
    "reja": ("reja", "cerrada"), "reja-cerrada": ("reja", "cerrada"), "reja-abierta": ("reja", "abierta"),
    "mirilla": ("mirilla", ""), "sarcofago": ("sarcofago", ""),
    "altar": ("altar", "seco"), "altar-seco": ("altar", "seco"), "altar-con-agua": ("altar", "con-agua"),
    "canal": ("canal", ""), "compuerta": ("compuerta", "cerrada"), "compuerta-cerrada": ("compuerta", "cerrada"), "compuerta-abierta": ("compuerta", "abierta"),
    "relicario": ("relicario", "sellado"), "relicario-sellado": ("relicario", "sellado"), "relicario-abierto": ("relicario", "abierto"),
    "vasijas-8": ("vasijas-8", ""),
    "icon-antorcha": ("icon", "antorcha"), "icon-caliz": ("icon", "caliz"), "icon-espejo": ("icon", "espejo"),
    "icon-llave-bronce": ("icon", "llave-bronce"), "icon-llave-plata": ("icon", "llave-plata"), "icon-llave-oro": ("icon", "llave-oro"),
    "icon-mechero": ("icon", "mechero"), "icon-pergamino": ("icon", "pergamino"), "icon-vela": ("icon", "vela"),
    "icon-busto": ("icon", "busto"),
    "avatar": ("avatar", ""), "fx-spark": ("fx-spark", ""),
}
