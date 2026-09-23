import { z } from "zod";

// ---------------------------------------------------------------------------
// Fragmento de cliente — vars NEXT_PUBLIC_* que se empaquetan en el navegador.
// ---------------------------------------------------------------------------

export const baseClientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  // Servidor Colyseus del cliente (ticket 0.5); default ws://localhost:2567.
  NEXT_PUBLIC_COLYSEUS_URL: z.url().optional(),
  // WebSocket de edición del editor (ticket 3.3); default ws://localhost:2568.
  NEXT_PUBLIC_EDITOR_SYNC_URL: z.url().optional(),
});
