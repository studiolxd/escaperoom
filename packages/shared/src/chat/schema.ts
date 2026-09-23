import { z } from "zod";
import { CHAT_MAX_LENGTH } from "./constants";

/**
 * Contrato Zod del chat (specs/11 §4.4, §6; specs/17 §3).
 *
 * - `ChatPayloadSchema` es lo que el cliente envía al servidor (`chat {text}`).
 * - `ChatMessageSchema` es el mensaje ya validado y enriquecido por el servidor,
 *   tal y como viaja a todos los clientes en `state.chat` (autor, ts y flag de
 *   filtrado). Servidor y cliente comparten ambos esquemas.
 */

/** Payload cliente → servidor: texto plano, sin HTML y con tope de longitud. */
export const ChatPayloadSchema = z.object({
  text: z.string().min(1).max(CHAT_MAX_LENGTH),
});

/** Mensaje de chat autoritativo, tal y como se sincroniza en el room state. */
export const ChatMessageSchema = z.object({
  /** Identificador único del mensaje (generado por el servidor). */
  id: z.string().min(1),
  /** `sessionId` de Colyseus del autor. */
  authorId: z.string().min(1),
  /** Nombre visible del autor, asignado por el servidor (nunca por el cliente). */
  authorName: z.string().min(1),
  /** Texto final (ya desinfectado y, si tocaba, censurado). */
  text: z.string().min(1),
  /** Marca temporal de emisión, en milisegundos Unix. */
  ts: z.number().int().nonnegative(),
  /** `true` si el filtro de lenguaje detectó términos prohibidos. */
  filtered: z.boolean(),
});

export type ChatPayload = z.infer<typeof ChatPayloadSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
