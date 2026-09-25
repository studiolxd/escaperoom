# Catálogo de ideas de puzzles

Repertorio original de minijuegos y puzzles (fuente de futuras plantillas). Las que ya tienen
especificación completa son las 23 de `reference/catalogo-plantillas.md`; el resto queda como banco
de ideas para la v2+.

> Las plantillas marcadas con ✅ están ya especificadas e implementables. El resto sirve para
> diseñar plantillas nuevas con el mismo patrón (schema Zod + componente React + validación servidor).

---

## 1. Puzzles clásicos de un solo jugador

| Juego | Descripción | Dificultad | Estado |
|---|---|---|---|
| Código numérico | Candado de 4–6 dígitos, pistas repartidas por la sala | ⭐ | ✅ `code_lock` |
| Código con símbolos/colores | Secuencia de colores o símbolos hallados en decoración | ⭐ | ✅ variante `code_lock` |
| Adivinanza / acertijo | Texto cifrado, jeroglíficos o adivinanza escrita | ⭐ | 🔲 idea |
| Puzle deslizante (15-puzzle) | Reordenar piezas para formar una imagen o mapa | ⭐⭐ | ✅ `sliding_puzzle` |
| Memoria | Tablero de cartas: encontrar pares | ⭐⭐ | ✅ `memory` |
| Rompecabezas de piezas | Completar un mosaico, mapa o pintura | ⭐⭐ | 🔲 idea |
| Laberinto | Trazar un camino con números ocultos | ⭐⭐ | 🔲 idea |
| Secuencia musical | Repetir una melodía con notas o campanas | ⭐⭐ | ✅ `sequence_music` |
| Pesas y balanza | Equilibrar objetos de peso desconocido | ⭐⭐ | ✅ `balance_scale` |
| Tangram / formas | Encajar piezas en un hueco con forma | ⭐⭐⭐ | 🔲 idea |
| Tuberías / cables | Conectar conductos de un punto a otro | ⭐⭐ | ✅ `pipes` |
| Lógica tipo Sudoku | Rejilla sin repetir en filas/columnas | ⭐⭐⭐ | ✅ `symbol_sudoku` |
| Circuito eléctrico | Cerrar un circuito moviendo piezas | ⭐⭐⭐ | ✅ `circuit_board` |
| Reflejos / timing | Pulsar botones en el instante justo | ⭐⭐⭐ | ✅ `timing_press` |
| Quitar palitos / coincidencias | Reordenar elementos para corregir una ecuación | ⭐ | ✅ `matchsticks` |
| Palabra oculta / sopa de letras | Letras escondidas que forman una palabra-clave | ⭐⭐ | ✅ `word_search` |

## 2. Puzzles de exploración e interacción con el escenario

| Juego | Descripción | Estado |
|---|---|---|
| Llave escondida | Tras un cuadro, bajo una alfombra, dentro de un libro | ✅ `hidden_key` |
| Ordenar objetos | Colocar libros, jarrones o espadas en un orden concreto | 🔲 idea |
| Espejo / proyección | Alinear un espejo para reflejar luz hacia un objetivo | ✅ `light_mirrors` |
| Cajones con mecanismo | Abrir cajones en el orden correcto según pistas | ✅ vía `code_lock` + reglas |
| Símbolos ocultos en el entorno | Solo visibles desde un ángulo o con luz | 🔲 idea |
| Fósforos / agua / plantas | Física simple: encender antorchas, llenar cubos, crecer una planta | 🔲 idea / ✅ `rising_water` (agua) |
| Mapa del tesoro | Mapa incompleto que se completa encontrando fragmentos | 🔲 idea |
| Reloj / mecanismo | Girar engranajes para alinear agujas a una hora clave | ✅ `gear_mechanism` |

## 3. Puzzles de inventario y combinación

| Juego | Descripción | Estado |
|---|---|---|
| Combinar objetos | Vela + yesquero = antorcha encendida | ✅ `combine_items` |
| Usar objeto en el sitio | Palanca en la escotilla, imán para sacar una llave | ✅ reglas `on_interact` |
| Desmontar / inspeccionar | Examinar un objeto para encontrar un número dentro | ✅ `combine_items` (`consumeInputs:false`) |
| Receta / ritual | Mezclar ingredientes en orden para crear un componente | ✅ `combine_items` |

## 4. Puzzles cooperativos (requieren 2+ jugadores)

| Juego | Descripción | Mín. jugadores | Estado |
|---|---|---|---|
| Botones simultáneos | Dos jugadores pisan placas a la vez | 2 | ✅ `simultaneous_plates` |
| Pista dividida | Cada jugador ve un fragmento de un código | 2 | ✅ `split_clue` / `split_clue_multi` |
| Simetría | Uno ve un patrón y lo describe; otro lo replica | 2+ | ✅ `mirror_copy` |
| Relé de activación | A abre una puerta X segundos para que pase B | 2 | ✅ `relay_activation` |
| Puzle en cadena | Cada jugador resuelve una parte seguida | 2+ | ✅ `team_split` / `multi_lock` |
| Espejo y sombra | Uno guía a otro por un laberinto por voz | 2 | 🔲 idea |
| Desafío contrarreloj por equipos | Pistas repartidas; cada equipo resuelve su mitad | 2+ | ✅ `team_split` |
| Intercambio de objetos | Ningún jugador resuelve su sala sin un objeto del otro | 2 | 🔲 idea (reglas) |

## 5. Juegos narrativos / de deducción

| Juego | Descripción | Estado |
|---|---|---|
| Misterio de asesinato | Interrogar NPCs, cruzar coartadas y acusar | 🔲 v2 (NPCs con diálogos ramificados) |
| Causa y efecto histórico | Reconstruir la línea temporal ordenando momentos | 🔲 idea |
| Cartas / notas encontradas | Leer diarios y cartas para inferir el código final | 🔲 idea (vía `dialogs` + `code_lock`) |
| Alibi falso | Detectar la mentira en testimonios contradictorios | 🔲 v2 (NPCs que mienten) |

## 6. Variantes por tiempo y presión (modo clasificación)

- **Contrarreloj estricto:** pistas limitadas y penalización por usarlas.
- **Pistas degradadas:** cada pista reduce la puntuación final.
- **Efecto dominó:** fallar un puzzle añade tiempo penal al siguiente.

## Recomendación original de MVP

Implementar solo estas 8 plantillas: **código numérico, puzle deslizante, memoria, tuberías,
combinar objetos, llave escondida, botones simultáneos y pista dividida.** Con ellas se puede
construir casi cualquier sala sencilla y cubren lo individual y lo cooperativo. (Es exactamente el
MVP especificado en `specs/06-plantillas-puzzle-mvp.md`.)
