"use client";

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { GameSessionCanvasHandle } from "../game-session-canvas";

const BASE_PX = 112;
const THUMB_PX = 48;
/** Recorrido máximo del pulgar desde el centro de la base. */
const TRAVEL_PX = (BASE_PX - THUMB_PX) / 2;
const DEAD_ZONE = 0.15;

/** Vector normalizado (módulo ≤ 1, `y` positivo = arriba) de un desplazamiento en píxeles. */
export function joystickVector(dxPx: number, dyPx: number): { x: number; y: number } {
  const x = dxPx / TRAVEL_PX;
  const y = -dyPx / TRAVEL_PX;
  const magnitude = Math.hypot(x, y);
  if (magnitude < DEAD_ZONE) return { x: 0, y: 0 };
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  return { x: x * scale, y: y * scale };
}

function isCoarsePointer(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/**
 * Controles de la partida 3D sobre el canvas: en táctil, joystick (abajo a la izquierda) y botón
 * «Interactuar» (abajo a la derecha, solo con un objeto resaltado); en escritorio no pinta nada
 * (se interactúa con Espacio). `active` = `worldInputEnabled`.
 */
export function TouchControls({
  handleRef,
  ready,
  active,
  objectName,
}: {
  handleRef: RefObject<GameSessionCanvasHandle | null>;
  /** `true` cuando el `handleRef` ya apunta al canvas (se suscribe entonces al resalte). */
  ready: boolean;
  active: boolean;
  objectName: (objectId: string) => string;
}) {
  const t = useTranslations("Game");
  const [coarse, setCoarse] = useState(false);
  const [highlighted, setHighlighted] = useState<string | undefined>(undefined);

  useEffect(() => setCoarse(isCoarsePointer()), []);

  useEffect(() => {
    if (!ready) return;
    return handleRef.current?.onHighlightChange?.(setHighlighted);
  }, [handleRef, ready]);

  useEffect(() => {
    // Al perder el control del mundo (diálogo, panel…), suelta el joystick y el resalte.
    if (!active) {
      handleRef.current?.setMoveVector?.(null);
      setHighlighted(undefined);
    }
  }, [active, handleRef]);

  if (!active) return null;
  const name = highlighted ? objectName(highlighted) : undefined;

  if (!coarse) return null;

  return (
    <>
      <Joystick onMove={(v) => handleRef.current?.setMoveVector?.(v)} />
      {name ? (
        <Button
          size="lg"
          className="absolute bottom-6 right-6 z-20 size-20 rounded-full"
          aria-label={t("touch.interactWith", { object: name })}
          data-testid="touch-interact"
          onClick={() => handleRef.current?.interactHighlighted?.()}
        >
          {t("touch.interact")}
        </Button>
      ) : null}
    </>
  );
}

function Joystick({ onMove }: { onMove: (vector: { x: number; y: number } | null) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });

  const update = (event: PointerEvent<HTMLDivElement>) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const magnitude = Math.hypot(dx, dy);
    const clamp = magnitude > TRAVEL_PX ? TRAVEL_PX / magnitude : 1;
    setThumb({ x: dx * clamp, y: dy * clamp });
    const vector = joystickVector(dx, dy);
    onMove(vector.x === 0 && vector.y === 0 ? null : vector);
  };

  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    setThumb({ x: 0, y: 0 });
    onMove(null);
  };

  return (
    <div
      ref={baseRef}
      data-testid="touch-joystick"
      className="absolute bottom-6 left-6 z-20 touch-none select-none rounded-full border border-border bg-card/60 backdrop-blur"
      style={{ width: BASE_PX, height: BASE_PX, touchAction: "none" }}
      onPointerDown={(event) => {
        if (pointerRef.current !== null) return;
        pointerRef.current = event.pointerId;
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // Sin captura el arrastre sigue funcionando mientras el puntero esté sobre la base.
        }
        update(event);
      }}
      onPointerMove={(event) => {
        if (pointerRef.current === event.pointerId) update(event);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div
        aria-hidden
        className="absolute rounded-full bg-primary/80 shadow"
        style={{
          width: THUMB_PX,
          height: THUMB_PX,
          left: (BASE_PX - THUMB_PX) / 2 + thumb.x,
          top: (BASE_PX - THUMB_PX) / 2 + thumb.y,
        }}
      />
    </div>
  );
}
