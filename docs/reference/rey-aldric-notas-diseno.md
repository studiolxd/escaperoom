# Notas de diseño — "La Maldición del Rey Aldric" v1.0.0

Acompaña a `reference/roompackage-rey-aldric.v1.json` y a `specs/08-formato-roompackage.md`.

## Propósito

1. **Validar el formato RoomPackage:** demostrar que el JSON expresa de punta a punta una sala real
   de 3 habitaciones con las 8 plantillas del MVP.
2. **Fixture de pruebas permanente:** es la suite de regresión del runtime (test E2E: cargar y
   completar el Rey Aldric).
3. **Plantilla de referencia** para el MCP, el onboarding y los creadores ("desmóntala y mira cómo
   está hecha").
4. **Ejercicio de validación del validador:** incluye el informe esperado.

## Convenciones del paquete

- Grid por habitación, origen `(0,0)` arriba-izquierda. Cada habitación es un mapa propio; las
  puertas enlazan mapas.
- Capas de tilemap en **RLE** (`[cantidad, tileId, ...]`, recorrido fila a fila). `0` = celda vacía.
- Tiles de ejemplo: `1` piedra, `2` loseta, `3` alfombra, `10` muro, `11` muro+antorcha,
  `12` muro+tapiz, `20` puerta madera, `21` reja, `22` arco abierto.
- Los estados de objeto son strings arbitrarios declarados en `states`.
- Las posiciones de objeto son en celdas de grid (el runtime las proyecta a isométrico).
- Textos e items usan `LocalizedText` (multidioma) y `packageFormat: "roompackage/v1"`.

## Notas de diseño finas

1. **Los dígitos del candado del arca (`4732`):** 4 torres (retrato de Aurelio), 7 dragones
   (tapiz), 3 brasas (brasero, **solo visible al encenderlo** → la receta `yesquero+vela→antorcha`
   es obligatoria), 2 estatuas. El orden lo dan los retratos de izquierda a derecha.

2. **El sello final (`4538`):** requiere `p-canal-agua` resuelto (`requiresSolved`) **y** el altar
   en estado `flowing` (condición de `r-sello-resuelto`) — doble candado narrativo: agua + código.
   Los dígitos se descubren en 3 salas distintas (4 en el Salón, 5 en el mural, 3 en las copas, 8 en
   las vasijas), forzando el recorrido completo.

3. **La llave dentro de la llave:** la receta de inspección (`llave-plata → llave-oro`,
   `consumeInputs: false`) usa `combine_items` sin consumir — patrón reutilizable para "examinar".

4. **El cáliz y el busto de piedra son dos objetos distintos** (2.11). Hasta 2.10 el objeto-puente
   de `p-placas-estatuas` (placa-puente en solitario) era el mismo cáliz que luego iba a la ranura
   del mural, con la regla `r-recoger-caliz` devolviéndolo tras las placas para evitar un soft-lock
   — patrón que solo funcionaba porque el puente **no se consumía**. En 2.11 se decidió que los
   objetos-puente vuelven a comportarse como cualquier objeto de un escape room: **se gastan al
   fijarse** (desaparecen del inventario), como es habitual en el género. Reutilizar el mismo cáliz
   para dos interacciones habría dejado la ruta en solitario irresoluble (el cáliz se gastaría en la
   placa y ya no estaría disponible para la ranura), así que en vez de eso el arca (`p-candado-arca`,
   candado `4732`) ahora otorga **dos objetos**: `caliz-real` (va a la ranura del mural, sin cambios)
   y `busto-piedra` (el nuevo `soloBridgeItemId` de `p-placas-estatuas`, temáticamente coherente con
   el nombre del puzzle — "placas de las estatuas"). `r-recoger-caliz` se mantiene por compatibilidad
   narrativa (permite volver a sacar el cáliz de la ranura) pero ya no es necesaria para la
   resolubilidad: el cáliz nunca se usa como puente. Ver también
   `docs/reference/registro-de-decisiones.md` (2.11) para la decisión completa (dos objetos vs.
   "gastar en el último uso").

5. **La compuerta de oro** (`compuerta-oro`, `opensWithItem: llave-oro`) está en `blockedCells` del
   puzzle de tuberías: la llave-oro (de la llave-plata, del compartimento del mural, que necesita el
   cáliz del arca…) encadena Salón → Bodega → Catacumbas en orden estricto. El `grantsItems` de
   `p-mural-vendimia` incluye `llave-plata` para que el grafo de dependencias sea explícito aunque
   el objeto viva en un compartimento.

6. **`scramble: fixed_seed` (seed 812):** en eventos, todos los grupos reciben el mismo mural
   desordenado — justicia competitiva en ranking por tiempo.

7. **Antorchas de la escalera:** la narrativa original las ligaba al puzzle de memoria; en el
   paquete las luces de `bodega.lighting` quedan asociadas al estado `active` de `mesa-catas`
   (iluminación reactiva a puzzles — feature del runtime, no del formato).

## Informe de validación esperado

```
✅ Sin objetos huérfanos: todo item otorgado es alcanzable por una regla o puzzle
✅ Sin dead ends: toda puerta se desbloquea (puerta-bodega ← placas; reja ← mirillas)
✅ Solvabilidad: ruta crítica verificada (ver secuencia abajo)
🟡 El candado del arca tiene pistas asociadas (OK) — el sello final depende de 3 dígitos
   descubiertos sin pista directa; cubierto por hint-sello-1/2 (OK)
✅ Sin reglas sin condiciones de corte (r-recoger-caliz es repeatable con guarda doble; las
   reglas de inspección repetibles — r-imagen-cuadro, r-inspeccionar-retrato-2/3/4,
   r-inspeccionar-tapiz-dragones, r-imagen-vasijas — son solo de presentación
   (show_dialog/show_image, sin mutar estado), así que el heurístico no las cuenta: repetirlas
   sin condición de corte es el diseño buscado, no un riesgo. El `set_flag digito4` de
   r-inspeccionar-vasijas vive en una regla aparte, `once: true`)
🟡 Dificultad 2 coherente con estimatedMinutes 55
```

### Secuencia de solución verificada (ruta crítica)

```
1. Inspeccionar cuadro-aurelio          → llave-bronce
2. Abrir armario (llave-bronce)         → yesquero + vela
3. Combinar yesquero+vela                → antorcha
4. Encender brasero (antorcha)          → dígito 3 visible
5. Resolver candado-arca "4732"         → cáliz + busto de piedra + pergamino
6. [Solo: busto en placa-izq, se gasta] / [Grupo: placas simultáneas] → puerta-bodega
7. Resolver mural-vendimia (3×3)        → compartimento → llave-plata
8. Inspeccionar llave-plata             → llave-oro
9. Colocar cáliz en ranura (lore) / recuperarlo
10. Resolver copas-memoria (3 pares)    → dígito 3 + antorchas escalera
11. Mirillas (cooperativo / espejo)     → reja-escalera
12. Canal de tuberías (con llave-oro)   → altar flowing
13. Inspeccionar vasijas + sarcófago    → dígitos 8 y recuerdo del código
14. Sello final "4538"                  → relicario → VICTORIA
```

**Estimación:** ~45–55 min para grupo de 3–4 sin pistas; ~70 con 2 jugadores novatos.

## Uso como fixture

```typescript
// packages/game-runtime/__tests__/e2e.reyaldric.spec.ts
// Escenario: cargar roompackage-rey-aldric.json, simular la secuencia de
// solución con 2 clientes de Colyseus y assert: end_game result=victory,
// 14 reglas fired exactamente una vez (excepto r-recoger-caliz),
// p-sello-final resuelto con attempts=1 y timeRemaining > 0.
```

Este paquete se versiona junto al runtime: cualquier cambio del formato RoomPackage que rompa este
JSON es un **cambio breaking** y exige bump de `meta.packageFormat`.
