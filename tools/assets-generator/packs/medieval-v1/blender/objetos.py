"""
Constructores de los objetos del pack medieval-v1 para scripts/blender/render_objeto.py.

Cada constructor recibe la malla importada (o un marcador si el objeto es procedural) y devuelve (piezas fijas,
bisagras [(vacío, eje, grados al abrir)]). La configuración de cada objeto (GLB, escala, encuadre, estados,
orientaciones y medidas propias) está en ../objetos.json; render_objeto.py la deja en CFG antes de llamar.
Estados en los que se abren bisagras y se ven las piezas SOLO_ACTIVO: "estados_activos" de objetos.json.
"""
import math

import bpy
from mathutils import Matrix, Vector

import contexto
import tilegen
from geometria import bisagra, biselar, borrar_caras, box, caja_abierta, cortar, emisivo, madera, malla, material, separar

PACK = contexto.cargar()
CELL = PACK.estilo["celda_m"]
CFG = None             # configuración del objeto actual (la pone render_objeto.py)
scene = bpy.context.scene
SOLO_ACTIVO = []       # piezas que solo se ven en los estados activos (fuego, agua, alma...)
SOLO_REPOSO = []       # piezas que solo se ven fuera de los estados activos
MOVIMIENTOS = []       # (objeto, desplazamiento, giro en grados) que se aplican en los estados activos


def construir_arca(body):
    """Tapa separada por la junta, con bisagra trasera; caja interior con paredes gruesas y bóveda bajo la tapa."""
    tz = CFG["tapa_z"]
    cortar(body, [((0, 0, tz), (0, 0, 1))])
    lid = separar(body, lambda c: c.z > tz)
    xs = [v.co.x for v in body.data.vertices]
    zb = min(v.co.z for v in body.data.vertices)
    seam = [v.co for v in body.data.vertices if tz - 0.04 < v.co.z <= tz]
    ox0, ox1 = min(c.x for c in seam) + 0.02, max(c.x for c in seam) - 0.02   # canto exterior (bajo los herrajes)
    oy0, oy1 = min(c.y for c in seam) + 0.02, max(c.y for c in seam) - 0.02
    t = 0.028                                                                  # grosor de pared
    ix0, ix1, iy0, iy1 = ox0 + t, ox1 - t, oy0 + t, oy1 - t
    fz = zb + 0.035                                                            # suelo interior

    # paredes interiores (juntas horizontales) y suelo (tablas a lo largo del ancho)
    interior = caja_abierta("interior_caja", ix0, ix1, iy0, iy1, fz, tz,
                            [madera("madera_paredes", "Z", 0.55), madera("madera_suelo", "X", 0.45)], sin="z1")
    for p in interior.data.polygons:
        p.material_index = 1 if abs(p.normal.z) > 0.5 else 0
    # canto superior de las paredes (anillo), madera más clara
    V = [(ox0, oy0, tz), (ox1, oy0, tz), (ox1, oy1, tz), (ox0, oy1, tz),
         (ix0, iy0, tz), (ix1, iy0, tz), (ix1, iy1, tz), (ix0, iy1, tz)]
    F = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    canto = malla("canto_caja", V, F, [madera("madera_canto", "X", 0.9)])
    for p in canto.data.polygons:
        if p.normal.z < 0:
            p.flip()

    # bóveda interior de la tapa: misma curva que la tapa (semielipse en X, extruida a lo largo de Y), con grosor t,
    # tapas laterales en D y canto inferior plano entre el borde exterior y la bóveda
    lz = [v.co.z for v in lid.data.vertices]
    cx, cy = (ox0 + ox1) / 2, (oy0 + oy1) / 2
    a, h = (ox1 - ox0) / 2 - t, max(lz) - tz - t          # semiejes interiores
    vy0, vy1 = oy0 + t, oy1 - t
    # quitar la geometría interna que Tripo deja dentro de la tapa (tapaba la bóveda)
    n = borrar_caras(lid, lambda c: oy0 < c.y < oy1 and ((c.x - cx) / (a + t)) ** 2 + ((c.z - tz) / (h + t)) ** 2 < 0.8 ** 2)
    print("caras internas quitadas de la tapa:", n)
    N = 24
    prof = [(cx - a * math.cos(math.pi * i / N), tz + h * math.sin(math.pi * i / N)) for i in range(N + 1)]
    V, F, M = [], [], []
    for x, z in prof:
        V += [(x, vy0, z), (x, vy1, z)]
    for i in range(N):                                     # bóveda (tablas a lo largo del ancho)
        F.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1)); M.append(0)
    for k in (0, 1):                                       # laterales en D
        F.append(tuple(2 * i + k for i in range(N + 1))); M.append(1)
    b = len(V)                                             # canto: anillo entre borde exterior y la bóveda
    V += [(ox0, oy0, tz), (ox1, oy0, tz), (ox1, oy1, tz), (ox0, oy1, tz),
          (cx - a, vy0, tz), (cx + a, vy0, tz), (cx + a, vy1, tz), (cx - a, vy1, tz)]
    for q in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        F.append(tuple(b + j for j in q)); M.append(2)
    boveda = malla("interior_tapa", V, F,
                   [madera("madera_boveda", "X", 0.6, 0.045), madera("madera_lados", "Z", 0.5), madera("madera_canto_tapa", "X", 0.9)])
    centro = Vector((cx, cy, tz + h * 0.3))
    for pgn, mi in zip(boveda.data.polygons, M):
        pgn.material_index = mi
        if mi == 2:
            if pgn.normal.z > 0:
                pgn.flip()
        elif pgn.normal.dot(centro - Vector(pgn.center)) < 0:   # hacia dentro de la bóveda
            pgn.flip()
        pgn.use_smooth = mi == 0

    # bisagra en el borde trasero (−X); abrir = girar sobre Y hacia atrás
    h_tapa = bisagra("bisagra_tapa", (min(xs), 0, tz), [lid, boveda])
    return [interior, canto], [(h_tapa, "Y", -CFG["apertura_deg"])]


