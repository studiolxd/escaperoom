/**
 * Formato de duración para la pantalla de resultados (ticket 1.9). Puro y
 * testeable fuera del DOM: `mm:ss` o `h:mm:ss` cuando la partida pasa de una
 * hora (el Rey Aldric usa 3600 s).
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(rest).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
