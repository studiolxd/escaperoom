/**
 * Inspector de propiedades (ticket 3.4, specs/09 §4.1): panel contextual del
 * objeto, puzzle o regla seleccionado, generado desde el esquema del elemento.
 */
export * from "./core";
export {
  BUILTIN_RENDERERS,
  CommitInput,
  SchemaForm,
  type FieldRenderer,
  type FieldRendererProps,
  type SchemaFormContext,
  type SchemaFormProps,
} from "./schema-form-view";
export {
  Inspector,
  type InspectorProps,
  type LinkedTextSlotProps,
  type PuzzleConfiguratorSlotProps,
} from "./inspector";
