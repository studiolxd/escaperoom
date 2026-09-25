# Traslado de assets-generator al repositorio del juego

Instrucciones para el agente del repositorio `escaperoom` (studiolxd/escaperoom). Objetivo: llevarse
`assets-generator/` desde `pipeline-assets` a `escaperoom/tools/assets-generator/`, dejarlo funcionando y
verificado, **versionando solo código, configuración y documentación** (~190 archivos, ~1,2 MB), sin tocar el
workspace, la CI ni el lockfile del juego.

Origen: repo local `/Users/suvi/Dev/pipeline-assets`, rama `main`, carpeta `assets-generator/`.

## Qué es y por qué va en `tools/`
- Herramienta en Python + Blender + Node (sharp) que genera los packs gráficos: `packs/<pack>/salida/` es lo que
  se copia a `packages/web/public/packs/<pack>/` para `pnpm pack:build`. Documentación: `README.md` (uso) y
  `CLAUDE.md` (todo el contexto para agentes; leerlo antes de tocar nada).
- Es autocontenida, con su propio `package.json` (pnpm 12.5.1, Node 26, como el juego), `pnpm-workspace.yaml` y
  `pnpm-lock.yaml`. En `tools/` queda fuera de `packages/*`: no entra en el workspace del juego, ni en turbo, ni en
  la CI, ni en el lockfile raíz. **No añadirla al workspace del juego.**

## Binarios: en local, fuera de git (decisión del usuario, 25/09/2026)
- `packs/*/fuentes/` (~245 MB: masters, GLB de Tripo, FBX de Mixamo, imágenes de pared e iconos), `packs/*/entregas/`
  (~54 MB, se regeneran) y `estilos/*/referencias/` (hojas de referencia, recortes de un dataset de terceros) se
  copian a la máquina pero **no se versionan**. El almacenamiento definitivo se decidirá más adelante.
- Sí se versionan las fichas de cada master (`fuentes/**/ficha(s).json`: modelo, prompt, créditos) y los LEEME de
  `entregas/`.
- Copia de seguridad mientras tanto: el repo `pipeline-assets`, donde siguen versionados. En otro clon del juego,
  copiarlos de ahí (paso 3); sin ellos, `validar.py` y `verificar.py` dicen qué falta.

## Requisitos de la máquina
- Blender 5.2.2 (`/Applications/Blender.app` o `blender` en el PATH; si no, variable `BLENDER`).
- Python 3.9+ con Pillow y numpy (`requirements.txt`).
- Node 26+ y pnpm 12.5.1 por corepack.

## Pasos
1. **Rama** en escaperoom: `git switch -c chore/assets-generator`.
2. **`.gitignore` de la raíz del juego**, antes de copiar nada (añadir al final):
   ```gitignore
   # assets-generator: los binarios se quedan en local, fuera de git (el almacenamiento se decidirá más adelante;
   # copia de seguridad en el repo pipeline-assets). Sí se versionan las fichas (JSON) y los LEEME (Markdown).
   tools/assets-generator/packs/*/fuentes/**
   !tools/assets-generator/packs/*/fuentes/**/
   !tools/assets-generator/packs/*/fuentes/**/*.json
   tools/assets-generator/packs/*/entregas/**
   !tools/assets-generator/packs/*/entregas/**/
   !tools/assets-generator/packs/*/entregas/**/*.md
   tools/assets-generator/estilos/*/referencias/**
   !tools/assets-generator/estilos/*/referencias/**/
   ```
   `assets-generator` lleva además su propio `.gitignore` (`renders/`, `salida/`, `node_modules/`).
3. **Copiar** (lo versionado en pipeline-assets, que incluye los binarios; sin renders, salida ni node_modules):
   ```bash
   mkdir -p tools
   git -C /Users/suvi/Dev/pipeline-assets archive main assets-generator | tar -x -C tools
   ```
4. **Prettier**: añadir `tools/assets-generator` al `.prettierignore` de la raíz (`pnpm format` reformatearía sus
   JSON, Markdown y .mjs, que tienen su propio formato y en parte se generan por script). ESLint y turbo solo miran
   `packages/*`: no hace falta tocarlos.