def construir_armario(body):
    """Dos puertas separadas por el borde del tapajuntas (la derecha se lleva pletina, cerradura y su anilla),
    con bisagras en los bordes exteriores; hueco interior de tablas con dos estantes y trasera de las puertas."""
    (py0, py1), (pz0, pz1) = CFG["puertas_y"], CFG["puertas_z"]
    fx, yc = CFG["frente_x"], CFG["corte_y"]
    (ly0, ly1), (lz0, lz1) = CFG["placa"]
    cortar(body, [((0, py0, 0), (0, 1, 0)), ((0, py1, 0), (0, 1, 0)), ((0, 0, pz0), (0, 0, 1)),
                  ((0, 0, pz1), (0, 0, 1)), ((0, yc, 0), (0, 1, 0))])

    def en_puerta(c):
        return c.x > fx and py0 < c.y < py1 and pz0 < c.z < pz1

    def en_placa(c):
        return ly0 < c.y < ly1 and lz0 < c.z < lz1

    derecha = separar(body, lambda c: en_puerta(c) and (c.y > yc or en_placa(c)))
    izquierda = separar(body, lambda c: en_puerta(c))
    # geometría interna de Tripo dentro del mueble (taparía el hueco)
    n = borrar_caras(body, lambda c: -0.17 < c.x < fx and -0.3 < c.y < 0.3 and -0.43 < c.z < 0.47)
    print("caras internas quitadas del armario:", n)

    # hueco: caja de tablas detrás de las puertas, del tamaño del hueco
    xb = -0.16
    hueco = caja_abierta("interior_armario", xb, fx, py0, py1, pz0, pz1,
                         [madera("madera_hueco_lados", "Z", 0.5), madera("madera_hueco_fondo", "Y", 0.42)], sin="x1")
    for p in hueco.data.polygons:
        p.material_index = 1 if abs(p.normal.x) > 0.5 else 0
    # dos estantes
    estante = madera("madera_estantes", "X", 0.8)
    estantes = [box(f"estante_{i}", (fx - 0.02 - xb, py1 - py0, 0.02),
                    ((xb + fx - 0.02) / 2, (py0 + py1) / 2, pz0 + (pz1 - pz0) * k), estante)
                for i, k in enumerate((1 / 3, 2 / 3))]
    # trasera de cada puerta (se ve al abrir): tablero de tablas verticales
    trasera = madera("madera_puerta_trasera", "Y", 0.65)
    t_izq = box("trasera_izq", (0.03, yc - py0, pz1 - pz0), (fx - 0.005, (py0 + yc) / 2, (pz0 + pz1) / 2), trasera)
    t_der = box("trasera_der", (0.03, py1 - yc, pz1 - pz0), (fx - 0.005, (yc + py1) / 2, (pz0 + pz1) / 2), trasera)

    xh = max(v.co.x for v in izquierda.data.vertices if v.co.z > pz0 + 0.1) - 0.01
    h_izq = bisagra("bisagra_izq", (xh, py0, 0), [izquierda, t_izq])
    h_der = bisagra("bisagra_der", (xh, py1, 0), [derecha, t_der])
    ang = CFG["apertura_deg"]
    return [hueco, *estantes], [(h_izq, "Z", -ang), (h_der, "Z", ang)]



