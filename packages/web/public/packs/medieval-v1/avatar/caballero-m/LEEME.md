# Avatar `caballero-m` (caballero, masculino)

Generado el 25/09/2026: master 2D (GPT 2 en Magnific + retoque de guantes) → 3D (Tripo) → rig y animaciones
(Mixamo: Happy Idle, Walking in place, Picking Up) → render isométrico 2:1 en Blender (`render_animaciones.py`)
→ empaquetado (`empaquetar_avatar.py`). Luz única arriba-izquierda, sin sombra de contacto, fondo transparente.

## Contenido
- `2x/` 128×192 y `1x/` 64×96: 80 frames PNG con alfa, nombres `avatar-caballero-m-<dir>-<acción>-<n>` (con prefijo de personaje, ver `../../cambios-escaperoom-avatares.md` B4).
  - `idle` 8 frames (bucle), `walk` 8 frames (bucle), `interact` 4 frames (una vez).
- `pack.config.fragment.json`: `anims` con nº de frames y fps (idle 8, walk 12, interact 8), para el `pack.config.json`.
- `preview_2x.png`: todas las animaciones sobre fondo claro y `#0b1120`.

## Direcciones (proyección del runtime: pantalla = (dx − dy, dx + dy))
| frame | pantalla | rejilla |
|---|---|---|
| `e` | abajo-derecha | +x |
| `s` | abajo-izquierda | +y |
| `w` | arriba-izquierda | −x |
| `n` | arriba-derecha | −y |

## Cambios necesarios en el runtime
Detallados y justificados en `../../cambios-escaperoom-avatares.md` (pivote, direcciones, nº de frames,
personajes seleccionables, sombra de contacto). Cámara, recorte y pivote son comunes a los 8 personajes.
