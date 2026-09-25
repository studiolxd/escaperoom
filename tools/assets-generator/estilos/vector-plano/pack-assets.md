# Lista de assets del pack `medieval-v1` (escaperoom)

> Estética `vector-plano`. Rutas actuales (desde `assets-generator/`): mapa en `estilos/vector-plano/tiles/pack.json`,
> generador `scripts/tiles/tilegen.py`, salida de `export` en `estilos/vector-plano/renders/pack/`.

Lista que le pasaron al usuario el 23-09-2026. Tamaños a 1× (el juego rasteriza a
64×32 por celda); aquí se entrega todo en SVG a 2× (128×64 por celda), y el
pipeline del juego lo rasteriza. La columna **Preset** indica qué preset de este
generador cubre cada asset; `pack.json` guarda ese mapa y `python3 tilegen.py
export` copia los SVG a `pack/tiles/` (`tile*`), `pack/icons/` (`icon-*`), `pack/avatar/`
(`avatar-*`), `pack/fx/` (`fx-*`) y `pack/sprites/` (el resto), que son las carpetas por las
que el script del juego decide el tipo de cada frame; listos para copiar al juego.

## Tiles (todos iguales: 64×32, iso 2:1)

| Archivo | Tamaño | Descripción | Preset |
|---|---|---|---|
| tile-1.png | 64×32 | Tile: suelo de piedra (tablero A) | piedra-1 |
| tile-2.png | 64×32 | Tile: suelo de madera (tablero B) | madera-1 |
| tile-3.png | 64×32 | Tile: alfombra roja | alfombra-1 (pendiente elegir entre alfombra-1/2/3) |

## Muros (sprites con altura, no tiles; pivote abajo-centro, dos caras visibles, collides)

| Archivo | Tamaño | Descripción | Preset |
|---|---|---|---|
| tile-10.png | 64×64 | Muro recto (tileable); 2 caras + canto | muro-1 |
| muro-esquina.png | 64×64 | Muro en esquina (L) | muro-1 (con bloque de celda completa la esquina es el mismo bloque; versión de muro fino: pared-esquina-1) |
| muro-antorcha.png | 64×64 | Muro con antorcha (soporte, anilla, mango, llama, hollín) | muro-antorcha-1 |
| muro-tapiz.png | 64×64 | Muro con tapiz (barra, paño rojo, ribete y rombo dorados) | muro-tapiz-1 |
| muro-ventana.png | 64×64 | Muro con ventana (aspillera con arco en marco de sillares) | muro-ventana-1 |
| muro-arco.png | 64×64 | Muro con arco (hueco recortado, dovelas, jambas/intradós; suelo de detrás transparente) | muro-arco-1 |
| muro-remate.png | 64×64 | Remate de muro (brazo único, canto a mitad de celda) | muro-1 (ídem esquina; versión de muro fino: pared-remate-1) |
| columna.png | 64×128 | Columna (fuste) | columna |
| columna-base.png | 64×48 | Base de columna | columna-base |
| columna-capital.png | 64×48 | Capital de columna | columna-capital |

## Sprites con altura (no son tiles; lienzo libre, pivote abajo-centro)

| Archivo | Tamaño | Descripción | Preset |
|---|---|---|---|
| tile-20.png | 64×48 | Sprite: umbral de puerta | tile-20 |
| tile-21.png | 64×48 | Sprite: escalón / peldaño | tile-21 |
| tile-22.png | 64×48 | Sprite: reja / trampilla en el suelo | trampilla-1 (sobre piedra-1; 128×64) |

## Decoración

| Archivo | Tamaño | Descripción | Preset |
|---|---|---|---|
| antorcha.png | 64×96 | Antorcha de pared (apagada) | antorcha |
| barril-suelto.png | 64×64 | Barril suelto | barril-suelto |
| barriles.png | 96×96 | Grupo de barriles | barriles |
| columna.png | 64×128 | Columna | columna |
| estandarte.png | 64×96 | Estandarte colgante | estandarte |
| tapiz-dragones.png | 96×96 | Tapiz decorativo | tapiz-dragones |

## Objetos y estados

