# Biblia del estilo `castillo-toon` — personajes e iconos

Borrador v0.1 (25/09/2026). Fuente de verdad visual de los personajes jugables e iconos de este estilo (nació con el
pack `medieval-v1`; las fichas de cada personaje van en su pack).
Referencias visuales: `referencias/hoja_caras.png`, `referencias/hoja_cuerpos.png`
(Dataset C, sin sombra, mirando abajo-izquierda) y el **master ancla** aprobado (el primer personaje).

## 1. Reglas generales

| Tema | Regla |
|---|---|
| Estilo | Toon 3D pulido (Dataset C): volumen suave, colores planos saturados, oclusión ambiental ligera. |
| Contorno | Sin contorno. Si hiciera falta para legibilidad: muy fino y del tono oscuro del propio relleno, nunca negro. |
| Proporciones | ~5-6 cabezas; cabeza algo grande; manos y pies grandes; silueta clara y reconocible por clase. |
| Luz | Única en todo el pack: desde arriba-izquierda, del lado del jugador (≈45-60° de elevación). |
| Sombra | **Sin sombra de contacto** (la dibuja el motor en su propia capa). |
| Color | Paleta saturada con valores medio-altos; un color principal identificable por personaje. Debe leerse sobre fondo claro y oscuro (`#0b1120`). |
| Diseño | Armaduras y ropa **simétricas** por defecto. Pocas piezas sueltas (cintas, cadenas) que compliquen el 3D. Sin texto ni logotipos. |
| Coherencia 2D/3D | **El master 2D manda en el diseño.** El 3D se genera siempre desde el master aprobado; si el 3D mejora algo, se corrige primero en el master. |

## 2. Construcción de la cara (fija para todos)

Lo que es común a todos los personajes (la "línea de la casa"):

- **Ojos** grandes y expresivos, línea superior de pestañas gruesa y oscura, iris grande de color con un único brillo blanco.
- **Cejas** gruesas y expresivas.
- **Nariz** pequeña y simple: **una sola línea corta y curva en el lado de la sombra**, sin fosas nasales ni puente dibujado.
- **Boca** pequeña, trazo sencillo.
- **Rubor** suave en las mejillas.
- **Mandíbula** redondeada y suave; barbilla pequeña.

Lo que varía entre personajes: edad, peinado y color de pelo, color de ojos y piel, barba/bigote, orejas (elfo),
expresión, cicatrices o pecas.

**Bloque fijo para los prompts** (se copia literal en todos):

> Face style: large expressive eyes with a thick dark upper lash line and a big colored iris with a single white highlight, thick expressive eyebrows, a small simple nose drawn only as one short curved line on the shadow side with no nostrils, a small mouth, soft rosy blush on the cheeks, soft rounded jawline — exactly like the faces in the face reference sheet.

## 3. Master de cada personaje

- **Vista:** frontal, mirando a cámara, **pose A** (brazos algo separados del cuerpo, pies separados), cuerpo entero centrado.
- **Manos libres:** armas envainadas o a la espalda (facilita el rig y la animación "alcanzar").
- **Formato:** 1536×2048 (2K, 3:4), fondo gris claro liso, sin suelo ni sombra.
- **Uso:** fuente del 3D, del retrato/cara de avatar y referencia de identidad.

**Plantilla de prompt del master** (`{PERSONAJE}` = ficha del §5):

> Full-body character design of a playable hero for an isometric RPG, drawn in exactly the same art style, rendering, shading and proportions as the body reference sheet: {PERSONAJE}. {BLOQUE CARA}. Front view facing the camera, neutral A-pose with arms slightly away from the body, feet apart, standing straight, whole body visible and centered, both hands empty. Symmetrical design. Soft light from the upper left. The character is isolated on a flat uniform light grey background with nothing else in the image, no floor.

**Modelo: GPT 2 (Magnific, calidad media, 2K)**, elegido el 25/09/2026 tras comparar Klein, Nano Banana Pro,
Seedream 5 Pro y GPT 2 con el mismo prompt: es el único que da el toon 3D sin contorno, la nariz simple y respeta el
diseño pedido. ~180 créditos/imagen. Referencias: hoja de caras, hoja de cuerpos y, a partir del 2.º personaje, el
master ancla (en medieval-v1: `packs/medieval-v1/fuentes/personajes/caballero-m/master.png`).

## 4. Sprites de juego

- Isométrico 2:1, 4 direcciones (n/e/s/w), **renderizados desde el 3D** (luz y proyección exactas; no se espeja).
- Tamaños: 128×192 (2×) y 64×96 (1×), PNG con alfa, pivote abajo-centro.
- Animaciones: `idle` 8 fotogramas, `andar` 8 por dirección, `alcanzar` 4 (brazo hacia el objeto a la altura del pecho, una vez, vuelve a idle). Si 8 da problemas, bajar a 6.

## 5. Fichas de personaje

Son de cada pack: las del pack medieval están en `packs/medieval-v1/docs/personajes.md`.

## 6. Iconos de inventario (objetos)

Decidido el 25/09/2026. Ancla de estilo: `packs/medieval-v1/fuentes/iconos/llave-oro.png` (llave dorada, variante 1).

- **Cámara:** vista 3/4 ligeramente desde arriba (~30° de elevación), objeto girado ~30-45°. No isométrico exacto,
  pero coherente con la cámara alta del juego. Misma vista para TODOS los iconos.
- **Colocación:** alargados (llaves, antorcha, pergamino) en diagonal, parte gruesa (cabeza/mango) arriba-izquierda
  y punta abajo-derecha; verticales (cáliz, vela, busto, espejo) de pie y algo girados.
- **Tamaño:** cada objeto ocupa ~80 % del lienzo, independientemente de su tamaño real (legibilidad uniforme).
- **Estilo:** toon 3D como los personajes, formas gruesas y simples (sin grabados finos), colores saturados, luz
  arriba-izquierda, sin contorno, sin sombra, fondo transparente.
- **Salida:** `icon-<id>.png` a 64×64 (1×) y 128×128 (2×); legible sobre panel oscuro y claro.
- **Variantes de material** (llaves bronce/plata/oro): misma forma, se tiñe el master en local.
- **Producción:** hoja con varios objetos en una sola generación (GPT 2, referencias: llave ancla + master del
  caballero) para compartir perspectiva y luz; luego se recortan.