def construir_brasero(body):
    """Oscurece la parte baja del cuenco (hierro oscuro) y construye el fuego del estado encendido: lecho de
    brasas, llamas toon (capa naranja y núcleo amarillo) y las 3 brasas flotantes de la pista (el dígito 3),
    separadas en altura y en horizontal para contarse a 1×."""
    # hierro oscuro: atributo por vértice que multiplica el color de la textura
    za, zb_ = CFG["cuenco_z"]
    attr = body.data.color_attributes.new("oscuro", "FLOAT_COLOR", "POINT")
    for v, c in zip(body.data.vertices, attr.data):
        k = 1.0 if za <= v.co.z <= zb_ and math.hypot(v.co.x, v.co.y) > 0.2 else 0.0
        c.color = (k, k, k, 1)
    for m in body.data.materials:
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        link = next((l for l in nt.links if l.to_socket == bsdf.inputs["Base Color"]), None)
        if not link:
            continue
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_name = "oscuro"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["B"].default_value = (0.38, 0.38, 0.40, 1)
        nt.links.new(link.from_socket, mix.inputs["A"])
        nt.links.new(at.outputs["Fac"], mix.inputs["Factor"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

    # altura del carbón: lo más alto dentro del cuenco (lejos del borde)
    ztop = max(v.co.z for v in body.data.vertices)
    zc = max(v.co.z for v in body.data.vertices if math.hypot(v.co.x, v.co.y) < 0.22)
    print("borde", round(ztop, 3), "carbón", round(zc, 3))

    fuego = []
    lecho = emisivo("brasas_lecho", (0.9, 0.16, 0.02), 1.0)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.14, location=(0, 0, zc - 0.01))
    o = bpy.context.object
    o.name = "lecho_brasas"
    o.scale = (1, 1, 0.1)
    o.data.materials.append(lecho)
    fuego.append(o)

    # colores planos toon (Standard: con fuerza 1 la emisión da el color tal cual, sin quemarse a blanco)
    naranja = emisivo("llama_naranja", (1.0, 0.38, 0.04), 1.1)
    rojo = emisivo("llama_roja", (0.85, 0.16, 0.02), 1.0)
    amarillo = emisivo("llama_amarilla", (1.0, 0.78, 0.18), 1.15)

    def lengua(name, x, y, alto, radio, mat, incl=(0, 0), giro=40, rz=0):
        """Llama toon: perfil de lágrima (panza abajo, punta larga), aplanada y con la punta curvada."""
        N, S = 16, 20
        V, F = [], []
        for j in range(S + 1):
            t = j / S
            r = radio * ((t / 0.28) ** 0.5 if t < 0.28 else ((1 - t) / 0.72) ** 1.4)
            for i in range(N):
                ang = 2 * math.pi * i / N
                V.append((r * math.cos(ang), r * math.sin(ang), t * alto))
        for j in range(S):
            for i in range(N):
                F.append((j * N + i, j * N + (i + 1) % N, (j + 1) * N + (i + 1) % N, (j + 1) * N + i))
        o = malla(name, V, F, [mat])
        o.location = (x, y, zc - 0.03)
        o.scale = (1, 0.7, 1)                           # lengua algo aplanada: se lee la curva
        tw = o.modifiers.new("curva", "SIMPLE_DEFORM")  # punta curvada (llama toon en S suave)
        tw.deform_method = "BEND"
        tw.angle = math.radians(giro)
        tw.deform_axis = "Y"
        sub = o.modifiers.new("sub", "SUBSURF")
        sub.levels = sub.render_levels = 1
        o.rotation_euler = (math.radians(incl[0]), math.radians(incl[1]), math.radians(rz))
        for p in o.data.polygons:
            p.use_smooth = True
        fuego.append(o)

    # corona de lenguas rojas/naranjas inclinadas hacia fuera, núcleo amarillo ancho en el centro y una punta
    # naranja que sube por encima del núcleo
    for i, ang in enumerate(range(0, 360, 60)):
        a = math.radians(ang + 15)
        alto = (0.38, 0.30, 0.42, 0.31, 0.40, 0.29)[i]
        lengua(f"llama_{i}", 0.11 * math.cos(a), 0.11 * math.sin(a), alto, 0.09, rojo if i % 2 else naranja,
               (-12 * math.sin(a), 12 * math.cos(a)), giro=18 if i % 2 else -18, rz=ang + 105)
    lengua("nucleo", 0, 0, 0.42, 0.13, amarillo, giro=12, rz=45)
    lengua("punta", 0, 0, 0.58, 0.1, naranja, giro=-15, rz=45)

    # las 3 brasas flotantes (pista del dígito 3): separadas en planta y en altura para contarse a 1×
    brasa = emisivo("brasa_flotante", (1.0, 0.42, 0.04), 1.2)
    for i, (x, y, dz) in enumerate(((0.2, -0.12, 0.52), (-0.12, 0.2, 0.6), (0.04, 0.04, 0.72))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.065, location=(x, y, zc + dz))
        o = bpy.context.object
        o.name = f"brasa_{i + 1}"
        bpy.ops.object.shade_smooth()
        o.data.materials.append(brasa)
        fuego.append(o)
    for o in fuego:
        o.visible_shadow = False
    SOLO_ACTIVO.extend(fuego)
    return fuego, []


def construir_barril(body):
    """Escondite: al moverlo, el barril se desplaza media celda y se inclina, y deja ver un hueco en el suelo con
    el espejo dentro."""
    zb = min(v.co.z for v in body.data.vertices)
    piezas = []
    piedra = material("borde_hueco", (0.36, 0.33, 0.30))
    hueco = emisivo("hueco", (0.02, 0.015, 0.012), 0.0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.2, depth=0.02, location=(0, 0, zb + 0.004))
    borde = bpy.context.object
    borde.data.materials.append(piedra)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.165, depth=0.02, location=(0, 0, zb + 0.008))
    fondo = bpy.context.object
    fondo.data.materials.append(hueco)
    # espejo de mano (el objeto escondido): aro de bronce y cristal azulado
    bronce = material("bronce_espejo", (0.55, 0.32, 0.12), 0.35)
    cristal = emisivo("cristal_espejo", (0.55, 0.75, 0.9), 0.6)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.055, minor_radius=0.01, location=(0.02, 0.01, zb + 0.022))
    aro = bpy.context.object
    aro.data.materials.append(bronce)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.05, depth=0.006, location=(0.02, 0.01, zb + 0.022))
    luna = bpy.context.object
    luna.data.materials.append(cristal)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.02, 0.1, zb + 0.022))
    mango = bpy.context.object
    mango.scale = (0.018, 0.08, 0.01)
    mango.data.materials.append(bronce)
    piezas = [borde, fondo, aro, luna, mango]
    for o in piezas:
        o.visible_shadow = False
    SOLO_ACTIVO.extend(piezas)
    # el barril se aparta hacia un lado (eje Y local = a lo largo del muro) y se inclina un poco
    MOVIMIENTOS.append((body, Vector((0.02, 0.34, 0)), (0, 0, 20)))
    return piezas, []


