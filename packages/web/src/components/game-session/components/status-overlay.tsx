"use client";

import { Loader2 } from "lucide-react";
import { cn } from "cn";

/**
 * Contenedor centrado (horizontal y verticalmente) para las pantallas previas
 * a jugar (cargando el token, conectando, error, token ausente): ancla vía
 * `absolute inset-0` al ancestro más cercano con `position: relative` (el
 * `<main>` de la página o la `<section>` del juego), en vez de depender de
 * que el alto/ancho se propague correctamente por una cadena de flexbox —
 * eso es justo lo que fallaba antes (ver el bug de centrado del catálogo/
 * pantalla de "conectando", auditoría 2026-09-26).
 */
export function StatusOverlay({ children, className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("absolute inset-0 flex items-center justify-center text-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Spinner + mensaje centrado ("cargando…"/"conectando…"). */
export function LoadingStatus({ message }: { message: string }) {
  return (
    <StatusOverlay>
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm">{message}</p>
      </div>
    </StatusOverlay>
  );
}

/** Mensaje de error/alerta centrado, sin spinner. */
export function AlertStatus({ message }: { message: string }) {
  return (
    <StatusOverlay>
      <p role="alert" className="text-sm">
        {message}
      </p>
    </StatusOverlay>
  );
}
