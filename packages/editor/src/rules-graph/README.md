# Grafo de reglas (ticket 3.6)

Vista de nodos `trigger → condiciones → acciones` sobre el mapa `rules` del doc Yjs de la sala
(`docs/specs/09-editor-de-salas.md` §2 y §4.2). El vocabulario es exactamente el del contrato
(`@escaperoom/shared/schemas`, specs/05 §3): este módulo no añade tipos.

| Fichero           | Qué hace                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `vocabulary.ts`   | Listas de tipos (comprobadas en compilación contra las uniones Zod), campos por tipo y valores por defecto.                         |
| `yjs-rules.ts`    | Modelo Yjs: `readRules`/`writeRules`/`observeRules` y operaciones (`createRule`, `renameRule`, `insertCondition`, `updateAction`…). |
| `graph-model.ts`  | Mapeo puro reglas ⇄ grafo (`rulesToGraph`/`graphToRules`) y `applyIssues` (estilos por nodo).                                       |
| `graph-ops.ts`    | Conectar borradores (`connectDraft`), borrar y desconectar (`applyGraphDeletion`).                                                  |
| `rules-graph.tsx` | Componente `<RulesGraph>` (React Flow).                                                                                             |
| `labels.ts`       | Tipo del diccionario de textos.                                                                                                     |

## Modelo en el doc Yjs

```
doc.getMap("rules"): Y.Map<ruleId, Y.Map>
  id, priority, once, order   (order = orden de creación, desempate del motor; no se exporta)
  trigger                     JSON, se sustituye entero
  conditions                  Y.Array<RuleCondition>
  actions                     Y.Array<RuleAction>  (un delay guarda sus hijas en JSON)
```

El componente solo lee del doc (`useYjsRules`) y escribe con las operaciones de `yjs-rules.ts`:
cualquier otro colaborador (otra pestaña, el MCP) que mute el mapa se ve sin lógica extra.

## Grafo

- Condiciones en cadena desde el trigger; la última (o el trigger) abre en abanico a las acciones;
  un `delay` es origen de sus acciones anidadas. Ids de nodo: `<ruleId>/trigger`,
  `<ruleId>/c/<i>`, `<ruleId>/a/<i>.<j>`.
- Maquetación automática (una banda por regla). Mover un nodo solo cambia la vista local: las
  posiciones no se guardan en el doc (el RoomPackage no tiene dónde).
- **Borradores:** «Nueva condición/acción» crea un nodo suelto local; al conectarlo desde un trigger,
  condición o `delay` pasa a la regla. Borrar una arista desconecta la pieza y la devuelve como
  borrador. Borrar un trigger borra la regla.

## Textos (i18n)

`packages/editor` no depende de next-intl. `<RulesGraph labels={…}>` recibe un
`RulesGraphLabelsInput` (`kinds`, `triggers`, `conditions`, `actions`, `fields`, `ui`); lo que
falte cae al identificador técnico. En `packages/web` sale del namespace `RulesGraph.labels` de los
seis catálogos:

```tsx
const t = useTranslations("RulesGraph");
<RulesGraph doc={doc} labels={t.raw("labels") as RulesGraphLabelsInput} />;
```

La app debe cargar `@xyflow/react/dist/style.css`.

## Hook del validador (3.7)

`issues: RuleGraphIssue[]` (`{ id, severity: "error" | "warning" | "info", message? }`). `id` es
un id de nodo o de regla (marca su trigger). El nodo recibe `data.severity`, la clase
`rules-graph-node--<severidad>`, borde del color de la severidad y los mensajes como `title`.

## Enlace con el inspector (3.4)

`focusRuleId` selecciona los nodos de esa regla y centra la vista en ellos cada vez que cambia
(«Ver en el grafo» del inspector); `onSelectRule(ruleId)` avisa de un clic en un nodo para que el
inspector muestre la regla.

Demo en desarrollo: `/<locale>/dev/rules-graph`.
