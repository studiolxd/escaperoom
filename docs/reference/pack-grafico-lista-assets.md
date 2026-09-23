# Pack gráfico v1 — lista de assets (nombre | tamaño | descripción)

Compañera de `specs/26-pack-grafico-v1.md`. El **nombre del archivo debe ser exactamente el frame**
(el id del `RoomPackage`); PNG con alpha 2:1, pivote abajo-centro, un PNG por frame.

**Tiles vs sprites:** la *celda* de rejilla es siempre **64×32**. Los **tiles** (suelo) van dentro del
tilemap y **todos comparten el mismo tamaño** (64×32). Todo lo que tiene **altura** (muros, columnas,
muebles, objetos…) son **sprites** colocados encima, de **lienzo libre**. Phaser soporta un tileset
uniforme + sprites de cualquier tamaño con depth-sort; lo que no conviene es mezclar tamaños de tile
en la misma capa.

| Archivo | Tamaño | Descripción |
|---|---|---|
| **Tiles (todos iguales: 64×32, iso 2:1)** | | |
| `tile-1.png` | 64×32 | Tile: suelo de piedra (tablero A) |
| `tile-2.png` | 64×32 | Tile: suelo de loseta/piedra (tablero B) |
| `tile-3.png` | 64×32 | Tile: alfombra roja |
| **Muros** (sprites con altura, no tiles; pivote abajo-centro, dos caras visibles, `collides`) | | |
| `tile-10.png` | 64×64 | Muro recto (tileable); 2 caras + canto |
| `muro-esquina.png` | 64×64 | Muro en esquina (L) |
| `muro-antorcha.png` | 64×96 | Muro con antorcha |
| `muro-tapiz.png` | 64×96 | Muro con tapiz/estandarte |
| `muro-ventana.png` | 64×96 | Muro con ventana/mirilla |
| `muro-arco.png` | 64×96 | Muro con arco/paso |
| **Sprites con altura** (no son tiles; lienzo libre, pivote abajo-centro) | | |
| `tile-20.png` | 64×48 | Sprite: umbral de puerta |
| `tile-21.png` | 64×48 | Sprite: escalón / peldaño |
| `tile-22.png` | 64×48 | Sprite: reja / trampilla en el suelo |
| **Decoración** | | |
| `antorcha.png` | 64×96 | Antorcha de pared (apagada) |
| `barril-suelto.png` | 64×64 | Barril suelto |
| `barriles.png` | 96×96 | Grupo de barriles |
| `columna.png` | 64×128 | Columna |
| `estandarte.png` | 64×96 | Estandarte colgante |
| `tapiz-dragones.png` | 96×96 | Tapiz decorativo |
| **Objetos y estados** | | |
| `trono.png` | 128×128 | Trono del rey |
| `cuadro-rey.png` | 96×96 | Cuadro del rey |
| `cuadro-rey-torcido.png` | 96×96 | Cuadro del rey torcido (escondite revelado) |
| `cuadro-reino.png` | 96×96 | Retrato del reino |
| `cuadro-reino-4torres.png` | 96×96 | Retrato del reino con 4 torres |
| `tapiz-7-dragones.png` | 96×96 | Tapiz con 7 dragones |
| `armario.png` | 96×128 | Armario cerrado |
| `armario-abierto.png` | 96×128 | Armario abierto |
| `arca.png` | 96×96 | Arca (base) |
| `arca-cerrada.png` | 96×96 | Arca cerrada |
| `arca-abierta.png` | 96×96 | Arca abierta |
| `brasero.png` | 96×96 | Brasero (base) |
| `brasero-apagado.png` | 96×96 | Brasero apagado |
| `brasero-encendido.png` | 96×96 | Brasero encendido |
| `estatua-caballero.png` | 96×128 | Estatua de caballero |
| `placa-piedra.png` | 64×48 | Placa de presión (base) |
| `placa-arriba.png` | 64×48 | Placa sin pisar |
| `placa-hundida.png` | 64×48 | Placa pisada |
| `puerta-madera.png` | 96×128 | Puerta de madera (base) |
| `puerta-cerrada.png` | 96×128 | Puerta cerrada |
| `puerta-abierta.png` | 96×128 | Puerta abierta |
| `mural-azulejos.png` | 96×96 | Mural de azulejos (base) |
| `mural-desordenado.png` | 96×96 | Mural desordenado |
| `mural-completo.png` | 96×96 | Mural completo |
| `ranura-caliz.png` | 64×48 | Ranura del cáliz (base) |
| `ranura-vacia.png` | 64×48 | Ranura vacía |
| `ranura-con-caliz.png` | 64×48 | Ranura con cáliz |
| `compartimento.png` | 96×96 | Compartimento oculto (base) |
| `compartimento-cerrado.png` | 96×96 | Compartimento cerrado |
| `compartimento-abierto.png` | 96×96 | Compartimento abierto |
| `barril-cerrado.png` | 64×64 | Barril cerrado |
| `barril-movido.png` | 64×64 | Barril movido (hueco revelado) |
| `mesa-catas.png` | 128×96 | Mesa de catas (base) |
| `mesa.png` | 128×96 | Mesa |
| `mesa-activa.png` | 128×96 | Mesa activa |
| `reja.png` | 96×96 | Reja (base) |
| `reja-cerrada.png` | 96×96 | Reja cerrada |
| `reja-abierta.png` | 96×96 | Reja abierta |
| `mirilla.png` | 64×64 | Mirilla |
| `sarcofago.png` | 128×96 | Sarcófago |
| `altar.png` | 96×128 | Altar (base) |
| `altar-seco.png` | 96×128 | Altar seco |
| `altar-con-agua.png` | 96×128 | Altar con agua |
| `canal.png` | 64×64 | Canal de agua |
| `compuerta.png` | 96×96 | Compuerta (base) |
| `compuerta-cerrada.png` | 96×96 | Compuerta cerrada |
| `compuerta-abierta.png` | 96×96 | Compuerta abierta |
| `relicario.png` | 96×96 | Relicario (base) |
| `relicario-sellado.png` | 96×96 | Relicario sellado |
| `relicario-abierto.png` | 96×96 | Relicario abierto |
| `vasijas-8.png` | 128×96 | Conjunto de 8 vasijas |
| **Iconos de inventario** | | |
| `icon-antorcha.png` | 64×64 | Icono: antorcha |
| `icon-caliz.png` | 64×64 | Icono: cáliz |
| `icon-espejo.png` | 64×64 | Icono: espejo |
| `icon-llave-bronce.png` | 64×64 | Icono: llave de bronce |
| `icon-llave-plata.png` | 64×64 | Icono: llave de plata |
| `icon-llave-oro.png` | 64×64 | Icono: llave de oro |
| `icon-mechero.png` | 64×64 | Icono: mechero |
| `icon-pergamino.png` | 64×64 | Icono: pergamino |
| `icon-vela.png` | 64×64 | Icono: vela |
| **Avatar** (1 base tintable, 28 frames) | | |
| `avatar-n-idle-1.png` … `avatar-n-idle-2.png` | 64×96 | Avatar mirando al norte (quieto) |
| `avatar-n-walk-1.png` … `avatar-n-walk-4.png` | 64×96 | Avatar andando al norte |
| `avatar-n-interact-1.png` | 64×96 | Avatar interactuando al norte |
| *(idem `e`, `s`, `w`)* | 64×96 | … al este / sur / oeste |
| **Efectos** | | |
| `fx-spark-1.png` … `fx-spark-64.png` | 64×64 | Brillo dorado (o sheet 512×512, 8×8) |
