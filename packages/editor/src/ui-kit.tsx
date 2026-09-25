"use client";

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

/**
 * Punto de extensión de controles interactivos (auditoría F-6): `packages/editor`
 * no depende de los componentes shadcn/ui de `packages/web` (ADR-019), así que
 * pinta con estos controles mínimos por defecto (elemento nativo) y el host
 * puede sustituirlos por los suyos vía la prop `components`/`uiKit` de
 * `<Inspector>`, `<RulesGraph>` y `<ValidationPanel>`. `packages/web` inyecta
 * ahí sus componentes shadcn.
 */

export type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "outline" | "destructive";
  size?: "sm" | "icon" | "default";
};

export type UiInputProps = InputHTMLAttributes<HTMLInputElement>;

export type UiTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export type UiSelectOption = { value: string; label: ReactNode };

export type UiSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly UiSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};

export type UiCheckboxProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};

export type EditorUiKit = {
  Button: (props: UiButtonProps) => ReactNode;
  Input: (props: UiInputProps) => ReactNode;
  Textarea: (props: UiTextareaProps) => ReactNode;
  Select: (props: UiSelectProps) => ReactNode;
  Checkbox: (props: UiCheckboxProps) => ReactNode;
};

function NativeButton({ variant, size, ...rest }: UiButtonProps) {
  void variant;
  void size;
  return <button type="button" {...rest} />;
}

function NativeInput(props: UiInputProps) {
  return <input {...props} />;
}

function NativeTextarea(props: UiTextareaProps) {
  return <textarea {...props} />;
}

function NativeSelect({
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
  return (
    <select
      id={id}
      className={className}
      style={style}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
      {...rest}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function NativeCheckbox({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  style,
  ...rest
}: UiCheckboxProps) {
  return (
    <input
      type="checkbox"
      id={id}
      className={className}
      style={style}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...rest}
    />
  );
}

/** Controles nativos mínimos: los usan los tests de `packages/editor` sin `web`. */
export const DEFAULT_UI_KIT: EditorUiKit = {
  Button: NativeButton,
  Input: NativeInput,
  Textarea: NativeTextarea,
  Select: NativeSelect,
  Checkbox: NativeCheckbox,
};

export function resolveUiKit(components?: Partial<EditorUiKit>): EditorUiKit {
  return { ...DEFAULT_UI_KIT, ...components };
}
