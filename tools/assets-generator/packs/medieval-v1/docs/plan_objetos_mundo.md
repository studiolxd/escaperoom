# Plan: objetos del mundo (pack medieval, Rey Aldric)

Fuente: `docs/specs/26` §4.2 (57 frames) y el fixture `roompackage-rey-aldric.v1.json` (posiciones reales).

## Cómo son las salas (fixture)
- Rejilla con muros en los 4 bordes. Solo se ven los **2 muros del fondo**: fila `y=0` (muro de arriba a la
  derecha en pantalla) y columna `x=0` (muro de arriba a la izquierda). Los del frente se atenúan (oclusión).
- Los objetos de pared del fixture están casi todos en `y=0` → cuelgan del **muro de arriba-derecha** y miran
  hacia abajo-izquierda.
- **Ojo (diseño de nivel):** `armario` está en `x=18`, pegado al muro del frente-derecha → se vería de espaldas.
  Habría que moverlo a un muro del fondo o aceptar verlo de lado. Lo apunto para el dueño del repo.

## Clasificación (frames de §4.2)

**A. Planos en la pared** (cuadros, tapices, murales) — se pintan de frente y se "cuelgan" en Blender:
`cuadro-rey`, `cuadro-rey-torcido`, `cuadro-reino`, `cuadro-reino-4torres`, `tapiz-7-dragones`,
`tapiz-dragones`, `estandarte`, `mural-azulejos` (+`desordenado`, `completo`).

**B. Pequeños en la pared** (con relieve): `antorcha` (apagada/encendida), `mirilla`, `ranura-caliz`
(+`vacia`, `con-caliz`), `compartimento` (+`cerrado`, `abierto`).

**C. De suelo, con estados**: `arca` (+`cerrada`, `abierta`), `armario` (+`abierto`), `brasero` (+`apagado`,
`encendido`), `barril-cerrado`/`barril-movido`, `mesa`/`mesa-activa`, `altar` (+`seco`, `con-agua`),
`relicario` (+`sellado`, `abierto`), `compuerta` (+`cerrada`, `abierta`), `placa` (+`arriba`, `hundida`).

**D. De suelo, sin estados**: `trono`, `estatua-caballero`, `sarcofago`, `vasijas-8`, `barriles`,
`barril-suelto`, `columna`, `canal`, `mesa-catas`.

**E. Piezas de muro con paso**: `puerta-madera` (+`cerrada`, `abierta`), `reja` (+`cerrada`, `abierta`).
Van con los muros (tileset) → mejor cuando hagamos muros y suelos.

## Cómo producirlos (misma cámara y luz que el caballero)
- **A (planos):** cuadro/tapiz de frente con GPT 2 (~180 cr) → en Blender se pone en un marco 3D sobre el muro y se
  renderiza con la cámara isométrica. Proyección 2:1 exacta, barato, y el "torcido" es girar el marco.
- **B, C, D (volumen):** master 2D con GPT 2 (~180) → 3D con Tripo (~775) → render isométrico en Blender. Los
  estados (abierto/cerrado, encendido/apagado) se hacen en Blender sobre el mismo modelo cuando se pueda (abrir
  una tapa = girar una pieza; fuego = efecto), o con un segundo modelo si no.
- **Dos orientaciones** para lo que va en pared (muro izquierdo y derecho) y para lo de suelo (mirando a cada
  lado): salen gratis del mismo 3D girándolo; no se espeja (la luz se mantiene).

## Piloto propuesto
1. `cuadro-rey` + `cuadro-rey-torcido` (tipo A) — ~180 créditos.
2. `arca` + `arca-cerrada` + `arca-abierta` (tipo C, con estados) — ~180 master + ~775 3D.
3. Una **sala de prueba en Blender** (suelo y dos muros neutros) para ver los objetos en contexto, junto al
   caballero, antes de producir el resto.

Coste del piloto ≈ 1.150 créditos. Resto del pack (≈ 20 modelos 3D) ≈ 18.000-20.000 créditos.
