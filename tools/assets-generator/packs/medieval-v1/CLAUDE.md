# Pack `medieval-v1` — escape room del Rey Aldric (EscapeRoom)

Estilo `castillo-toon` (`../../estilos/castillo-toon/`). Herramienta y estructura: `../../CLAUDE.md`.

## Contenido
- `pack.json`, `tiles.json`, `objetos.json`, `pared.json`: configuración (ver `../../CLAUDE.md`).
- `blender/objetos.py` (constructores: bisagras, interiores, fuego, agua, copas...), `blender/pared.py` (salón del
  trono, bodega con el mural, estandarte), `blender/sala_prueba.py` + `modelo_llave.py` (sala para ver objetos en
  contexto: `PACK=medieval-v1 Blender -b --python packs/medieval-v1/blender/sala_prueba.py`).
- `docs/personajes.md` (fichas), `docs/plan_objetos_mundo.md`, `docs/integracion/ESPECIFICACION-INTEGRACION-RUNTIME.md`
  (encargo vigente al runtime, con `pack_como_runtime.jpg`) e `integracion/historial/` (encargos anteriores).
- `fuentes/`: `personajes/caballero-m/` (master aprobado, tripo.glb, mixamo/), `objetos/<id>/` (master que se subió
  a Tripo + tripo.glb; puerta/hoja.png; llave solo GLB), `pared/` (cuadros, tapices, estandarte, mural, mirilla,
  recortados, + azulejo-central), `iconos/` (masters de llaves y yesquero + hoja_iconos.png de GPT 2), `fx/` (fx-spark).
- Todo `entregas/` se regenera (`scripts/verificar.py` lo comprueba): imágenes de inspección, puzle del mural y la
  llave en el suelo salen de "derivados" de `pack.json`; los iconos, de "iconos.hojas"; el brillo `fx-spark` se
  dibujó a mano (su código se perdió): la fuente es `fuentes/fx/fx-spark/` y se copia. Para uno nuevo,
  `scripts/fx/fx_brillo.py`.
- Fichas de cada master (Spaces "Objetos · Sala del trono" y "Personajes jugables" de Magnific): `ficha.json` en
  `fuentes/personajes/<id>/` y `fuentes/objetos/<id>/`, `fuentes/pared/fichas.json`, `fuentes/iconos/fichas.json`.
  Resumen y créditos: `python3 scripts/fichas.py`.
- 25/09/2026: el hueco del arco de la puerta y la reja pasó a calcularse del preset `muro-arco` y de la escala del
  estilo (antes, 43,24 px/m escrito a mano; ahora 43,2425): sus sprites cambiaron píxeles sueltos del borde del arco.
- Pivotes por frame en `entregas/objetos/pivotes.json` (los escribe `empaquetar_objeto.py`; los lee
  `empaquetar_pack.py`, que añade `sizes` y `origins` a `pack.config.json`).
- Carpetas de render: la "salida" (o el nombre) de cada objeto en `objetos.json`; pared en `renders/pared-salon`,
  `renders/pared-bodega` y `renders/estandarte`; personajes en `renders/<id>`; tiles en `renders/tiles`.

## Requisitos del juego (EscapeRoom, `docs/` del repositorio del juego)
Specs del juego: `specs/04-runtime-juego-y-mundo.md` §2 y `specs/26-pack-grafico-v1.md`. Correcciones del
usuario (25/09/2026) que prevalecen sobre esos docs:
- Jugadores: hasta **8 personajes medievales seleccionables** (mitad masculinos, mitad femeninos), no un
  avatar único tintable. Empezar por 1 y no hacer los 8 hasta validar el proceso.
  Reparto propuesto: caballero/a, arquero/a, mago/a, campesino/a.
- Sprite en juego pequeño (spec: 64×96 a 1×, 128×192 a 2×), pero **generar en alta calidad** y guardar el
  master para reutilizarlo (retrato/cara para avatar, referencias, etc.).
- Isométrico 2:1, 4 direcciones (n/e/s/w). Animaciones (decisión 25/09/2026): **idle 8 fotogramas y andar
  8 fotogramas por dirección**; si da problemas, bajar a 6. "Interactuar" por definir (propuesta: alcanzar/
  manipular, 3-4 fotogramas). Total por personaje ≈ 4 × (8 + 8 + 4) = 80 fotogramas.
- Luz coherente en todo el pack. Paredes visibles: planos Y-Z y Z-X (las dos del fondo).
- Fondo oscuro `#0b1120` solo en algunos casos: los sprites deben leerse sobre fondo claro y oscuro.
- Producción 3D (pre-render) posible pero no obligatoria.
- Titularidad: las imágenes las genera el equipo, no los usuarios → son de la plataforma (la cautela de la
  spec 18 §2.3 es para audio generado por voz).
- `estilos/castillo-toon/referencias/` son recortes del Dataset C (de terceros): confirmar su licencia antes de
  distribuirlas.
