# assets-generator

Generador de packs gráficos isométricos 2:1 para EscapeRoom: personajes, objetos, paredes, iconos y efectos
renderizados en Blender a partir de masters 2D y modelos 3D (Magnific + Tripo + Mixamo), y suelos y muros en SVG.
Separa la **herramienta** (`scripts/`), los **estilos** (`estilos/<estilo>/`, lenguaje visual reutilizable) y los
**packs** (`packs/<pack>/`, los assets de cada pack del juego). Documentación completa para agentes: `CLAUDE.md`.

## Requisitos
- Blender **5.2.2** (otra versión puede cambiar los renders). Si no está en el PATH ni en
  `/Applications/Blender.app`, definir `BLENDER=/ruta/a/blender`.
- Python 3.9+ con `pip install -r requirements.txt` (Pillow, numpy).
- Node 26+ y pnpm 12 (`corepack enable`), para rasterizar los SVG con sharp.
- Versiones validadas: `entorno.json`.
- Binarios locales: `packs/*/fuentes/`, `packs/*/entregas/` y `estilos/*/referencias/` no se versionan en el repo del
  juego (copia de seguridad en el repo pipeline-assets); sin ellos no se puede regenerar ni verificar.

## Instalación
```bash
cd assets-generator            # en el repo del juego: tools/assets-generator
pnpm install --frozen-lockfile
python3 -m pip install -r requirements.txt
python3 scripts/verificar.py --jobs 3    # ~4 min: regenera todo y lo compara con lo entregado -> SIN DIFERENCIAS
```

## Uso
```bash
# 1. renders de Blender (salida en packs/<pack>/renders/, fuera de git)
PACK=medieval-v1 OBJ=arca        blender -b --python scripts/blender/render_objeto.py
PACK=medieval-v1 PARTE=salon     blender -b --python scripts/blender/render_pared.py
PACK=medieval-v1 PERSONAJE=caballero-m blender -b --python scripts/blender/render_animaciones.py
# 2. entregas (packs/<pack>/entregas/, en git)
python3 scripts/empaquetar/empaquetar_objeto.py --pack medieval-v1 --todos
python3 scripts/empaquetar/empaquetar_avatar.py --pack medieval-v1 caballero-m
python3 scripts/empaquetar/empaquetar_iconos.py --pack medieval-v1
python3 scripts/empaquetar/empaquetar_derivados.py --pack medieval-v1
# 3. carpeta del pack para el juego (packs/<pack>/salida/, fuera de git)
python3 scripts/empaquetar/empaquetar_pack.py --pack medieval-v1
# 4. en el juego: copiar salida/ a packages/web/public/packs/<pack>/ y `pnpm pack:build <pack>`
```
Atajos: `pnpm run verificar | validar | fichas | objetos | pack | tiles:build | tiles:preview`.

## Crear
```bash
python3 scripts/nuevo_estilo.py <estilo> [--desde castillo-toon]
python3 scripts/nuevo_pack.py <pack> --estilo <estilo> [--desde medieval-v1]
python3 scripts/tiles/tilegen.py new piedra suelo-1 --estilo <estilo>
python3 scripts/comun/validar.py --pack <pack>
```

## Estructura
```
scripts/     comun/ (contexto, validar), blender/, empaquetar/ (+ exportadores/), tiles/, fx/, verificar.py, fichas.py
docs/tiles/  documentación del generador de tiles
estilos/     castillo-toon/ (toon 3D, el de medieval-v1), vector-plano/ (solo tiles)
packs/       medieval-v1/ (escape room del Rey Aldric): configuración, blender/, fuentes/, entregas/, docs/
```
