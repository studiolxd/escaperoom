"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Ayuda contextual del editor (ticket 6.7, specs/20 §4): "el primer uso de
 * cada herramienta del editor muestra un tooltip corto"; "la ayuda no
 * bloquea la interacción; es informativa y se puede desactivar". No hay
 * ningún sistema de hints previo en `packages/shared` ni `packages/editor`
 * (solo el de pistas de puzzle, `shared/src/hints`, que es un dominio
 * distinto), así que este es deliberadamente mínimo: un globo que aparece la
 * primera vez que se ve cada herramienta, persistido en `localStorage`.
 */

const SEEN_KEY_PREFIX = "er.editorHint.seen.";
const DISABLED_KEY = "er.editorHint.disabled";

function hasSeen(id: string): boolean {
  try {
    return localStorage.getItem(SEEN_KEY_PREFIX + id) === "1";
  } catch {
    return true; // sin localStorage (SSR, modo privado): no molestar.
  }
}

function markSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY_PREFIX + id, "1");
  } catch {
    // best-effort.
  }
}

function isDisabled(): boolean {
  try {
    return localStorage.getItem(DISABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Desactiva la ayuda contextual del editor para este navegador. */
export function disableEditorHints(): void {
  try {
    localStorage.setItem(DISABLED_KEY, "1");
  } catch {
    // best-effort.
  }
}

export interface EditorToolHintProps {
  /** Id estable de la herramienta (`data-tool`, específs/09 §4.1). */
  id: string;
  text: string;
  children: ReactNode;
}

/**
 * Envuelve un control del editor (un botón de herramienta) y le añade un
 * globo de ayuda la primera vez que se muestra. No intercepta clics ni
 * pointer events: es puramente informativo (specs/20 §4).
 */
export function EditorToolHint({ id, text, children }: EditorToolHintProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isDisabled() || hasSeen(id)) return;
    setVisible(true);
  }, [id]);

  const dismiss = () => {
    markSeen(id);
    setVisible(false);
  };

  return (
    <span className="relative inline-flex">
      {children}
      {visible && (
        <span
          role="status"
          className="absolute left-1/2 top-full z-20 mt-1.5 w-44 -translate-x-1/2 rounded-lg border border-white/15 bg-slate-900 p-2 text-left text-[0.7rem] text-white shadow-lg"
        >
          {text}
          <button
            type="button"
            onClick={dismiss}
            className="mt-1 block text-[0.65rem] font-medium text-amber-300 underline"
          >
            OK
          </button>
        </span>
      )}
    </span>
  );
}