def construir_barriles(body):
    """Pila decorativa: tres barriles tumbados (dos abajo, uno encima) sobre dos calzos de madera."""
    body.data.transform(Matrix.Rotation(math.radians(90), 4, "Y"))    # eje del barril a lo largo de X (frente)
    co = [v.co for v in body.data.vertices]
    r = (max(c.z for c in co) - min(c.z for c in co)) / 2
    body.data.transform(Matrix.Translation((0, -r * 1.02, 0)))
    copias = []
    for i, (dy, dz) in enumerate(((r * 2.04, 0), (r * 1.02, r * 1.73))):
        o = body.copy()
        o.name = f"barril_pila_{i}"
        scene.collection.objects.link(o)
        o.location = (0, dy, dz)
        copias.append(o)
    madera_calzo = madera("madera_calzo", "Y", 0.5)
    zmin = min(v.co.z for v in body.data.vertices)
    calzos = [box(f"calzo_{i}", (0.07, r * 4.4, r * 0.5), (x, 0, zmin + r * 0.2), madera_calzo)
              for i, x in enumerate((-0.18, 0.18))]
    return copias + calzos, []


def goblet(name, mats):
    """Copa de peltre por revolución (unidades del GLB de la mesa: 1 ≈ 1,73 m), boca arriba con la base en z=0."""
    prof = [(0.0, 0.0), (0.034, 0.0), (0.034, 0.006), (0.012, 0.012), (0.008, 0.02), (0.008, 0.05), (0.014, 0.056),
            (0.03, 0.07), (0.036, 0.09), (0.037, 0.104), (0.033, 0.104), (0.032, 0.09), (0.026, 0.072), (0.0, 0.066)]
    N = 32
    V = [(r * math.cos(2 * math.pi * i / N), r * math.sin(2 * math.pi * i / N), z) for r, z in prof for i in range(N)]
    F = []
    for j in range(len(prof) - 1):
        for i in range(N):
            F.append((j * N + i, j * N + (i + 1) % N, (j + 1) * N + (i + 1) % N, (j + 1) * N + i))
    o = malla(name, V, F, mats)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def construir_mesa(body):
    """Mesa de catas: 6 copas (3 pares). En reposo, boca abajo; activa (puzle resuelto), de pie, llenas de vino con
    un brillo suave (vinos encantados)."""
    zt = max(v.co.z for v in body.data.vertices)
    peltre = material("peltre", (0.62, 0.63, 0.66), 0.35)
    peltre.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.6
    vino = emisivo("vino_encantado", (0.55, 0.03, 0.12), 0.9)
    piezas_r, piezas_a = [], []
    k = 1.6          # copas exageradas (como la llave): a tamaño de juego una copa real no se lee
    for i, (x, y) in enumerate((x, y) for x in (-0.12, 0.12) for y in (-0.42, 0.0, 0.42)):
        c = goblet(f"copa_reposo_{i}", [peltre])
        c.scale = (k, k, k)
        c.rotation_euler = (math.radians(180), 0, 0)
        c.location = (x, y, zt + 0.104 * k)
        piezas_r.append(c)
        c = goblet(f"copa_activa_{i}", [peltre])
        c.scale = (k, k, k)
        c.location = (x, y, zt)
        piezas_a.append(c)
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.031 * k, depth=0.004, location=(x, y, zt + 0.095 * k))
        v = bpy.context.object
        v.name = f"vino_{i}"
        v.data.materials.append(vino)
        piezas_a.append(v)
    SOLO_REPOSO.extend(piezas_r)
    SOLO_ACTIVO.extend(piezas_a)
    return piezas_r + piezas_a, []


PIEDRA = (0.30, 0.26, 0.21)


