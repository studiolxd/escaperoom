import { z } from "zod";
import { toReadableIssues, type ReadableIssue } from "./errors";

/**
 * Taxonomía de analítica — specs/16 §2. Los eventos se emiten desde el servidor
 * (Colyseus y Next API) al endpoint de colección, que los valida contra este
 * contrato antes de encolarlos hacia `analyticsEvent` (specs/16 §1, 14 §8).
 */

/** Tipos de evento admitidos (specs/16 §2.1–§2.4). */
export const ANALYTICS_EVENT_TYPES = [
  // 2.1 Jugador y sesión
  "user_registered",
  "onboarding_step",
  "room_playtest_started",
  "session_started",
  "player_joined",
  "session_ended",
  // 2.2 Gameplay (cada puzzle)
  "puzzle_available",
  "puzzle_attempted",
  "puzzle_solved",
  "puzzle_failed",
  "hint_viewed",
  "item_granted",
  "item_combined",
  "dialog_read",
  // 2.3 Claves y eventos
  "event_created",
  "key_sent",
  "key_confirmed",
  "key_redeemed",
  "key_expired_unused",
  "session_group_assigned",
  "organizer_panel_viewed",
  // 2.4 Negocio
  "room_published",
  "room_version_published",
  "purchase_completed",
  "credit_purchased",
  "credit_spent",
  "review_submitted",
] as const;

export const AnalyticsEventTypeSchema = z.enum(ANALYTICS_EVENT_TYPES);

/** Máximo de eventos por lote aceptado por el punto de colección. */
export const ANALYTICS_MAX_BATCH = 100;

/** Payload libre: eventos sin campos obligatorios conservan contexto extra. */
const openPayload = z.record(z.string(), z.unknown());

/**
 * Campos por tipo de evento (specs/16 §2). El schema del payload es la parte
 * específica de cada evento; el sobre común (`eventType`, ids) se valida aparte.
 * Zod descarta claves no declaradas, así que el contrato es tolerante hacia
 * adelante.
 */
const PAYLOAD_SCHEMAS: Record<AnalyticsEventType, z.ZodType> = {
  user_registered: openPayload,
  onboarding_step: z.object({ step: z.string().min(1) }),
  room_playtest_started: openPayload,
  session_started: openPayload,
  player_joined: z.object({
    room_id: z.string(),
    session_id: z.string(),
    player_n: z.number().int().nonnegative(),
    via: z.enum(["purchase", "key", "invite"]),
  }),
  session_ended: z.object({
    result: z.enum(["victory", "timeout", "abandon"]),
    duration_sec: z.number().nonnegative(),
    puzzles_solved: z.number().int().nonnegative(),
    hints_used: z.number().int().nonnegative(),
  }),
  puzzle_available: z.object({
    puzzle_id: z.string(),
    type: z.string(),
    room_id: z.string(),
  }),
  puzzle_attempted: z.object({
    puzzle_id: z.string(),
    attempt_n: z.number().int().positive(),
  }),
  puzzle_solved: z.object({
    puzzle_id: z.string(),
    type: z.string(),
    duration_since_available: z.number().nonnegative(),
    attempts: z.number().int().nonnegative(),
    hints_used_before: z.number().int().nonnegative(),
  }),
  puzzle_failed: z.object({
    puzzle_id: z.string(),
    reason: z.enum(["attempts", "timeout"]),
  }),
  hint_viewed: z.object({
    puzzle_id: z.string(),
    tier: z.number().int().positive(),
  }),
  item_granted: z.object({
    item_id: z.string(),
    source: z.enum(["puzzle", "recipe", "world"]),
  }),
  item_combined: z.object({
    inputs: z.array(z.string()),
    output: z.string(),
    success: z.boolean(),
  }),
  dialog_read: z.object({ dialog_id: z.string() }),
  event_created: z.object({
    n_sessions: z.number().int().nonnegative(),
    n_keys: z.number().int().nonnegative(),
    price_total: z.number().nonnegative(),
  }),
  key_sent: z.object({ via: z.enum(["email", "bulk", "print"]) }),
  key_confirmed: openPayload,
  key_redeemed: z.object({ assigned_session: z.string() }),
  key_expired_unused: openPayload,
  session_group_assigned: z.object({ mode: z.enum(["specific", "random", "free"]) }),
  organizer_panel_viewed: openPayload,
  room_published: z.object({
    n_puzzles: z.number().int().nonnegative(),
    n_rooms: z.number().int().nonnegative(),
  }),
  room_version_published: z.object({ version: z.string() }),
  purchase_completed: z.object({
    type: z.enum(["room", "room_license", "event", "credits"]),
    amount: z.number(),
    revenue_split: z.unknown().optional(),
  }),
  credit_purchased: z.object({ pack: z.string() }),
  credit_spent: z.object({
    service: z.string(),
    units: z.number().nonnegative(),
  }),
  review_submitted: z.object({ rating: z.number().int().min(1).max(5) }),
};