5. **Instalar**:
   ```bash
   cd tools/assets-generator
   pnpm install --frozen-lockfile
   python3 -m pip install -r requirements.txt
   ```
6. **Verificar** (obligatorio antes del commit):
   ```bash
   python3 scripts/verificar.py --jobs 3
   ```
   Tarda ~5 min: valida la configuración, renderiza en Blender los 24 objetos, las 3 partes de pared, el personaje y
   la sala de prueba, regenera entregas y pack y los compara con los locales. Tiene que terminar en
   `== SIN DIFERENCIAS`. Si no, no seguir: revisar la versión de Blender (`entorno.json`) y avisar al usuario.
7. **Comparar con el pack que ya usa el juego**:
   ```bash
   python3 scripts/empaquetar/empaquetar_pack.py --pack medieval-v1
   P=../../packages/web/public/packs/medieval-v1
   for k in tiles sprites icons avatar fx; do diff -rq packs/medieval-v1/salida/$k $P/$k; done
   ```
   Diferencias esperadas (25/09/2026):
   - `sprites/puerta-*` y `sprites/reja*` (12): el hueco del arco pasó a calcularse de la escala del estilo
     (píxeles sueltos del borde del arco). Actualizarlos en el juego es decisión del usuario.
   - `tiles/tile-madera.png` solo en la salida (el fixture no lo usa); `icons/LEEME.md`, `avatar/maniqui/` y
     `avatar/caballero-m/LEEME.md` solo en el juego (son del juego: no borrarlos al copiar).
   - `pack.config.json`: el del juego aún tiene `sizes["icon-mechero"]`, que ya no existe (el item se renombró a
     yesquero); el resto es idéntico.
8. **Enlazar la documentación**: en el `CLAUDE.md` de la raíz del juego, una línea: «Assets gráficos (estilos,
   packs, renders de Blender, tiles SVG): `tools/assets-generator/` — leer su `CLAUDE.md` antes de tocarlo; sus
   binarios (`fuentes/`, `entregas/`) son locales y no se versionan.»
9. **Commit**: comprobar antes que no entra ningún binario:
   ```bash
   git add .gitignore .prettierignore CLAUDE.md tools/assets-generator
   git diff --cached --name-only | grep -E '\.(png|jpg|webp|glb|fbx)$'   # solo docs/integracion/pack_como_runtime.jpg
   ```
   Mensaje: `chore: traer assets-generator desde pipeline-assets (<hash de main en pipeline-assets>)`. PR.

## Uso en el juego (resumen; detalle en README.md y CLAUDE.md)
- Todo se lanza desde `tools/assets-generator/`. Pack con `--pack <id>` o `PACK=<id>`.
- Flujo: renders de Blender → `empaquetar_*` (entregas) → `empaquetar_pack.py` (salida) → copiar
  `packs/<pack>/salida/{tiles,sprites,icons,avatar,fx,pack.config.json}` a `packages/web/public/packs/<pack>/`
  (añadiendo/sobrescribiendo, sin borrar lo propio del juego) → `pnpm pack:build <pack>` en la raíz.
- **No** usar `empaquetar_pack.py --salida packages/web/public/packs/<pack>`: la carpeta de salida se borra entera
  antes de escribir.
- Los avatares salen en `avatar/<personaje>/` (subcarpeta por personaje, como ya lee `pack:build`).
- Después de tocar scripts, estilo o pack: `python3 scripts/verificar.py` (o `--rapido` sin Blender, 20 s).
- Encargo vigente al runtime (escala, lienzo, `sizes`/`origins`, fixture):
  `packs/medieval-v1/docs/integracion/ESPECIFICACION-INTEGRACION-RUNTIME.md`.
- Generaciones con coste (Magnific): pedir aprobación al usuario en cada paso (normas en `CLAUDE.md`).

## Qué NO se trae
- `pipeline-assets/exp-lora/` (experimentos con IA local/LoRA, en pausa) y `pipeline-assets/archivo/` (revisiones y
  versiones descartadas): se quedan en pipeline-assets.
