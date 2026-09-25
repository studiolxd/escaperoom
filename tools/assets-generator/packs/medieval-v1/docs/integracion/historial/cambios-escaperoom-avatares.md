# EscapeRoom — cambios para avatares e iconos de inventario (runtime + especificaciones)

Fecha: 25/09/2026. Para: responsable del repo `escaperoom` (runtime `packages/game-runtime` y `docs/specs`).
Origen: pipeline de assets (`assets-generator/packs/medieval-v1`), primer personaje entregado: `entregas/avatares/caballero-m/`.

Este documento recoge (A) los cambios de criterio de producto sobre los avatares, que hay que llevar a las
especificaciones, y (B) los cambios de código que el runtime necesita para usar los avatares nuevos.
**Ningún cambio se repite por personaje:** se hacen una vez y los 8 personajes comparten cámara, recorte,
pivote y convención de nombres.

---

## A. Cambios de criterio → especificaciones

### A1. De "1 avatar tintable" a 8 personajes medievales seleccionables
- **Antes** (`specs/04` §2 y §8 "Avatares", `specs/26` §4.4, `reference/pack-grafico-lista-assets.md` "Avatar"):
  1 sprite base con tintado por color (4 colores = 4 jugadores), sin personalización.
- **Ahora:** **8 personajes medievales** entre los que cada jugador elige uno: caballero/a, arquero/a, mago/a,
  campesino/a (4 masculinos, 4 femeninos). Se producen de uno en uno; el primero es `caballero-m`.
- **Motivo:** decisión de producto (identidad y atractivo del personaje frente a un maniquí tintado). La elección
  de personaje no es "personalización de avatar" (que sigue fuera de alcance, `specs/26` §11): son personajes
  cerrados.
- **Decisión pendiente (producto):** ¿pueden dos jugadores de la misma sesión elegir el mismo personaje? Si sí, el
  runtime debe distinguirlos (anillo de color bajo los pies y/o nombre encima). Hoy el color por jugador ya existe
  en el chat (círculo con color + inicial); se puede reutilizar como anillo.
- **Afecta a:** `specs/04` §2 y §8, `specs/26` §4.4 y §7, `reference/pack-grafico-lista-assets.md`, `specs/19`
  (lobby: pantalla de elección de personaje), `specs/11` (protocolo: el jugador envía su personaje al unirse),
  `specs/14` (si el personaje elegido se persiste por participante de sesión).

### A2. Animaciones: más fotogramas y definición de "interactuar"
- **Antes** (`specs/04` §2, `specs/26` §4.4): `idle` 2 frames, `andar` 4 frames por dirección, `interactuar` 1.
- **Ahora:** `idle` **8** frames (bucle, 8 fps), `andar` **8** frames por dirección (bucle, 12 fps), `interactuar`
  **4** frames (una vez, 8 fps). Si en producción 8 diera problemas, se baja a 6. Total: 80 frames por personaje.
- **"Interactuar" = alcanzar/manipular:** el personaje extiende el brazo hacia el objeto a la altura del pecho y
  vuelve (cuadros, palancas, cofres, cerraduras). Otros gestos (recoger del suelo, examinar) quedan para después.
- **Motivo:** con 2 y 4 frames la animación se ve a saltos; al producir desde 3D, más frames no cuestan más.

### A3. Tamaños y masters
- **Se mantiene** el lienzo lógico **64×96 (1×)** y **128×192 (2×)**.
- **Nuevo:** de cada personaje se conserva un **master 2D a 1536×2048** y su **modelo 3D**, para reutilizar
  (retrato/cara para el avatar del chat o la selección de personaje, nuevas animaciones, nuevas direcciones).
- **Motivo:** el sprite de juego es pequeño; el master permite sacar retratos sin volver a generar.

### A4. Pivote del avatar (excepción a "abajo-centro")
- **Antes** (`specs/26` §3.1): origen/pivote abajo-centro.
- **Ahora:** el punto de apoyo (suelo bajo el personaje) está al **88,6 % del alto del frame** (desde arriba),
  centrado en horizontal. Es el mismo valor para los 8 personajes.
- **Motivo:** en proyección isométrica, el pie adelantado y la puntera quedan **por debajo** del punto de apoyo en
  pantalla. Si el suelo fuese el borde inferior, habría que cortar los pies; si se deja espacio y se pivota en el
  borde, el personaje flota ~11 px (a 1×).

### A5. Sombra de contacto: la dibuja el motor, no el sprite
- **Antes** (`specs/26` §2): "sombras de contacto suaves" en los assets.
- **Ahora:** los **sprites de avatar no llevan sombra**; el runtime dibuja bajo el avatar una **elipse de sombra**
  en su propia capa. (Objetos estáticos del mundo pueden seguir llevándola horneada.)
