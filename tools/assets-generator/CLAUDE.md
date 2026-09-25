# assets-generator — generador de assets isométricos para EscapeRoom

Herramienta para producir packs gráficos del juego en distintos estilos: masters 2D en Magnific → 3D (Tripo, en
Magnific) → Mixamo → Blender (render isométrico 2:1) → empaquetado; suelos y muros con el generador de tiles SVG.
Autocontenida: no depende de nada de fuera de esta carpeta. Nació en el repositorio `pipeline-assets` (studiolxd),
que conserva los experimentos con IA local/LoRA (`exp-lora/`) y el historial de trabajo descartado (`archivo/`).

## Tres niveles
```
scripts/  docs/  package.json     HERRAMIENTA: genérica, no sabe de ningún estilo ni pack
entorno.json  requirements.txt    versiones validadas (Blender, Python, Pillow, numpy, Node, sharp)
estilos/<estilo>/                 LENGUAJE VISUAL, reutilizable entre packs
  estilo.json                     cámara, luz, fondo, sala neutra, celda (m), personajes (cámara fija, recorte, suelo,
                                  metal), resolución de objetos, relleno de iconos
  biblia.md                       reglas visuales y plantillas de prompt (personajes e iconos)
  referencias/                    hojas de referencia para los prompts
  tiles/                          estetica.json + presets/ del generador de tiles
  renders/                        SVG y previews de los tiles (fuera de git)
packs/<pack>/                     UN PACK DEL JUEGO = un estilo + sus assets
  pack.json                       id, versión, estilo, exportador, proyección, collides, avatar (animaciones, acciones,
                                  direcciones, tamaños, etiquetas), iconos (hojas), derivados, objetos colgados, fx
  tiles.json                      nombre del juego -> preset de tiles
  objetos.json                    render (GLB, escala, encuadre, estados...) y empaquetado de cada objeto
  pared.json                      objetos planos de pared (imagen, alto, altura, grosor)
  blender/                        código propio del pack: constructores de objetos, escenas de pared, sala de prueba
  CLAUDE.md                       requisitos del juego y decisiones de este pack
  docs/                           plan de objetos, fichas de personaje, integración con el runtime
  fuentes/                        SOLO lo necesario para regenerar las entregas (personajes/, objetos/, pared/, iconos/,
                                  fx/), con la ficha de cada master
  renders/                        salida de Blender y export de tiles (fuera de git, regenerable)
  entregas/                       lo que recibe el juego (avatares/, iconos/, objetos/, fx/)
  salida/                         carpeta del pack para `pnpm pack:build` (fuera de git)
```
Estilos actuales: `castillo-toon` (toon 3D, el de `medieval-v1`) y `vector-plano` (la estética original del
generador de tiles: solo tiles, placeholders de `scripts/tiles/sprites.py`). Pack actual: `medieval-v1`.

## Scripts
Todos se lanzan desde `assets-generator/` y eligen el pack con `--pack <id>` (Python) o `PACK=<id>` (Blender); si
solo hay un pack, lo usan sin decirlo. `scripts/comun/contexto.py` resuelve pack, estilo, rutas y Blender (variable
`BLENDER`, `blender` del PATH o la ruta de macOS); `scripts/comun/validar.py` valida la configuración al cargarla.
```bash
B=$(python3 -c "import sys;sys.path.insert(0,'scripts/comun');import contexto;print(contexto.blender())")
PACK=medieval-v1 OBJ=arca $B -b --python scripts/blender/render_objeto.py          # -> packs/medieval-v1/renders/arca/
PACK=medieval-v1 PARTE=salon $B -b --python scripts/blender/render_pared.py        # salon | bodega | estandarte
PACK=medieval-v1 PERSONAJE=caballero-m $B -b --python scripts/blender/render_animaciones.py
PACK=medieval-v1 $B -b --python scripts/blender/exportar_mixamo.py -- <tripo.glb> <salida.fbx>   # HEIGHT_M = altura del estilo
python3 scripts/empaquetar/empaquetar_objeto.py --todos          # o <grupo> ...  -> entregas/objetos/
python3 scripts/empaquetar/empaquetar_avatar.py caballero-m      # -> entregas/avatares/
python3 scripts/empaquetar/empaquetar_iconos.py                  # hojas de pack.json -> entregas/iconos/
python3 scripts/empaquetar/empaquetar_derivados.py               # inspección, puzles, copias (fx) -> entregas/
python3 scripts/empaquetar/empaquetar_pack.py                    # -> packs/<pack>/salida/
python3 scripts/verificar.py [--rapido]                          # regenera TODO y lo compara con entregas/ y salida/
python3 scripts/comun/validar.py | scripts/fichas.py             # configuración | trazabilidad y créditos
python3 scripts/fx/fx_brillo.py --key fx-spark                   # generador de brillos (para packs nuevos)
pnpm run tiles:build | tiles:preview | tiles:preview-estetica <estilo> | objetos | pack | verificar | validar | fichas
```
- `scripts/blender/`: `iso.py` (cámara, sol y fondo del estilo), `geometria.py` (materiales, cajas, bisagras,
  cortes...), `render_objeto.py`, `render_pared.py`, `render_animaciones.py`, `exportar_mixamo.py`. El código propio
  de un pack (constructores de cada objeto, escenas) va en `packs/<pack>/blender/` y el script genérico lo carga
  (`PACK.modulo(...)`); toda la configuración, en los JSON del pack y del estilo, nunca dentro de `scripts/`. Las
  medidas que dependen de otras (escala px/m, arco de la puerta según el preset de muro...) se calculan, no se copian.
