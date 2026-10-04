import { useCallback, useEffect, useRef, type RefObject } from "react";

export interface UseArrowNavigationOptions {
  /** Contenedor de las opciones; solo se atienden teclas cuyo foco esté dentro. */
  containerRef: RefObject<HTMLElement | null>;
  /** Selector CSS (relativo al contenedor) de las opciones enfocables. */
  selector: string;
  /** Columnas de la rejilla visual; `1` = lista (arriba/abajo y izq./der. recorren por igual). */
  columns?: number;
  /** Da la vuelta al llegar al principio/final (solo con `columns` = 1). */
  wrap?: boolean;
  /** Pone el foco en la primera opción al montar (o al pasar `enabled` a `true`). */
  autoFocus?: boolean;
  enabled?: boolean;
}

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/**
 * Siguiente índice al pulsar una flecha. Pura para poder probarla sin DOM.
 * Con `columns > 1`, izquierda/derecha se quedan en su fila y arriba/abajo
 * saltan una fila; ningún movimiento da la vuelta. Con `columns = 1`, todas las
 * flechas recorren la lista y `wrap` la cierra en círculo.
 */
export function nextArrowIndex(
  key: string,
  index: number,
  count: number,
  columns: number,
  wrap: boolean,
): number {
  if (count === 0) return -1;
  if (columns <= 1) {
    const step = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
    const next = index + step;
    if (wrap) return (next + count) % count;
    return Math.min(count - 1, Math.max(0, next));
  }
  const row = Math.floor(index / columns);
  const col = index % columns;
  switch (key) {
    case "ArrowLeft":
      return col > 0 ? index - 1 : index;
    case "ArrowRight":
      return col < columns - 1 && index + 1 < count ? index + 1 : index;
    case "ArrowUp":
      return row > 0 ? index - columns : index;
    default:
      return index + columns < count ? index + columns : index;
  }
}

/**
 * Navegación con flechas entre las opciones de un contenedor (candado,
 * menú contextual, inventario). Espacio/Intro los resuelve el navegador sobre
 * el `Button` con foco; aquí solo se mueve el foco.
 *
 * El listener es de `document` (filtrado al contenedor) para no depender de
 * cuándo se monta un portal. Además corta la propagación de flechas y Espacio
 * hacia `window`, donde los runtimes 2D/3D hacen `preventDefault` de esas
 * teclas (Phaser las captura aunque el input esté desactivado), lo que
 * impediría que Espacio pulse el botón con foco.
 */
export function useArrowNavigation({
  containerRef,
  selector,
  columns = 1,
  wrap = false,
  autoFocus = false,
  enabled = true,
}: UseArrowNavigationOptions) {
  const optionsRef = useRef({ selector, columns, wrap });
  optionsRef.current = { selector, columns, wrap };

  const items = useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(optionsRef.current.selector));
  }, [containerRef]);

  const focusFirst = useCallback(() => {
    items()[0]?.focus();
  }, [items]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const container = containerRef.current;
      const target = event.target;
      if (!container || !(target instanceof Node) || !container.contains(target)) return;
      const isSpace = event.key === " " || event.code === "Space";
      if (isSpace) {
        event.stopPropagation();
        return;
      }
      if (event.type !== "keydown" || !NAV_KEYS.has(event.key)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const list = items();
      const current = list.findIndex((element) => element === target || element.contains(target));
      if (current === -1) return;
      event.preventDefault();
      event.stopPropagation();
      const { columns: cols, wrap: wraps } = optionsRef.current;
      list[nextArrowIndex(event.key, current, list.length, cols, wraps)]?.focus();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
    };
  }, [containerRef, enabled, items]);

  useEffect(() => {
    if (enabled && autoFocus) focusFirst();
  }, [enabled, autoFocus, focusFirst]);

  return { focusFirst };
}
