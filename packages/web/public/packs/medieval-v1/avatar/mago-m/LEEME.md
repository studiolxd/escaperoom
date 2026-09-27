# Avatar `mago-m` (Mago) — **PROVISIONAL**

Personaje del reparto (`tools/assets-generator/packs/medieval-v1/docs/personajes.md`) aún sin master ni render
propios: reutiliza los frames y el retrato de `caballero-m` **mediante enlaces simbólicos** (mismos PNG, solo
cambia el nombre), para poder probar la selección de los 8 personajes en el lobby (#180) mientras se genera el
real. Ver `docs/DEUDA.md` ("Sustituir los 7 personajes provisionales...").

Generado con `tools/assets-generator/scripts/empaquetar/empaquetar_avatar_alias.py mago-m --de caballero-m`
(entrega local en `entregas/avatares/mago-m/`, con `"alias_de": "caballero-m"` en su
`pack.config.fragment.json`) y publicado aquí como enlaces a `../caballero-m/` para no duplicar los PNG en el
repo (81 archivos por personaje, frente a duplicar ~1,8 MB cada uno).

Cuando `mago-m` tenga su propio master + render: generar su entrega real
(`empaquetar_avatar.py`/`empaquetar_retrato.py`), borrar esta carpeta de enlaces y sustituirla por la copiada
desde `entregas/`, y quitar `entregas/avatares/mago-m/` (el alias) de `tools/assets-generator/`.
