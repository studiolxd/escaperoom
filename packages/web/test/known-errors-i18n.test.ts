import { describe, expect, it } from "vitest";
import es from "../messages/es.json";
import { KNOWN_ERRORS as PUBLISH_CONFIRM_PAGE_ERRORS } from "../src/app/[locale]/(creator)/publish-confirm/page";
import { KNOWN_ERRORS as CONFIRM_PUBLISH_ERRORS } from "../src/components/publish-confirm/confirm-publish";
import { KNOWN_ERRORS as EVENT_DASHBOARD_ERRORS } from "../src/components/event-panel/event-dashboard";
import { KNOWN_ERRORS as SPECTATOR_GAME_ERRORS } from "../src/components/event-panel/spectator-game";
import { KNOWN_ERRORS as GAME_SESSION_ERRORS } from "../src/components/game-session/game-session-shell";
import { KNOWN_ERRORS as CONFIRM_ATTENDANCE_ERRORS } from "../src/components/invitations/confirm-attendance";
import { KNOWN_ERRORS as MODERATION_QUEUE_ERRORS } from "../src/components/moderation/moderation-queue";
import { KNOWN_ERRORS as REDEEM_FORM_ERRORS } from "../src/components/redeem/redeem-form";
import { KNOWN_ERRORS as PLAYTEST_BUTTON_ERRORS } from "../src/components/room-editor/playtest-button";

/**
 * F-43..47 punto 4 (auditoría 2026-09-24): cada pantalla importa sus códigos
 * de error `KNOWN_ERRORS` desde `@escaperoom/shared` en vez de duplicarlos a
 * mano (ver los propios ficheros para la fuente de cada uno). Este test
 * cubre la mitad que ni el compilador ni el `satisfies` contra el tipo del
 * servidor pueden ver: que `messages/es.json` sigue teniendo una traducción
 * para cada código que la pantalla dice reconocer, bajo el namespace que esa
 * pantalla usa para `t(\`errors.${code}\`)\` (o `editor.errors.${code}` en
 * `playtest-button`).
 */
function errorKeysOf(namespace: Record<string, unknown>): Set<string> {
  const errors = namespace.errors;
  if (typeof errors !== "object" || errors === null) throw new Error("namespace sin errors");
  return new Set(Object.keys(errors));
}

const CASES: Array<{ name: string; known: ReadonlySet<string>; keys: Set<string> }> = [
  {
    name: "publish-confirm/page.tsx (PublishConfirm.errors)",
    known: PUBLISH_CONFIRM_PAGE_ERRORS,
    keys: errorKeysOf(es.PublishConfirm),
  },
  {
    name: "publish-confirm/confirm-publish.tsx (PublishConfirm.errors)",
    known: CONFIRM_PUBLISH_ERRORS,
    keys: errorKeysOf(es.PublishConfirm),
  },
  {
    name: "event-panel/event-dashboard.tsx (EventPanel.errors)",
    known: EVENT_DASHBOARD_ERRORS,
    keys: errorKeysOf(es.EventPanel),
  },
  {
    name: "event-panel/spectator-game.tsx (EventPanel.errors)",
    known: SPECTATOR_GAME_ERRORS,
    keys: errorKeysOf(es.EventPanel),
  },
  {
    name: "invitations/confirm-attendance.tsx (InvitationConfirm.errors)",
    known: CONFIRM_ATTENDANCE_ERRORS,
    keys: errorKeysOf(es.InvitationConfirm),
  },
  {
    name: "moderation/moderation-queue.tsx (Moderation.errors)",
    known: MODERATION_QUEUE_ERRORS,
    keys: errorKeysOf(es.Moderation),
  },
  {
    name: "redeem/redeem-form.tsx (Redeem.errors)",
    known: REDEEM_FORM_ERRORS,
    keys: errorKeysOf(es.Redeem),
  },
  {
    name: "room-editor/playtest-button.tsx (EditorPlaytest.editor.errors)",
    known: PLAYTEST_BUTTON_ERRORS,
    keys: errorKeysOf(es.EditorPlaytest.editor),
  },
];

describe("KNOWN_ERRORS ⊆ claves errors.* de messages/es.json", () => {
  for (const { name, known, keys } of CASES) {
    it(`${name}: cada código reconocido tiene traducción`, () => {
      for (const code of known) {
        expect(keys.has(code), `falta la clave errors.${code}`).toBe(true);
      }
    });
  }

  // `Game.errors` usa `generic` como clave de fallback, no `UNKNOWN` (inconsistencia
  // ya documentada en la auditoría): mismo chequeo con esa excepción de namespace.
  it("game-session-shell.tsx (Game.errors): cada código reconocido tiene traducción", () => {
    const keys = errorKeysOf(es.Game);
    for (const code of GAME_SESSION_ERRORS) {
      expect(keys.has(code), `falta la clave errors.${code}`).toBe(true);
    }
  });
});
