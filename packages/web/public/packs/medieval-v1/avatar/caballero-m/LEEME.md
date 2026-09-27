# Avatar `caballero-m` (caballero, masculino)

Generado el 25/09/2026: master 2D (GPT 2 en Magnific + retoque de guantes) → 3D (Tripo) → rig y animaciones
(Mixamo: Happy Idle, Walking in place, Picking Up) → render isométrico 2:1 en Blender (`render_animaciones.py`)
→ empaquetado (`empaquetar_avatar.py`). Luz única arriba-izquierda, sin sombra de contacto, fondo transparente.

## Contenido
- `2x/` 128×192 y `1x/` 64×96: 160 frames PNG con alfa, nombres `avatar-caballero-m-<dir>-<acción>-<n>` (con prefijo de personaje, ver `../../cambios-escaperoom-avatares.md` B4).
  - `idle` 8 frames (bucle), `walk` 8 frames (bucle), `interact` 4 frames (una vez).
  - 8 direcciones (deuda "8 direcciones", `docs/DEUDA.md`): las 4 clásicas (n/e/s/w) + las 4 diagonales
    (ne/se/sw/nw), renderizadas con la misma cámara/recorte/suelo. `pack.config.fragment.json` declara las 8; el
    manifiesto del runtime (`manifest.avatars[].directions`) marca este personaje con `8`.
- `retrato-caballero-m.png`: retrato de cara (256×256, fondo transparente) para el selector de personaje del
  lobby, recortado de `fuentes/personajes/caballero-m/master.png` (encuadre en su `ficha.json` → `retrato`) con
  `scripts/empaquetar/empaquetar_retrato.py`. `pack.config.json` lo declara en `avatars[].portrait`.
- `pack.config.fragment.json`: `anims` con nº de frames y fps (idle 8, walk 12, interact 8) y `portrait`, para el
  `pack.config.json`.
- `preview_2x.png`: todas las animaciones sobre fondo claro y `#0b1120`.

## Direcciones (proyección del runtime: pantalla = (dx − dy, dx + dy))
| frame | pantalla | rejilla |
|---|---|---|
| `e` | abajo-derecha | +x |
| `s` | abajo-izquierda | +y |
| `w` | arriba-izquierda | −x |
| `n` | arriba-derecha | −y |
| `ne` | derecha (pura) | +x, −y |
| `se` | abajo (pura) | +x, +y |
| `sw` | izquierda (pura) | −x, +y |
| `nw` | arriba (pura) | −x, −y |

## Cambios necesarios en el runtime
Detallados y justificados en `../../cambios-escaperoom-avatares.md` (pivote, direcciones, nº de frames,
personajes seleccionables, sombra de contacto). Cámara, recorte y pivote son comunes a los 8 personajes.
