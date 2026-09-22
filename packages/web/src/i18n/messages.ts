export type Messages = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fusiona `override` sobre `base` de forma recursiva y sin mutar ninguno de los
 * dos: las claves del idioma activo ganan y las ausentes caen al catálogo base
 * (`es`). Es el fallback de mensajes de next-intl descrito en ADR-018.
 */
export function deepMergeMessages(base: Messages, override: Messages): Messages {
  const merged: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? deepMergeMessages(baseValue, value)
        : value;
  }
  return merged;
}
