"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";

/**
 * Icono de un item del inventario (specs/04 §8-UI, ticket 1.14).
 *
 * Usa el **frame real** del pack (`ItemDef.icon`, p. ej. `icon-llave-bronce`):
 * el pipeline de 1.2 deja cada frame como fichero `icons/<frame>.svg|.png`
 * dentro del pack, así que se prueban esas rutas en orden. Si el pack no está,
 * el frame no existe o la imagen falla, cae a un **monograma de texto** (la
 * inicial del nombre) — nunca rompe la UI.
 */
export interface ItemIconProps {
  /** Frame del pack (`ItemDef.icon`). */
  frame?: string;
  /** URL base del pack (sin barra final). */
  baseUrl?: string;
  /** Nombre del item; alimenta el fallback y el `title`. */
  name: string;
  /** Tamaño en píxeles del cuadro del icono (por defecto 28). */
  size?: number;
  className?: string;
}

/** Rutas candidatas del frame dentro del pack (SVG primero, PNG después). */
export function itemIconUrls(frame: string | undefined, baseUrl: string | undefined): string[] {
  if (!frame || !baseUrl) {
    return [];
  }
  const base = baseUrl.replace(/\/$/, "");
  return [`${base}/icons/${frame}.svg`, `${base}/icons/${frame}.png`];
}

export function ItemIcon({ frame, baseUrl, name, size = 28, className }: ItemIconProps) {
  const candidates = itemIconUrls(frame, baseUrl);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    setStage(0);
  }, [frame, baseUrl]);

  const src = candidates[stage];
  if (!src) {
    return (
      <span
        aria-hidden
        data-icon-fallback="true"
        title={name}
        className={cn(
          "grid shrink-0 place-items-center rounded-md bg-amber-200/15 font-semibold text-amber-100",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      title={name}
      onError={() => setStage((current) => current + 1)}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