- `scripts/empaquetar/`: `inventario.py` (qué frames hay, con lienzo y pivote, sin saber del juego) +
  `exportadores/<exportador>.py` (formato del juego: `escaperoom` = carpetas, `pack.config.json`, `origins`). Otro
  juego u otro formato = otro exportador y `"exportador"` en `pack.json`.
- `scripts/tiles/`: generador de tiles. **`docs/tiles/contexto.md` es su documentación completa** (antes el
  CLAUDE.md de `tiles-generator/`) y manda para todo lo de `scripts/tiles/` y `estilos/*/tiles/`. Presets siempre
  con estilo: `castillo-toon/piedra-1`.
- **Entregas 100 % regenerables:** todo lo de `entregas/` sale de `fuentes/` + configuración con los scripts
  anteriores; lo hecho a mano sin código (fx-spark) vive en `fuentes/` y se copia. `scripts/verificar.py` lo
  comprueba: después de tocar código, estilo o pack, ejecutarlo (completo ~4 min con `--jobs 3`; `--rapido` sin
  Blender, 20 s) y no dar nada por bueno si hay diferencias sin explicar.
- Entorno validado en `entorno.json` (Blender 5.2.2: otra versión puede cambiar los renders) y `requirements.txt`.

## Pack o estilo nuevo
```bash
python3 scripts/nuevo_estilo.py <estilo> [--desde castillo-toon] [--sin-3d]
python3 scripts/nuevo_pack.py <pack> --estilo <estilo> [--desde medieval-v1]
python3 scripts/comun/validar.py --pack <pack>
```
- Estilo: ajustar `estilo.json`, escribir `biblia.md`, poner las hojas en `referencias/` y crear los presets de tiles
  (`tilegen.py new <tipo> <nombre> --estilo <estilo>`).
- Pack: rellenar `pack.json`, `tiles.json`, `objetos.json`, `pared.json`, los constructores de `blender/objetos.py`
  (`CONSTRUCTORES`) y las escenas de `blender/pared.py` (`PARTES`). Ejemplo completo: `packs/medieval-v1/`.
- Un asset nuevo: sus fuentes definitivas en `packs/<pack>/fuentes/` **con su ficha** (`ficha.json`: modelo, prompt,
  referencias, créditos e id de Magnific de cada paso; ver `scripts/fichas.py`); pruebas y versiones descartadas
  fuera de git (o en `archivo/` de pipeline-assets), nunca aquí.

## Pipeline de personajes jugables (validado con caballero-m, 25/09/2026)
1. Master 2D en Magnific (Space "Personajes jugables", GPT 2, 2K, hojas de `estilos/<estilo>/referencias/`) → retoque
   por zonas si hace falta (máscara solo blanco/negro, ajustada a la silueta) → `fuentes/personajes/<id>/master.png`.
   Elección del modelo (GPT 2 frente a Nano Banana Pro y Seedream 5 Pro): ver la ficha del caballero (la comparativa
   de imágenes está en `archivo/` de pipeline-assets).
2. 3D en el Space (Tripo, ~775 créditos) → `fuentes/personajes/<id>/tripo.glb` → `exportar_mixamo.py`
   (quita rig, ~60k triángulos, `HEIGHT_M`).
3. Mixamo (manual, usuario): auto-rig + las animaciones de `avatar.animaciones` del pack → `mixamo/<anim>.fbx`.
   Anotar cada paso de Magnific en `fuentes/personajes/<id>/ficha.json`.
4. `render_animaciones.py` (cámara iso 2:1 FIJA del estilo, luz arriba-izq, metal, cabeza levantada) →
   `renders/<id>/` → `empaquetar_avatar.py` (recorte fijo del estilo) → `entregas/avatares/<id>/`.

## Normas de trabajo con Magnific (decididas por el usuario)
- **Aprobación por paso:** en toda generación con coste (Magnific: master → retoque → 3D; RunPod...) parar tras
  CADA paso, enseñar el resultado con su coste real y proponer el siguiente con su coste; no encadenar pasos aunque
  el plan general esté aprobado.
- Montar los flujos en Spaces de Magnific (uno por pack o por tipo de asset: "Objetos · Sala del trono",
  "Personajes jugables") y añadir cada creación a su fila; anotar el paso en la ficha del asset.
- Objetos del mundo: master GPT 2 → Tripo → Blender. Los arreglos se hacen en Blender (interiores, piezas móviles,
  quitar geometría suelta de Tripo). El upscale y el re-texturizado en Magnific se probaron con el arca y no
  compensan (re-texturizar con textura HD cuesta ~1.160 créditos, salió peor y re-malla el modelo): avisar antes.

## Sombras (decisión)
- El motor del juego dibuja una sombra genérica (elipse) en su propia capa → los sprites se entregan SIN sombra de
  contacto: no se mueve al saltar/atacar, respeta el orden de dibujo isométrico, no parpadea entre fotogramas y sirve
  para todas las direcciones.
- El sombreado del propio personaje va pegado (normal en 2D); al espejar direcciones la luz cambia de lado.

## Git
- Fuera de git: `renders/` y `salida/` (en cualquier estilo o pack), `node_modules/` y secretos.
- En el repositorio del juego, además, los **binarios de `fuentes/`, `entregas/` y `estilos/*/referencias/` se quedan
  en local** (reglas en el `.gitignore` de la raíz del juego; almacenamiento por decidir). Sí se versionan las fichas
  (JSON) y los LEEME. Copia de seguridad: el repo pipeline-assets. Sin esos binarios, `verificar.py` y `validar.py`
  dicen qué falta.
  Commits solo cuando el usuario lo pida.
