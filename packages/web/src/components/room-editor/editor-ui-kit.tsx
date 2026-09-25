"use client";

import type { EditorUiKit, UiButtonProps, UiCheckboxProps, UiSelectProps } from "@escaperoom/editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Controles shadcn/ui inyectados en `packages/editor` (auditoría F-6, ADR-019):
 * el editor no depende de `packages/web`, así que pinta con `DEFAULT_UI_KIT`
 * (elemento nativo) y aquí se le pasan estos vía la prop `components` de
 * `<Inspector>`, `<RulesGraph>` y `<ValidationPanel>`.
 */

function KitButton({ variant, size, ...rest }: UiButtonProps) {
  return <Button type="button" variant={variant} size={size} {...rest} />;
}

// Radix `Select.Item` no admite `value=""`: el placeholder/«ninguno» usa este centinela.
const NONE_VALUE = "__editor-ui-kit-none__";

function KitSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  id,
  className,
  style,
  ...rest
}: UiSelectProps) {
  // `SelectValue` solo puede leer la etiqueta del `SelectItem` seleccionado
  // una vez que `SelectContent` se ha montado (el desplegable se ha abierto
  // alguna vez): en el HTML servido no lo ha hecho, así que se le da la
  // etiqueta ya resuelta para que el valor se vea también sin hidratar.
  const currentLabel =
    value === "" ? placeholder : options.find((option) => option.value === value)?.label;
  return (
    <Select
      value={value === "" ? NONE_VALUE : value}
      disabled={disabled}
      onValueChange={(next) => onValueChange(next === NONE_VALUE ? "" : next)}
    >
      <SelectTrigger id={id} size="sm" className={className} style={style} {...rest}>
        <SelectValue placeholder={placeholder}>{currentLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {placeholder !== undefined ? (
          <SelectItem value={NONE_VALUE}>{placeholder}</SelectItem>
        ) : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function KitCheckbox({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  style,
  ...rest
}: UiCheckboxProps) {
  return (
    <Checkbox
      id={id}
      className={className}
      style={style}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      {...rest}
    />
  );
}

export const EDITOR_UI_KIT: Partial<EditorUiKit> = {
  Button: KitButton,
  Input,
  Textarea,
  Select: KitSelect,
  Checkbox: KitCheckbox,
};
