# Fichas de personaje — pack `medieval-v1`

Estilo y plantillas de prompt: `estilos/castillo-toon/biblia.md` (el `{PERSONAJE}` del prompt del master es la ficha).

Reparto: caballero/a, arquero/a, mago/a, campesino/a (4 masculinos, 4 femeninos).

### Caballero (masculino) — master aprobado: `fuentes/personajes/caballero-m/master.png` (en este pack)
Joven, pelo castaño corto, ojos marrones, expresión amable y decidida. Armadura de placas plateada con
**hombreras simétricas redondeadas**, tabardo azul intenso **liso (sin emblema)**, cinturón, guantes y botas
de cuero marrón, **exactamente una espada** envainada en la cadera izquierda, escudo redondo de madera a la espalda
(en la espalda solo el escudo). Principio: simplificar detalles pequeños que la IA o el 3D puedan romper.

### Caballera, arquero/a, mago/a, campesino/a
Pendientes: sus ids (`caballero-f`, `arquero-m`, `arquero-f`, `mago-m`, `mago-f`, `campesino-m`, `campesina-f`) y
etiquetas ya están en `pack.json` (`avatar.etiquetas`) y seleccionables en el juego, pero **provisionales**:
reutilizan los frames y el retrato de `caballero-m` mediante enlaces simbólicos
(`scripts/empaquetar/empaquetar_avatar_alias.py`, ver `docs/DEUDA.md` del juego). Sustituir por su propio
master + render cuando se generen (mismo pipeline que el caballero).