def piedra_mat(name, tono=1.0):
    """Piedra gris cálida moteada (ruido de dos escalas + relieve), para las piezas hechas en Blender."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.9
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n1 = nt.nodes.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 9
    n1.inputs["Detail"].default_value = 4
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*[c * 0.78 * tono for c in PIEDRA], 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (*[c * 1.12 * tono for c in PIEDRA], 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    n2 = nt.nodes.new("ShaderNodeTexNoise")
    n2.inputs["Scale"].default_value = 40
    nt.links.new(tc.outputs["Object"], n1.inputs["Vector"])
    nt.links.new(tc.outputs["Object"], n2.inputs["Vector"])
    nt.links.new(n1.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(n2.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def construir_altar(body):
    """Altar con pila tallada arriba; con agua: lámina de agua (algo luminosa) dentro de la pila."""
    co = [v.co for v in body.data.vertices]
    x0_, x1_ = min(c.x for c in co), max(c.x for c in co)
    y0_, y1_ = min(c.y for c in co), max(c.y for c in co)
    zt = max(c.z for c in co)
    agua = bpy.data.materials.new("agua_sagrada")
    agua.use_nodes = True
    bs = agua.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (0.03, 0.18, 0.38, 1)
    bs.inputs["Roughness"].default_value = 0.08
    bs.inputs["Emission Color"].default_value = (0.08, 0.35, 0.65, 1)
    bs.inputs["Emission Strength"].default_value = 0.35
    ix, iy = (x1_ - x0_) * CFG.get("borde_pila", 0.17), (y1_ - y0_) * CFG.get("borde_pila", 0.17)
    # fondo de la pila (el modelo es hueco por dentro): siempre visible
    fondo = box("fondo_pila", (x1_ - x0_ - 2 * ix + 0.02, y1_ - y0_ - 2 * iy + 0.02, 0.01),
                ((x0_ + x1_) / 2, (y0_ + y1_) / 2, zt - 0.09), piedra_mat("fondo_pila", 0.7))
    w = box("agua", (x1_ - x0_ - 2 * ix, y1_ - y0_ - 2 * iy, 0.01), ((x0_ + x1_) / 2, (y0_ + y1_) / 2, zt - 0.045), agua)
    w.visible_shadow = False
    SOLO_ACTIVO.append(w)
    return [fondo, w], []


def construir_relicario(body):
    """Como el arca (tapa plana con bisagra trasera e interior), más el sello de magia oscura (bandas moradas que
    lo atan, solo sellado) y el alma del rey (luz dorada que sale, solo abierto)."""
    fijas, bis = construir_arca(body)
    co = [v.co for v in body.data.vertices]
    x0_, x1_ = min(c.x for c in co), max(c.x for c in co)
    y0_, y1_ = min(c.y for c in co), max(c.y for c in co)
    zb_ = min(c.z for c in co)
    zt = CFG["tapa_z"] + (CFG.get("alto_tapa", 0.12))
    morado = emisivo("sello_morado", (0.28, 0.04, 0.55), 1.0)
    sello = []
    t, e = 0.018, 0.01
    dx, dy, dz = x1_ - x0_ + 2 * e, y1_ - y0_ + 2 * e, zt - zb_ + e
    cx, cy = (x0_ + x1_) / 2, (y0_ + y1_) / 2
    # banda a lo largo de X (por encima y por delante/detrás) y banda a lo largo de Y (por encima y los lados)
    sello.append(box("sello_x_arriba", (dx, t, e), (cx, cy, zt + e / 2), morado))
    sello.append(box("sello_x_frente", (e, t, dz), (x1_ + e / 2, cy, (zb_ + zt) / 2), morado))
    sello.append(box("sello_x_detras", (e, t, dz), (x0_ - e / 2, cy, (zb_ + zt) / 2), morado))
    sello.append(box("sello_y_arriba", (t, dy, e), (cx, cy, zt + e / 2), morado))
    sello.append(box("sello_y_izq", (t, e, dz), (cx, y0_ - e / 2, (zb_ + zt) / 2), morado))
    sello.append(box("sello_y_der", (t, e, dz), (cx, y1_ + e / 2, (zb_ + zt) / 2), morado))
    alma = emisivo("alma_rey", (1.0, 0.78, 0.3), 1.2)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, location=(cx, cy, zt + 0.16))
    orbe = bpy.context.object
    orbe.data.materials.append(alma)
    bpy.ops.object.shade_smooth()
    luz = []
    for i, (r, h) in enumerate(((0.02, 0.07), (0.016, 0.27), (0.012, 0.33))):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(cx + 0.05 * math.cos(i * 2.1), cy + 0.05 * math.sin(i * 2.1), zt + h))
        o = bpy.context.object
        o.data.materials.append(alma)
        luz.append(o)
    for o in sello + [orbe] + luz:
        o.visible_shadow = False
    SOLO_REPOSO.extend(sello)
    SOLO_ACTIVO.extend([orbe] + luz)
    return fijas + sello + [orbe] + luz, bis


def construir_vasijas(body):
    """Las 8 vasijas de la pista: dos filas de 4 en una grada de piedra (la de atrás, más alta), bien separadas."""
    co = [v.co for v in body.data.vertices]
    w = max(c.x for c in co) - min(c.x for c in co)
    hgt = max(c.z for c in co) - min(c.z for c in co)
    zb_ = min(c.z for c in co)
    piedra = piedra_mat("grada")
    paso = 1.25 * w
    fila_y = [(-1.5 + k) * paso for k in range(4)]
    escalon = 0.28 * hgt
    grada = [box("grada_baja", (1.4 * w, 4 * paso + 0.3 * w, 0.06 * hgt), (0.7 * w, 0, zb_ + 0.03 * hgt), piedra),
             box("grada_alta", (1.4 * w, 4 * paso + 0.3 * w, escalon), (-0.7 * w, 0, zb_ + escalon / 2), piedra)]
    biselar(grada, 0.01)
    copias = []
    for k, y in enumerate(fila_y):
        for fila, (x, z) in enumerate(((0.7 * w, 0.06 * hgt), (-0.7 * w, escalon))):
            if k == 0 and fila == 0:
                body.location = (x, y, z)
                continue
            o = body.copy()
            o.name = f"vasija_{k}_{fila}"
            scene.collection.objects.link(o)
            o.location = (x, y, z)
            copias.append(o)
    return copias + grada, []


def _canal(largo, nombre="canal"):
    piedra = piedra_mat(f"piedra_{nombre}")
    seco = piedra_mat(f"fondo_{nombre}", 0.75)
    return [box(f"{nombre}_fondo", (largo, 0.56, 0.08), (0, 0, 0.04), seco),
            box(f"{nombre}_pared_a", (largo, 0.12, 0.3), (0, -0.22, 0.15), piedra),
            box(f"{nombre}_pared_b", (largo, 0.12, 0.3), (0, 0.22, 0.15), piedra)]


def construir_canal(body):
    """Tramo del canal de agua sagrada (seco): artesa de piedra a lo largo de X local, con la boca de entrada
    (arco oscuro en un bloque de piedra) en el extremo −X."""
    piezas = _canal(CELL)
    piedra = piedra_mat("boca")
    oscuro = material("boca_oscura", (0.03, 0.025, 0.02))
    piezas.append(box("boca_bloque", (0.22, 0.7, 0.62), (-CELL / 2 + 0.11, 0, 0.31), piedra))
    piezas.append(box("boca_arco", (0.01, 0.26, 0.24), (-CELL / 2 + 0.225, 0, 0.2), oscuro))
    return biselar(piezas), []


def construir_compuerta(body):
    """Compuerta del canal con cerradura de oro: marco de piedra y tablero de madera con aros de hierro; abierta,
    el tablero sube."""
    piezas = _canal(CELL, "canal_c")
    piedra = piedra_mat("marco_compuerta")
    piezas += [box("poste_a", (0.16, 0.13, 0.95), (0, -0.345, 0.475), piedra),
               box("poste_b", (0.16, 0.13, 0.95), (0, 0.345, 0.475), piedra),
               box("dintel", (0.18, 0.86, 0.14), (0, 0, 1.0), piedra)]
    hierro = material("hierro_compuerta", (0.36, 0.36, 0.38), 0.4, 0.6)
    oro = material("oro_compuerta", (0.95, 0.66, 0.16), 0.3, 0.85)
    tablero = madera("madera_compuerta", "Y", 0.8, 0.07)
    gate = bpy.data.objects.new("tablero_compuerta", None)
    scene.collection.objects.link(gate)
    g = [box("tablero", (0.07, 0.56, 0.62), (0, 0, 0.39), tablero),
         box("aro_a", (0.085, 0.58, 0.05), (0, 0, 0.2), hierro),
         box("aro_b", (0.085, 0.58, 0.05), (0, 0, 0.58), hierro),
         box("cerradura_oro", (0.03, 0.14, 0.16), (0.05, 0, 0.39), oro)]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.04, minor_radius=0.01, location=(0.07, 0, 0.33),
                                     rotation=(0, math.radians(90), 0))
    ojo = bpy.context.object
    ojo.data.materials.append(hierro)
    g.append(ojo)
    for o in g:
        o.parent = gate
    MOVIMIENTOS.append((gate, Vector((0, 0, 0.5)), (0, 0, 0)))
    biselar(piezas + g, 0.012)
    return piezas + [gate], []


def llama(name, pos, alto, radio, mat, incl=(0, 0)):
    N, S = 14, 16
    V, F = [], []
    for j in range(S + 1):
        t = j / S
        r = radio * ((t / 0.28) ** 0.5 if t < 0.28 else ((1 - t) / 0.72) ** 1.4)
        for i in range(N):
            a = 2 * math.pi * i / N
            V.append((r * math.cos(a), 0.7 * r * math.sin(a), t * alto))
    for j in range(S):
        for i in range(N):
            F.append((j * N + i, j * N + (i + 1) % N, (j + 1) * N + (i + 1) % N, (j + 1) * N + i))
    o = malla(name, V, F, [mat])
    o.location = pos
    o.rotation_euler = (math.radians(incl[0]), math.radians(incl[1]), 0)
    for p in o.data.polygons:
        p.use_smooth = True
    o.visible_shadow = False
    return o


def construir_antorcha(body):
    """Antorcha de pared encendida: soporte de hierro en el muro (−X local), mango de madera inclinado y llama toon
    como la del brasero (sin halo: la luz la pone el runtime)."""
    xw = -CELL / 2
    hierro = material("hierro_antorcha", (0.36, 0.36, 0.38), 0.4, 0.6)
    mango = madera("mango_antorcha", "Z", 0.7, 0.2)
    p = [box("placa", (0.03, 0.12, 0.22), (xw + 0.015, 0, 1.55), hierro),
         box("brazo", (0.2, 0.035, 0.035), (xw + 0.11, 0, 1.52), hierro)]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.05, minor_radius=0.013, location=(xw + 0.2, 0, 1.55))
    aro = bpy.context.object
    aro.data.materials.append(hierro)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.028, depth=0.5, location=(xw + 0.22, 0, 1.62),
                                        rotation=(0, math.radians(14), 0))
    palo = bpy.context.object
    palo.data.materials.append(mango)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.045, depth=0.1, location=(xw + 0.26, 0, 1.86),
                                        rotation=(0, math.radians(14), 0))
    cabeza = bpy.context.object
    cabeza.data.materials.append(material("brea", (0.1, 0.07, 0.05)))
    naranja = emisivo("llama_antorcha", (1.0, 0.38, 0.04), 1.1)
    rojo = emisivo("llama_antorcha_roja", (0.85, 0.16, 0.02), 1.0)
    amarillo = emisivo("nucleo_antorcha", (1.0, 0.78, 0.18), 1.15)
    base = (xw + 0.275, 0, 1.9)
    fl = [llama("llama_r1", (base[0] - 0.03, 0.02, base[2]), 0.2, 0.06, rojo, (8, -10)),
          llama("llama_r2", (base[0] + 0.03, -0.02, base[2]), 0.18, 0.055, rojo, (-8, 12)),
          llama("llama_n", base, 0.3, 0.07, naranja),
          llama("llama_a", (base[0] + 0.01, 0, base[2]), 0.18, 0.045, amarillo)]
    return p + [aro, palo, cabeza] + fl, []


# Hueco del arco de los muros del pack, en metros: el mismo que dibuja el generador de tiles en el preset
# "muro-arco" de tiles.json (arch_w en unidades de suelo, arch_h en px del lienzo del tile), con la escala del estilo
_ARCO = tilegen.load_preset(PACK.json("tiles.json")["muro-arco"])[1]
_PX_M = PACK.px_por_m_vertical() * PACK["proyeccion"]["scale"]      # px del lienzo del tile por metro de altura
ARCO_W = _ARCO["arch_w"] / tilegen.L * CELL                         # ancho (castillo-toon: 0,724 m)
ARCO_JAMBA = _ARCO["arch_h"] / _PX_M                                # jamba (1,503 m)
ARCO_RY = (_ARCO["arch_w"] * tilegen.K / 2) / _PX_M                 # medio punto: semieje vertical (0,331 m)
CARA_MURO = CELL / 2 - 0.035            # la hoja va en la cara del muro que da a la sala (+X local), no en su centro:
                                        # así llena el hueco tal como se ve y el runtime la dibuja después del muro


def perfil_arco(margen=0.0, n=24):
    """Contorno del hueco (en el plano YZ local, y a lo ancho, z arriba): rectángulo + semielipse."""
    w = ARCO_W / 2 - margen
    pts = [(-w, 0.0), (w, 0.0), (w, ARCO_JAMBA)]
    for i in range(1, n):
        a = math.pi * i / n
        pts.append((w * math.cos(a), ARCO_JAMBA + (ARCO_RY - margen) * math.sin(a)))
    pts.append((-w, ARCO_JAMBA))
    return pts


def construir_puerta(body):
    """Hoja de la puerta de madera: la imagen pintada de frente recortada con la forma del arco, con grosor,
    colgada de su bisagra (borde −Y local). El pivote es el centro de la celda del muro; la hoja va en la cara del
    muro que da a la sala (x = CARA_MURO). Abierta: gira 100° hacia la sala (+X local)."""
    img = bpy.data.images.load(str(CFG["imagen"]))
    m = bpy.data.materials.new("hoja_puerta")
    m.use_nodes = True
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], nt.nodes["Principled BSDF"].inputs["Alpha"])   # el arco pintado es algo más bajo
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.75
    pts = perfil_arco(0.006)
    w, htot = ARCO_W - 0.012, ARCO_JAMBA + ARCO_RY - 0.006
    me = bpy.data.meshes.new("hoja")
    me.from_pydata([(CARA_MURO, y + w / 2, z) for y, z in pts], [], [list(range(len(pts)))])
    uv = me.uv_layers.new()
    for li, l in enumerate(me.loops):
        y, z = pts[l.vertex_index]
        uv.data[li].uv = ((y + w / 2) / w, z / htot)
    me.materials.append(m)
    hoja = bpy.data.objects.new("hoja", me)
    scene.collection.objects.link(hoja)
    sol = hoja.modifiers.new("grosor", "SOLIDIFY")
    sol.thickness = 0.06
    sol.offset = 0
    hoja.location = (0, -w / 2, 0)          # la hoja empieza en la bisagra
    h = bisagra("bisagra_puerta", (CARA_MURO, -w / 2, 0), [hoja])
    return [], [(h, "Z", -100)]


def construir_reja(body):
    """Reja de hierro con la forma del arco: barrotes verticales, dos travesaños y el medio punto; abierta, gira
    sobre su bisagra como la puerta."""
    hierro = material("hierro_reja", (0.16, 0.16, 0.18), 0.45, 0.7)
    grupo = bpy.data.objects.new("hoja_reja", None)
    scene.collection.objects.link(grupo)
    piezas = []
    w = ARCO_W / 2 - 0.01

    def barra(p0, p1, r=0.016):
        v = Vector(p1) - Vector(p0)
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=r, depth=v.length, location=(Vector(p0) + Vector(p1)) / 2)
        o = bpy.context.object
        o.rotation_euler = v.to_track_quat("Z", "Y").to_euler()
        o.data.materials.append(hierro)
        piezas.append(o)

    def alto(y):   # altura del arco en y
        if abs(y) >= w:
            return ARCO_JAMBA
        return ARCO_JAMBA + (ARCO_RY - 0.01) * math.sqrt(max(0.0, 1 - (y / w) ** 2))

    n = 7
    X = CARA_MURO
    for i in range(n):
        y = -w + 0.04 + (2 * w - 0.08) * i / (n - 1)
        barra((X, y, 0.0), (X, y, alto(y)))
    for z in (0.35, 1.05):
        barra((X, -w, z), (X, w, z), 0.02)
    arco = perfil_arco(0.01, 16)[2:]
    for a, b_ in zip(arco[:-1], arco[1:]):
        barra((X, a[0], a[1]), (X, b_[0], b_[1]), 0.022)
    barra((X, -w, 0), (X, -w, ARCO_JAMBA), 0.022)
    barra((X, w, 0), (X, w, ARCO_JAMBA), 0.022)
    for o in piezas:
        o.parent = grupo
    grupo.location = (0, 0, 0)
    h = bisagra("bisagra_reja", (X, -w, 0), [grupo])
    return [], [(h, "Z", -100)]


def construir_placa(body):
    """Placa de presión: losa de piedra de 0,72 m con un anillo tallado; hundida, baja casi a ras del suelo y se ve
    la junta oscura alrededor."""
    piedra = piedra_mat("placa", 1.05)
    oscuro = material("junta_placa", (0.05, 0.04, 0.035))
    losa = box("losa", (0.72, 0.72, 0.07), (0, 0, 0.035), piedra)
    biselar([losa], 0.012)
    junta = box("junta", (0.78, 0.78, 0.01), (0, 0, 0.003), oscuro)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.2, minor_radius=0.018, location=(0, 0, 0.07))
    anillo = bpy.context.object
    anillo.scale = (1, 1, 0.3)
    anillo.data.materials.append(piedra_mat("talla", 0.6))
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.06, depth=0.01, location=(0, 0, 0.07))
    centro = bpy.context.object
    centro.data.materials.append(piedra_mat("talla_c", 0.6))
    grupo = bpy.data.objects.new("placa_mov", None)
    scene.collection.objects.link(grupo)
    for o in (losa, anillo, centro):
        o.parent = grupo
    MOVIMIENTOS.append((grupo, Vector((0, 0, -0.055)), (0, 0, 0)))
    return [junta, grupo], []


def construir_columna(body):
    """Columna de piedra de 2,4 m (alto del muro): basa (plinto + toro), fuste con éntasis y capitel (equino + ábaco).
    `pieza`: "entera", "base" o "capital" (mismo lienzo y pivote: se apilan en el mismo sitio)."""
    piedra = piedra_mat("columna")
    pieza = CFG.get("pieza", "entera")
    def torno(name, prof, z0):
        N = 32
        V = [(r * math.cos(2 * math.pi * i / N), r * math.sin(2 * math.pi * i / N), z0 + z) for r, z in prof for i in range(N)]
        F = [(j * N + i, j * N + (i + 1) % N, (j + 1) * N + (i + 1) % N, (j + 1) * N + i)
             for j in range(len(prof) - 1) for i in range(N)]
        F.append(tuple(range(N))[::-1])
        F.append(tuple((len(prof) - 1) * N + i for i in range(N)))
        o = malla(name, V, F, [piedra])
        for p_ in o.data.polygons:
            p_.use_smooth = True
        return o
    partes = []
    if pieza in ("entera", "base"):
        partes.append(box("plinto", (0.6, 0.6, 0.12), (0, 0, 0.06), piedra))
        partes.append(torno("toro", [(0.27, 0.0), (0.285, 0.04), (0.27, 0.08), (0.22, 0.1)], 0.12))
    if pieza == "entera":
        partes.append(torno("fuste", [(0.2, 0.0), (0.205, 0.6), (0.2, 1.2), (0.185, 1.84)], 0.22))
    if pieza in ("entera", "capital"):
        partes.append(torno("equino", [(0.19, 0.0), (0.21, 0.03), (0.27, 0.1), (0.28, 0.12)], 2.06))
        partes.append(box("abaco", (0.62, 0.62, 0.12), (0, 0, 2.34), piedra))
    biselar([o for o in partes if len(o.data.vertices) == 8], 0.015)
    return partes, []


def construir_umbral(body):
    """Umbral de piedra bajo una puerta o arco: losa ancha a lo largo del muro (eje Y local), algo levantada."""
    o = box("umbral", (0.34, CELL * 0.96, 0.07), (0, 0, 0.035), piedra_mat("umbral", 1.05))
    return biselar([o], 0.012), []


def construir_escalon(body):
    """Escalón de piedra de 0,2 m de alto que ocupa el ancho de la celda (eje Y local)."""
    o = box("escalon", (0.46, CELL * 0.98, 0.2), (0.1, 0, 0.1), piedra_mat("escalon"))
    return biselar([o], 0.015), []



CONSTRUCTORES = {"arca": construir_arca, "armario": construir_armario, "brasero": construir_brasero,
                 "estatua": lambda body: ([], []), "trono": lambda body: ([], []), "barril": construir_barril,
                 "barriles": construir_barriles, "mesa": construir_mesa, "sarcofago": lambda body: ([], []),
                 "altar": construir_altar, "relicario": construir_relicario, "vasijas": construir_vasijas,
                 "canal": construir_canal, "canal-tramo": lambda body: (biselar(_canal(CELL, "tramo")), []), "puerta": construir_puerta,
                 "reja": construir_reja, "placa": construir_placa, "columna": construir_columna,
                 "columna-base": construir_columna, "columna-capital": construir_columna,
                 "umbral": construir_umbral, "escalon": construir_escalon, "compuerta": construir_compuerta, "antorcha": construir_antorcha}
