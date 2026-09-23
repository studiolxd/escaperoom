import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@escaperoom/config/locales";
import de from "../messages/de.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import { deepMergeMessages, type Messages } from "../src/i18n/messages";

const catalogs: Record<Locale, Messages> = { en, es, fr, de, nl, pt };

function collectKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    collectKeyPaths(nested, prefix ? `${prefix}.${key}` : key),
  );
}

const defaultKeys = collectKeyPaths(es);

describe("i18n", () => {
  it("uses the default locale from the shared config", () => {
    expect(DEFAULT_LOCALE).toBe("es");
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("defines a catalog for every supported locale", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...LOCALES].sort());
  });

  it("keeps the default catalog complete for the copy the app uses", () => {
    expect(defaultKeys).toEqual(
      expect.arrayContaining([
        "Metadata.title",
        "Metadata.description",
        "LocaleSwitcher.label",
        "Home.showcase",
        "Home.title",
        "Home.subtitle",
        "Home.lobbyCta",
        "Home.fallbackDemo",
        "CodeLock.title",
        "CodeLock.prompt",
        "CodeLock.submit",
        "CodeLock.wrong",
        "CodeLock.lockedOut",
        "CodeLock.solved",
        "SimultaneousPlates.title",
        "SimultaneousPlates.progress",
        "SimultaneousPlates.countdown",
        "SimultaneousPlates.solved",
        "Playtest.steps",
        "Playtest.room",
        "Playtest.step.sello",
        "Playtest.menu.openPanel",
        "Playtest.log.enterRoom",
        "SplitClue.title",
        "SplitClue.progress",
        "SplitClue.viewLabel",
        "SplitClue.bridge",
        "SplitClue.submit",
        "SplitClue.solved",
        "Memory.title",
        "Memory.prompt",
        "Memory.pairs",
        "Memory.match",
        "Memory.mismatch",
        "Memory.solved",
        "Pipes.title",
        "Pipes.prompt",
        "Pipes.gateClosed",
        "Pipes.missingItem",
        "Pipes.solved",
        "Inventory.title",
        "Inventory.recipes",
        "Inventory.gridLabel",
        "Inventory.emptySlot",
        "Inventory.unknownItem",
        "Inventory.combineZone",
        "Inventory.dropHere",
        "Inventory.pending",
        "Inventory.combine",
        "Inventory.clear",
        "Inventory.hint",
        "Inventory.combined",
        "Inventory.alreadyApplied",
        "Inventory.invalid",
        "Inventory.missingItems",
        "Inventory.unavailable",
        "InvitationConfirm.title",
        "InvitationConfirm.cta",
        "InvitationConfirm.success",
        "InvitationConfirm.already",
        "InvitationConfirm.errors.CONFIRMATION_INVALID",
        "InvitationConfirm.errors.CONFIRMATION_EXPIRED",
        "InvitationConfirm.errors.UNKNOWN",
        "Redeem.title",
        "Redeem.codeLabel",
        "Redeem.nameLabel",
        "Redeem.cta",
        "Redeem.errors.ACCESS_KEY_INVALID",
        "Redeem.errors.ACCESS_KEY_USED",
        "Redeem.errors.SESSION_FULL",
        "Redeem.errors.UNKNOWN",
        "McpConsent.title",
        "McpConsent.intro",
        "McpConsent.signedInAs",
        "McpConsent.permissionsTitle",
        "McpConsent.permissions.drafts",
        "McpConsent.permissions.noForeign",
        "McpConsent.permissions.expiry",
        "McpConsent.redirectTo",
        "McpConsent.approve",
        "McpConsent.deny",
        "McpConsent.login.intro",
        "McpConsent.login.google",
        "McpConsent.login.emailLabel",
        "McpConsent.login.emailSubmit",
        "McpConsent.login.emailSent",
        "McpConsent.login.error",
        "McpConsent.errors.invalid",
        "Results.title",
        "Results.result.victory",
        "Results.result.timeout",
        "Results.result.aborted",
        "Results.time",
        "Results.hints",
        "Results.puzzles",
        "Results.puzzlesValue",
        "Results.items",
        "Results.review",
        "Results.exit",
        "EditorI18n.placeholder",
        "EditorI18n.missingOne",
        "EditorI18n.missingSummary",
        "EditorI18n.languagesTitle",
        "EditorI18n.removeWarning",
        "EditorI18n.removeKeep",
        "EditorI18n.removePurge",
        "EditorI18n.errors.DEFAULT_LANGUAGE",
        "EditorI18n.errors.LAST_LANGUAGE",
        "RulesGraph.title",
        "RulesGraph.description",
        "RulesGraph.externalChange",
        "RulesGraph.labels.kinds.trigger",
        "RulesGraph.labels.triggers.on_interact",
        "RulesGraph.labels.conditions.item_in_inventory",
        "RulesGraph.labels.actions.set_object_state",
        "RulesGraph.labels.fields.objectId",
        "RulesGraph.labels.ui.newRule",
        "EditorAudio.none",
        "EditorAudio.library",
        "EditorAudio.myUploads",
        "EditorAudio.kinds.music",
        "EditorAudio.status.pending",
        "EditorAudio.status.rejected",
        "EditorAudio.upload",
        "EditorAudio.uploadHint",
        "EditorAudio.rightsDeclared",
        "EditorAudio.errors.tooLarge",
        "EditorAudio.errors.notMp3",
        "ValidationPanel.title",
        "ValidationPanel.labels.ui.blocked",
        "ValidationPanel.labels.ui.estimateValue",
        "ValidationPanel.labels.checks.dead_ends",
        "ValidationPanel.labels.checks.puzzle_hints",
        "ValidationPanel.labels.kinds.rule",
        "RoomEditor.untitledRoom",
        "RoomEditor.status.connected",
        "RoomEditor.tools.brush",
        "RoomEditor.tools.fill",
        "RoomEditor.tools.eraser",
        "RoomEditor.layers.decor",
        "RoomEditor.palette.placed",
        "RoomEditor.selection.rename",
        "RoomEditor.errors.DUPLICATE_ID",
      ]),
    );
  });

  it("only declares keys that exist in the default catalog", () => {
    for (const locale of LOCALES) {
      for (const key of collectKeyPaths(catalogs[locale])) {
        expect(defaultKeys, `unknown key "${key}" in ${locale}.json`).toContain(key);
      }
    }
  });

  it("resolves every catalog to the default key set after fallback", () => {
    for (const locale of LOCALES) {
      const mergedKeys = collectKeyPaths(deepMergeMessages(es, catalogs[locale])).sort();
      expect(mergedKeys, `missing keys for ${locale}`).toEqual([...defaultKeys].sort());
    }
  });

  it("falls back to the default catalog when a key is missing", () => {
    expect(en.Home).not.toHaveProperty("fallbackDemo");
    const merged = deepMergeMessages(es, catalogs.en);
    const home = merged.Home as Record<string, string>;
    expect(home.fallbackDemo).toBe(es.Home.fallbackDemo);
  });
});