/**
 * Sobre común de un evento de analítica. `sessionId` y `roomVersionId` son
 * `uuid` porque acaban en columnas `uuid` de `analyticsEvent` (specs/14 §8).
 */
export const AnalyticsEventInputSchema = z.object({
  eventType: AnalyticsEventTypeSchema,
  sessionId: z.uuid().optional(),
  playerId: z.string().min(1).optional(),
  roomVersionId: z.uuid().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type AnalyticsEventType = z.infer<typeof AnalyticsEventTypeSchema>;
export type AnalyticsEventInput = z.infer<typeof AnalyticsEventInputSchema>;

export type AnalyticsValidation =
  | { ok: true; data: AnalyticsEventInput }
  | { ok: false; issues: ReadableIssue[] };

/**
 * Valida un único evento: primero el sobre (tipo dentro de la taxonomía, ids y
 * forma) y después el payload específico del tipo. Devuelve errores legibles en
 * lugar de lanzar, para que el endpoint pueda responder 400 con detalle.
 */
export function validateAnalyticsEvent(input: unknown): AnalyticsValidation {
  const envelope = AnalyticsEventInputSchema.safeParse(input);
  if (!envelope.success) {
    return { ok: false, issues: toReadableIssues(envelope.error) };
  }

  const payload = PAYLOAD_SCHEMAS[envelope.data.eventType].safeParse(envelope.data.payload);
  if (!payload.success) {
    return {
      ok: false,
      issues: toReadableIssues(payload.error).map((issue) => ({
        path: issue.path ? `payload.${issue.path}` : "payload",
        message: issue.message,
      })),
    };
  }

  return { ok: true, data: envelope.data };
}

export type AnalyticsCollectValidation =
  | { ok: true; events: AnalyticsEventInput[] }
  | { ok: false; issues: ReadableIssue[] };

/**
 * Valida un lote (o un evento suelto, por comodidad). El punto de colección
 * recibe lotes desde Colyseus y Next API (specs/16 §5) y devuelve todos los
 * problemas con la posición del evento dentro del lote.
 */
export function validateAnalyticsCollect(input: unknown): AnalyticsCollectValidation {
  if (Array.isArray(input)) {
    if (input.length === 0) {
      return { ok: false, issues: [{ path: "", message: "el lote no puede estar vacío" }] };
    }
    if (input.length > ANALYTICS_MAX_BATCH) {
      return {
        ok: false,
        issues: [
          {
            path: "",
            message: `el lote supera el máximo de ${ANALYTICS_MAX_BATCH} eventos`,
          },
        ],
      };
    }
  }

  const isBatch = Array.isArray(input);
  const list = isBatch ? input : [input];
  const events: AnalyticsEventInput[] = [];
  const issues: ReadableIssue[] = [];

  list.forEach((item, index) => {
    const result = validateAnalyticsEvent(item);
    if (result.ok) {
      events.push(result.data);
      return;
    }
    const prefix = isBatch ? `[${index}]` : "";
    for (const issue of result.issues) {
      issues.push({
        path: issue.path ? `${prefix ? `${prefix}.` : ""}${issue.path}` : prefix,
        message: issue.message,
      });
    }
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, events };
}
