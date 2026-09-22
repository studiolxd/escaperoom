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