- **Motivo:** una sombra pegada al sprite se mueve con el cuerpo al andar o saltar, parpadea entre frames, se
  dibuja por encima de otros objetos en el orden isométrico y queda falsa en desniveles.

### A6. Luz única: dirección concreta
- **Antes** (`specs/26` §2): "luz única y coherente (p. ej. desde arriba-izquierda)".
- **Ahora:** luz **desde arriba a la izquierda y del lado del jugador** (≈45–60° de elevación). Con las paredes
  visibles en los planos Y-Z y Z-X (las dos del fondo), así ambas caras reciben luz y se distinguen.
- **Motivo:** si la luz viniera de detrás de las paredes visibles, las dos caras quedarían en sombra. Los avatares
  se renderizan desde 3D, así que la luz es exacta en las 4 direcciones (no se espejan).

### A7. Legibilidad sobre fondo claro y oscuro
- **Antes** (`specs/26` §2): "legibilidad sobre fondo oscuro (`#0b1120`)".
- **Ahora:** el fondo oscuro se usa **solo en algunos casos**; los sprites deben leerse **sobre fondo claro y
  oscuro**. Sin contorno (o muy fino, del tono del relleno) — biblia de estilo en `assets-generator/estilos/castillo-toon/biblia.md`.

### A8. Titularidad de las imágenes
- **Antes** (`specs/26` §8): "si algún asset se generara con IA, aplica `18` §2.3" (revisar TOS, no asumir
  titularidad plena).
- **Ahora:** `18` §2.3 trata **audio de voz generado por IA** (ElevenLabs). Las imágenes de los avatares las genera
  **el equipo** (no los usuarios) con herramientas bajo licencia comercial (Magnific plan de pago, Blender, Mixamo),
  y su titularidad es **de la plataforma**. Se documentan herramientas y fecha por asset (`LEEME.md` de cada
  personaje).

### A9. Producción desde 3D (aclaración)
- ADR-001 ya admite sprites pre-renderizados desde 3D. Para los avatares **es la vía elegida** (master 2D → 3D →
  rig/animación → render isométrico), porque garantiza la luz y la proyección exactas en 4 direcciones y la
  coherencia entre 80 frames. No es obligatoria para el resto del pack.

---

## B. Cambios de código (runtime) — se hacen una vez

### B1. Pivote del avatar — `src/phaser/avatar.ts`
```ts
// antes
this.sprite = this.scene.add.sprite(0, 0, first.key, first.frame).setOrigin(0.5, 1);
// después: leer del manifiesto con 1 por defecto (compatibilidad con packs antiguos)
const originY = options.manifest?.avatarOrigin?.[1] ?? 1;
this.sprite = this.scene.add.sprite(0, 0, first.key, first.frame).setOrigin(0.5, originY);
```
Y en el esquema Zod del manifiesto: `avatarOrigin: z.tuple([z.number(), z.number()]).optional()`.
Valor del pack medieval: `[0.5, 0.886]`. **Motivo:** A4.

### B2. Dirección del avatar (corrección de un fallo) — `src/pack/avatar.ts`
```ts
// antes: compara en ejes de pantalla; con un paso de rejilla (dx o dy = ±1) hay empate
// y siempre devuelve "e"/"w": nunca "n" ni "s".
export function directionFromGridDelta(dx: number, dy: number): AvatarDirection {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}
```
Correspondencia con la proyección del runtime (pantalla = (dx − dy, dx + dy)):
`e` (+x) = abajo-derecha, `s` (+y) = abajo-izquierda, `w` (−x) = arriba-izquierda, `n` (−y) = arriba-derecha.
Actualizar el test: `dx=+1 → e`, `dx=-1 → w`, `dy=+1 → s`, `dy=-1 → n`. **Motivo:** es un fallo existente,
independiente del arte; afecta a cualquier avatar de 4 direcciones.

### B3. Nº de frames y velocidades — `src/pack/avatar.ts`
```ts
export const AVATAR_ACTION_FRAMES = { idle: 8, walk: 8, interact: 4 };
export const AVATAR_ACTION_FRAME_RATE = { idle: 8, walk: 12, interact: 8 };
```
(Alternativa sin tocar código: declarar `anims` en `pack.config.json`; cada personaje trae su
`pack.config.fragment.json`.) **Motivo:** A2.

### B4. Personajes seleccionables
1. **Nombres de frame con personaje** — `src/pack/avatar.ts`:
   ```ts
   export function avatarAnimKey(character: string, direction: AvatarDirection, action: AvatarAction) {
     return `avatar-${character}-${direction}-${action}`;
   }
   export function avatarFrameName(character: string, direction: AvatarDirection, action: AvatarAction, i: number) {
     return `${avatarAnimKey(character, direction, action)}-${i}`;
   }
   ```
   `defaultAvatarAnims(characters: string[])` genera las anims de todos los personajes del pack.
