# Validador en el editor (ticket 3.7)

Validación continua del doc Yjs de la sala (`docs/specs/09-editor-de-salas.md` §5,
`docs/specs/22-qa-y-pruebas.md` §2) con el mismo validador puro que `POST /validate` y
`publish()` (`@escaperoom/shared/validator`).

```
cambio en el doc (local o remoto) ─debounce─▶ doc → RoomPackage ─▶ validateRoomPackage
                                                   │ (Zod)               │
                                          conversionErrors        informe → hallazgos → issues por id
```

| Fichero                  | Qué hace                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `serializer.ts`          | `RoomPackageSerializer` inyectable, `docToRoomPackage` (valida con Zod, nunca lanza) y el adaptador provisional `createRulesOverlaySerializer`. |
| `findings.ts`            | Informe → `ValidationFinding[]` (por issue) → `EditorIssue[]` (por id, con `kind`) → `RuleGraphIssue[]`.                                        |
| `controller.ts`          | `createRoomValidator`: escucha `doc.on("update")`, debounce (400 ms), estado y suscriptores.                                                    |
| `use-room-validation.ts` | Hook React sobre el controlador (`useSyncExternalStore`).                                                                                       |
| `validation-panel.tsx`   | `<ValidationPanel>`: errores ❌, avisos 🟡, estimación de duración y ruta crítica.                                                              |
| `labels.ts`              | Diccionario de textos del panel (`{marcadores}`), sin next-intl.                                                                                |
| `core.ts`                | Parte sin React, exportada como `@escaperoom/editor/validation` (la usa el endpoint de web).                                                    |

## Uso

```tsx
const validation = useRoomValidation(doc, serialize, { validateOptions: { assetManifest } });
<RulesGraph doc={doc} issues={validation.ruleGraphIssues} />
<ValidationPanel state={validation} labels={t.raw("labels")} onSelectTarget={select} />
// validation.issues: { id, kind: "rule" | "puzzle" | "object" | "item" | …, severity, message }[]
```

`kind` sale de resolver cada id del informe contra el paquete (reglas, puzzles, objetos, items,
habitaciones, pistas, diálogos; `unknown` si el id no existe, p. ej. una referencia rota).

## Serialización doc → RoomPackage

Es de 3.1 (`roomDocToPackage`, `@escaperoom/editor/room-doc`). Aquí se inyecta
(`RoomPackageSerializer = (doc) => unknown`) y el resultado siempre pasa por el esquema Zod: un doc a
medio editar da `status: "invalid"` con `conversionErrors` en vez de romper. La página del editor y
`POST /validate` usan `roomDocToPackage`; `createRulesOverlaySerializer(base)` (reglas del doc sobre
un paquete base) queda para los tests y la demo.

## Textos (i18n)

En `packages/web` salen del namespace `ValidationPanel.labels` de los seis catálogos. Los mensajes
de cada hallazgo son los del validador (en español, los mismos que ven el MCP y `POST /validate`);
el panel traduce su contexto (título del check, tipo de elemento, estados y estimación).

Demo en desarrollo: `/<locale>/dev/validation`.
