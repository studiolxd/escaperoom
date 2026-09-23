"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Sentinel del `SelectItem` "cualquiera" (Radix no admite `value=""`); el input oculto sí manda "" a la URL. */
const ANY = "__any__";

/**
 * Campo de un `Select` de shadcn que sigue enviándose como GET nativo: el
 * `Select` es solo presentación (controlado en estado local) y un
 * `<input type="hidden">` con el mismo `name` lleva el valor real al formulario
 * ("" cuando el usuario elige "cualquiera", igual que el `<select>` nativo).
 *
 * Vive en su propio archivo cliente para que `CatalogFilters` (servidor) no
 * arrastre este estado al árbol de renderizado en servidor: solo esta pieza,
 * mínima y sin dependencias del catálogo, necesita hidratarse.
 */
export function CatalogFilterSelect({
  id,
  name,
  label,
  anyLabel,
  initialValue,
  options,
}: {
  id: string;
  name: string;
  label: string;
  anyLabel: string;
  initialValue: string;
  options: { value: string; label: string }[];
}) {
  const [value, setValue] = useState(initialValue || ANY);

  return (
    <div className="flex flex-col gap-1 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <Input type="hidden" name={name} value={value === ANY ? "" : value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