| Archivo | Tamaño | Descripción | Preset |
|---|---|---|---|
| trono.png | 128×128 | Trono del rey | trono |
| cuadro-rey.png | 96×96 | Cuadro del rey | cuadro-rey |
| cuadro-rey-torcido.png | 96×96 | Cuadro del rey torcido (escondite revelado) | cuadro-rey-torcido |
| cuadro-reino.png | 96×96 | Retrato del reino | cuadro-reino |
| cuadro-reino-4torres.png | 96×96 | Retrato del reino con 4 torres | cuadro-reino-4torres |
| tapiz-7-dragones.png | 96×96 | Tapiz con 7 dragones | tapiz-7-dragones |
| armario.png | 96×128 | Armario cerrado | armario |
| armario-abierto.png | 96×128 | Armario abierto | armario-abierto |
| arca.png | 96×96 | Arca (base) | arca |
| arca-cerrada.png | 96×96 | Arca cerrada | arca-cerrada |
| arca-abierta.png | 96×96 | Arca abierta | arca-abierta |
| brasero.png | 96×96 | Brasero (base) | brasero |
| brasero-apagado.png | 96×96 | Brasero apagado | brasero-apagado |
| brasero-encendido.png | 96×96 | Brasero encendido | brasero-encendido |
| estatua-caballero.png | 96×128 | Estatua de caballero | estatua-caballero |
| placa-piedra.png | 64×48 | Placa de presión (base) | placa-piedra |
| placa-arriba.png | 64×48 | Placa sin pisar | placa-arriba |
| placa-hundida.png | 64×48 | Placa pisada | placa-hundida |
| puerta-madera.png | 96×128 | Puerta de madera (base) | puerta-madera |
| puerta-cerrada.png | 96×128 | Puerta cerrada | puerta-cerrada |
| puerta-abierta.png | 96×128 | Puerta abierta | puerta-abierta |
| mural-azulejos.png | 96×96 | Mural de azulejos (base) | mural-azulejos |
| mural-desordenado.png | 96×96 | Mural desordenado | mural-desordenado |
| mural-completo.png | 96×96 | Mural completo | mural-completo |
| ranura-caliz.png | 64×48 | Ranura del cáliz (base) | ranura-caliz |
| ranura-vacia.png | 64×48 | Ranura vacía | ranura-vacia |
| ranura-con-caliz.png | 64×48 | Ranura con cáliz | ranura-con-caliz |
| compartimento.png | 96×96 | Compartimento oculto (base) | compartimento |
| compartimento-cerrado.png | 96×96 | Compartimento cerrado | compartimento-cerrado |
| compartimento-abierto.png | 96×96 | Compartimento abierto | compartimento-abierto |
| barril-cerrado.png | 64×64 | Barril cerrado | barril-cerrado |
| barril-movido.png | 64×64 | Barril movido (hueco revelado) | barril-movido |
| mesa-catas.png | 128×96 | Mesa de catas (base) | mesa-catas |
| mesa.png | 128×96 | Mesa | mesa |
| mesa-activa.png | 128×96 | Mesa activa | mesa-activa |
| reja.png | 96×96 | Reja (base) | reja |
| reja-cerrada.png | 96×96 | Reja cerrada | reja-cerrada |
| reja-abierta.png | 96×96 | Reja abierta | reja-abierta |
| mirilla.png | 64×64 | Mirilla | mirilla |
| sarcofago.png | 128×96 | Sarcófago | sarcofago |
| altar.png | 96×128 | Altar (base) | altar |
| altar-seco.png | 96×128 | Altar seco | altar-seco |
| altar-con-agua.png | 96×128 | Altar con agua | altar-con-agua |
| canal.png | 64×64 | Canal de agua | canal |
| compuerta.png | 96×96 | Compuerta (base) | compuerta |
| compuerta-cerrada.png | 96×96 | Compuerta cerrada | compuerta-cerrada |
| compuerta-abierta.png | 96×96 | Compuerta abierta | compuerta-abierta |
| relicario.png | 96×96 | Relicario (base) | relicario |
| relicario-sellado.png | 96×96 | Relicario sellado | relicario-sellado |
| relicario-abierto.png | 96×96 | Relicario abierto | relicario-abierto |
| vasijas-8.png | 128×96 | Conjunto de 8 vasijas | vasijas-8 |

## Iconos de inventario

| Archivo | Tamaño | Descripción | Preset |
|---|---|---|---|
| icon-antorcha.png | 64×64 | Icono: antorcha | icon-antorcha |
| icon-caliz.png | 64×64 | Icono: cáliz | icon-caliz |
| icon-espejo.png | 64×64 | Icono: espejo | icon-espejo |
| icon-llave-bronce.png | 64×64 | Icono: llave de bronce | icon-llave-bronce |
| icon-llave-plata.png | 64×64 | Icono: llave de plata | icon-llave-plata |
| icon-llave-oro.png | 64×64 | Icono: llave de oro | icon-llave-oro |
| icon-mechero.png | 64×64 | Icono: mechero | icon-mechero |
| icon-pergamino.png | 64×64 | Icono: pergamino | icon-pergamino |
| icon-vela.png | 64×64 | Icono: vela | icon-vela |
| icon-busto.png | 64×64 | Icono: busto | icon-busto |

## Avatar (1 base tintable, 28 frames)

| Archivo | Tamaño | Descripción | Preset |
|---|---|---|---|
| avatar-n-idle-1.png … avatar-n-idle-2.png | 64×96 | Avatar mirando al norte (quieto) | avatar (28 archivos) |
| avatar-n-walk-1.png … avatar-n-walk-4.png | 64×96 | Avatar andando al norte | avatar |
| avatar-n-interact-1.png | 64×96 | Avatar interactuando al norte | avatar |
| (ídem e, s, w) | 64×96 | … al este / sur / oeste | avatar |

## Efectos

| Archivo | Tamaño | Descripción | Preset |
|---|---|---|---|
| fx-spark-1.png … fx-spark-64.png | 64×64 | Brillo dorado (o sheet 512×512, 8×8) | fx-spark (64 archivos, sin sheet) |
