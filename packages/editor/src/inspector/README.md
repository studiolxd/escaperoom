# Inspector de propiedades (ticket 3.4)

Panel contextual del elemento seleccionado —objeto, puzzle o regla— sobre el doc Yjs de la sala
(`docs/specs/09-editor-de-salas.md` §3 y §4.1). Es **genérico y dirigido por el tipo**: el
formulario se genera del esquema Zod del elemento (`@escaperoom/shared/schemas`), no hay un
componente por tipo.

| Fichero                | Qué hace                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `schema-form.ts`       | Generador: esquema Zod → árbol `FormField`; registro de tipos de campo (`FieldKindDefinition`), por defecto. |
| `schema-form-view.tsx` | `<SchemaForm>`: pinta el árbol con un renderer por `kind` (sustituibles/ampliables por el host).             |
| `references.ts`        | Mapa semántico de referencias entre ids (qué campo apunta a qué tipo) y «reglas que lo tocan».               |
| `rename.ts`            | `renameElement`: renombra un objeto/puzzle/regla y reescribe sus referencias en **una** transacción Yjs.     |
| `inspector-model.ts`   | Esquema de cada elemento (`describeTarget`), lectura (`inspectElement`) y escritura (`setElementProperty`).  |
| `inspector.tsx`        | `<Inspector>`: cabecera con renombrado, formulario, reglas que lo tocan, referencias y textos ligados.       |
| `labels.ts`            | Diccionario de textos (sin next-intl; en web sale de `Inspector.labels`).                                    |

La parte headless (sin React) se importa desde `@escaperoom/editor/inspector` (servidor, MCP).

## Qué se edita

- **Objeto** (`WorldObjectSchema`): habitación, tipo (libre, con sugerencias de specs/04 §3.1),
  celda, sprite, estados (record `estado → sprite | {sprite, animation}`), estado inicial (elige
  entre los estados), inventario, `lockedBy`/`leadsTo` de puertas, `interactable`, reparto,
  escondite. Celda y habitación pasan por `moveObject` (3.1), que comprueba los límites.
- **Puzzle**: solo los campos comunes a las 8 plantillas (`PUZZLE_BASE_KEYS`, derivados del
  esquema). La configuración propia de la plantilla va en el slot `renderPuzzleConfigurator`
  (ver «Configuradores de plantillas» abajo).
- **Regla**: prioridad, `once` y el trigger (unión discriminada → selector de tipo + campos de la
  variante). Condiciones y acciones se editan en el grafo (3.6); `onOpenRule` lo enlaza.
- **Textos ligados** (`LocalizedText`): diálogos que muestra al interactuar, ítems que contiene o
  da, pistas del puzzle. Se pintan con el slot `renderLocalizedText` (en web, los campos de 3.10 y el
  audio por idioma de 3.11); sin slot, un campo mínimo por idioma.

Cada propiedad se escribe entera (`setElementProperty(doc, target, key, value)`) sobre la forma de
3.1 (una clave por propiedad en `objects`/`puzzles`; `updateRule` en `rules`): **no cambia la
forma del doc ni el RoomPackage**. Los textos e ids se confirman al salir del campo o con Intro (no
una transacción por tecla).

## Tipos de campo

Incluidos: `text`, `number`, `boolean`, `enum`, `literal`, `object`, `list`, `record`, `union`,
`localizedText` y `json` (último recurso). Un tipo nuevo se registra sin tocar el generador:

```ts
const color: FieldKindDefinition = {
  kind: "color",
  match: (s) => s instanceof z.ZodString && s.meta()?.format === "color",
  defaultValue: () => "#000000",
};
<Inspector fieldKinds={[color]} renderers={{ color: ColorInput }} … />
```

Las pistas por ruta (`hints` de `describeSchema`) añaden lo que el esquema no dice: `ref` (el campo
es un id de objeto/puzzle/ítem/habitación/estado y se elige de los existentes), sugerencias, solo
lectura u ocultar.

## Renombrar

`renameElement(doc, { kind, id }, newId)` valida el id (`a-z0-9-`, libre en toda la sala) y, en una
transacción, reescribe **solo** los campos del mapa de `references.ts` (objetos, puzzles —también
los campos propios de cada plantilla y las claves de `visibleByViewpoint`—, reglas con `delay`
anidado, condiciones de diálogos, pistas y luces). Un texto igual al id que no es referencia (el
sprite `trono` del objeto `trono`) no se toca. Las reglas no se referencian por id: renombrarlas es
`renameRule` (3.6).

## Configuradores de plantillas (ticket 3.5)

`../template-config/` (headless, `@escaperoom/editor/template-config`) y
`packages/web/src/components/template-config/` (React, montado en `renderPuzzleConfigurator`):

- `templateConfigKeys` / `describeTemplateConfig`: campos propios de cada plantilla (los de su
  variante que no están en `PUZZLE_BASE_KEYS`), como formulario del mismo generador, con las
  referencias de `PUZZLE_TYPE_REFS`.
- `setTemplateConfig`: escribe un campo en el doc Yjs (misma forma que `setElementProperty`).
- `checkTemplateConfig`: esquema + oráculo de la plantilla (`isTemplateSolvable` del validador)
  para el aviso inmediato; el resto de la sala lo juzga el validador (3.7).
- `createTemplatePreview` / `applyTemplatePreview`: vista previa jugable en local con las
  transiciones puras de `@escaperoom/shared/templates`; en web se pintan con **los mismos paneles
  de juego** (`CodeLockPanel`, `MemoryPanel`…) sin tocarlos.
