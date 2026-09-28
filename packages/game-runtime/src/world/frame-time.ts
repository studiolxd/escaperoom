/**
 * Tiempo real de un frame para mover avatares (revisión en vivo, smoke E2E
 * de la PR #187).
 *
 * El `delta` que Phaser pasa a `Scene.update` NO es tiempo real: su
 * `TimeStep` lo suaviza y, durante un "enfriamiento" de `fps.panicMax`
 * frames (120 por defecto) tras arrancar el bucle y tras cada `focus` o
 * `visibilitychange` de la ventana, lo recorta a 16,7 ms (lo mismo mientras
 * la ventana no tiene el foco); por debajo de `fps.min` (5 fps) usa además el
 * último valor "sano" en vez del real. A 60 fps da igual, pero a pocos fps
 * (equipo modesto, render por software, escena pesada) el avatar andaba a
 * una fracción de su velocidad: a 8 fps, 120 frames recortados son ~15 s
 * andando a ~1/9 de la velocidad — un clic sobre un objeto al otro lado de
 * la sala tardaba medio minuto en abrir su menú.
 *
 * El movimiento usa en su lugar el tiempo real (`game.loop.rawDelta`),
 * troceado en subpasos para que un frame largo no haga saltar al avatar más
 * de una fracción de celda de una vez (la colisión solo mira la celda de
 * destino de cada paso, `AvatarController.tryMove`).
 */

/**
 * Tope de tiempo real que se aplica en un solo frame. Por encima (pestaña
 * que vuelve tras dormir, parón largo del hilo principal) se asume una pausa
 * y no se "recupera" todo el tiempo perdido de golpe.
 */
export const MAX_FRAME_ELAPSED_MS = 1000;

/**
 * Subpaso máximo: a la velocidad por defecto del avatar (4 celdas/s) son 0,2
 * celdas por paso, muy por debajo de una celda (no puede atravesar un muro).
 */
export const MOVE_SUBSTEP_MS = 50;

/**
 * Trocea el tiempo real transcurrido en un frame (`elapsedMs`, acotado a
 * [0, {@link MAX_FRAME_ELAPSED_MS}]) en subpasos de como mucho
 * {@link MOVE_SUBSTEP_MS} que suman exactamente ese tiempo. Sin tiempo (o
 * valor no finito) devuelve `[]`.
 */
export function movementSubsteps(elapsedMs: number): number[] {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return [];
  }
  let remaining = Math.min(elapsedMs, MAX_FRAME_ELAPSED_MS);
  const steps: number[] = [];
  while (remaining > 0) {
    const step = Math.min(remaining, MOVE_SUBSTEP_MS);
    steps.push(step);
    remaining -= step;
  }
  return steps;
}
