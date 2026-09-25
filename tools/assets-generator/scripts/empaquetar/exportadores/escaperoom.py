"""
Exportador para EscapeRoom: la carpeta de fuentes que consume `pnpm pack:build <id>` (runtime
packages/game-runtime).

Salida: <destino>/{tiles,sprites,icons,fx}/*.png, avatar/<personaje>/*.png (subcarpeta por personaje, B4/B6 del
runtime) + pack.config.json + LEEME.md.
pack.config.json lleva lo que `pack:build` ya entiende (id, version, projection, collides, avatars, avatarOrigin,
anims) y dos campos nuevos que el juego tiene que aprender a leer (ver
packs/<id>/docs/integracion/historial/runtime_objetos_mundo.md §1.9):
- `sizes`: lienzo lógico (1×) de cada frame; el runtime debe pintar cada sprite a ese tamaño, no forzarlo a 64×96.
- `origins`: punto de apoyo de cada sprite como fracción [x, y] del frame, medido desde el ancla del runtime
  (`tileAnchor` = vértice inferior del rombo de la celda); por defecto [0.5, 1].
"""
import json
import shutil

CARPETAS = {"tile": "tiles", "muro": "sprites", "objeto": "sprites", "icono": "icons", "avatar": "avatar", "fx": "fx"}


def origen(f, proy):
    """Origin del runtime a partir del pivote del inventario (centro de la celda en el suelo)."""
    w1, h1 = f.lienzo_1x
    px, py = f.pivote
    if f.colgado:
        # Objetos que cuelgan de un muro: su pivote de render es la celda de suelo DELANTE del muro, pero en el
        # RoomPackage se colocan EN la celda del muro (como los cuadros del salón, la puerta y la reja). El origin se
        # calcula para esa celda: fila y=0 (sin sufijo) -> la celda de delante está media celda a la izquierda en
        # pantalla; columna x=0 (-der) -> a la derecha; a la misma altura.
        dx = -proy["tileWidth"] // 2 if f.nombre.endswith("-der") else proy["tileWidth"] // 2
        return [round((px * w1 + dx) / w1, 4), round(py, 4)]
    # pivote = centro de su celda; el ancla del runtime es el vértice inferior del rombo (media celda más abajo)
    return [round(px, 4), round(min(1.0, (py * h1 + proy["tileHeight"] // 2) / h1), 4)]


def exportar(pack, inv, dest, version):
    proy = pack["proyeccion"]
    if dest.exists():
        shutil.rmtree(dest)
    for k in ("tiles", "sprites", "icons", "avatar", "fx"):
        (dest / k).mkdir(parents=True)
    sizes, origins = {}, {}
    for f in inv.frames:
        carpeta = dest / CARPETAS[f.tipo] / (f.grupo or "")
        carpeta.mkdir(parents=True, exist_ok=True)
        shutil.copy(f.png, carpeta / f"{f.nombre}.png")
        if f.lienzo_1x is not None:
            sizes[f.nombre] = f.lienzo_1x
        if f.pivote is not None:
            origins[f.nombre] = origen(f, proy)
    config = {
        "id": pack.id,
        "version": version,
        "packageFormat": "roompackage/v1",
        "projection": proy,
        "collides": pack["collides"],
        "avatars": inv.avatares,
        "avatarOrigin": inv.avatar_origen or pack["avatar"]["origen_por_defecto"],
        "anims": inv.animaciones,
        "sizes": dict(sorted(sizes.items())),
        "origins": dict(sorted(origins.items())),
    }
    (dest / "pack.config.json").write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
    cuenta = {k: len(list((dest / k).rglob("*.png"))) for k in ("tiles", "sprites", "icons", "avatar", "fx")}
    (dest / "LEEME.md").write_text(f"""# Pack `{pack.id}` — fuentes para `pnpm pack:build {pack.id}`

Generado por `assets-generator/scripts/empaquetar/empaquetar_pack.py` (estilo `{pack.estilo.id}`). Copiar esta
carpeta a `escaperoom/packages/web/public/packs/{pack.id}/` y ejecutar `pnpm pack:build {pack.id}`.

PNG a {proy["scale"]}× (`projection.scale`). Frames: {json.dumps(cuenta)}.

- `tiles/`: suelos ({proy["tileWidth"]}×{proy["tileHeight"]} a 1×). `sprites/`: muros y objetos con su lienzo real.
- `icons/`: iconos de inventario. `avatar/<personaje>/`: frames de cada personaje. `fx/`: efectos.
""" + "".join(f"- {n}\n" for n in pack.cfg.get("notas_salida", [])) + f"""
`pack.config.json` añade `sizes` y `origins` (lienzo lógico y punto de apoyo por frame). Hasta que el juego los lea,
`pack:build` avisará de aspecto no canónico y el runtime forzará los sprites a 64×96: ver
`packs/{pack.id}/docs/integracion/historial/runtime_objetos_mundo.md` §1.9.
""")
    return cuenta, len(sizes), len(origins)