2. **Lista de personajes en el manifiesto** — `specs/26` §6 y esquema Zod:
   `avatars: { id: string; label: LocalizedText; portrait?: string }[]` (ids: `caballero-m`, `caballero-f`,
   `arquero-m`, `arquero-f`, `mago-m`, `mago-f`, `campesino-m`, `campesina-f`).
3. **`Avatar` recibe el personaje** — `src/phaser/avatar.ts`: constructor con `characterId`; todas las llamadas a
   `avatarAnimKey`/`avatarFrameName` lo usan.
4. **Protocolo** — `specs/11`: el jugador envía `characterId` al unirse (o al elegir en el lobby); el servidor lo
   valida contra `manifest.avatars` y lo difunde en el estado de la sesión para que los demás clientes pinten su
   avatar.
5. **Lobby** — `specs/19`: selector de personaje (retrato + nombre). Según la decisión de A1, bloquear o permitir
   repetidos.
6. **Empaquetado** — `scripts/build-pack.ts`: aceptar subcarpetas `avatar/<characterId>/` (o todos los frames
   juntos, ya prefijados) y validar que cada personaje de `manifest.avatars` tiene sus 80 frames.
**Motivo:** A1.

### B5. Sombra de contacto del avatar — `src/phaser/avatar.ts`
Elipse suave (p. ej. 40×14 px a 1×, negro al 25–35 %, borde difuminado) dibujada en una capa por debajo del
sprite, en el punto de apoyo (el mismo que el origen B1). Opcional: escalarla con la altura en saltos futuros.
**Motivo:** A5.

---

## Entrega del primer personaje
`entregas/avatares/caballero-m/` (en `assets-generator/packs/medieval-v1`):
- `2x/` y `1x/`: 80 PNG `avatar-caballero-m-<dir>-<acción>-<n>.png` (ya con el prefijo de B4).
- `pack.config.fragment.json`: `anims` y `avatarOrigin`.
- `preview_2x.png`, `LEEME.md`.
Para probarlo **antes** de B4 basta con quitar el prefijo `caballero-m-` de los nombres (avatar único actual).

---

## C. Iconos de inventario

Entrega: `entregas/iconos/` — `1x/` (64×64), `2x/` (128×128), `master/` (512×512), PNG transparentes, más
`preview.png`. Iconos: `icon-antorcha`, `icon-busto`, `icon-caliz`, `icon-espejo`, `icon-llave-bronce`,
`icon-llave-oro`, `icon-llave-plata`, `icon-pergamino`, `icon-vela`, `icon-yesquero` (+ `icon-mechero`, copia
temporal del yesquero; ver C2).

### C1. Criterio de estilo (→ `specs/26` §4.3)
- **Antes:** "formato cuadrado, ~64×64 a 1×, legible sobre panel oscuro".
- **Ahora:** además, **misma vista para todos**: 3/4 ligeramente desde arriba (~30°), alargados en diagonal,
  verticales de pie; cada objeto ocupa ~80 % del lienzo; toon 3D como los personajes, sin contorno ni sombra,
  luz arriba-izquierda; legibles sobre panel oscuro **y** claro. Entrega a 1× y 2×.
- **Motivo:** en el inventario los iconos se ven juntos; una vista común los hace parecer del mismo juego, y la
  vista 3/4 lee mejor los objetos verticales (cáliz, vela, busto) que la frontal pura.
- Llaves: misma forma en los tres metales (bronce/plata/oro), como ya admite §4.3.

### C2. "Mechero de pedernal" → "Yesquero"
- **Cambio:** el item `mechero` pasa a llamarse **Yesquero** (cajita de hierro con yesca, pedernal y eslabón).
- **Motivo:** un "mechero" no existe en la época del juego; el yesquero es el útil medieval equivalente y se
  reconoce en el icono.
- **Qué cambiar:**
  - `reference/roompackage-rey-aldric.v1.json`: item `"id": "mechero"` → `"yesquero"`, `"name"` →
    `{"es": {"text": "Yesquero"}}`, `"icon": "icon-mechero"` → `"icon-yesquero"`; y todas las referencias al id
    `mechero` en reglas, puzzles, `inventory` de objetos y combinaciones del mismo fixture.
  - `specs/26` §4.3 y `reference/pack-grafico-lista-assets.md`: `icon-mechero` → `icon-yesquero`.
  - Tests que usen el fixture (E2E del Rey Aldric) con el id `mechero`.
- Mientras no se cambie, `icon-mechero.png` es una copia del yesquero para que el pack siga validando.

### C3. `icon-busto` falta en la spec
- El fixture usa `icon-busto` (item `busto-piedra`), pero `specs/26` §4.3 y la lista de assets enumeran solo
  9 iconos sin él. Añadirlo a ambas (el icono ya está entregado).
