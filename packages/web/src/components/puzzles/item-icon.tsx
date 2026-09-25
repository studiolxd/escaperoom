"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "cn";

/**
 * Icono de un item del inventario (specs/04 §8-UI, ticket 1.14).
 *
 * Usa el **frame real** del pack (`ItemDef.icon`, p. ej. `icon-llave-bronce`):
 * el pipeline de 1.2 deja cada frame como fichero `icons/<frame>.png|.svg`
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

/**
 * Rutas candidatas del frame dentro del pack: PNG primero (formato real de
 * entrega de `icons/`, specs/26 §4.3), SVG como variante posible de un pack
 * distinto. Antes se pedía el SVG primero, así que todo icono PNG disparaba
 * un 404 de más antes de caer al PNG real.
 */
export function itemIconUrls(frame: string | undefined, baseUrl: string | undefined): string[] {
  if (!frame || !baseUrl) {
    return [];
  }
  const base = baseUrl.replace(/\/$/, "");
  return [`${base}/icons/${frame}.png`, `${base}/icons/${frame}.svg`];
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
          "icon-fallback-size grid shrink-0 place-items-center rounded-md bg-amber-200/15 font-semibold text-amber-100",
          className,
        )}
        style={
          {
            "--icon-size": `${size}px`,
            "--icon-font-size": `${Math.max(10, Math.round(size * 0.42))}px`,
          } as CSSProperties
        }
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={src}
      // El pack entrega un único PNG por frame a escala de entrega ×2
      // (specs/26 §3.2/§9.1, 128×128 para un icono lógico de 64×64): ya es un
      // asset "2x" por construcción, así que declararlo como tal evita que un
      // navegador con más densidad de píxeles lo pida más grande (no hay un
      // segundo archivo "1x" que pedir) y se ve nítido en pantallas retina.
      srcSet={`${src} 2x`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      title={name}
      onError={() => setStage((current) => current + 1)}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
