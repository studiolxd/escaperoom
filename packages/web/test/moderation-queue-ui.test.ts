import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import { ModerationQueueView } from "../src/components/moderation/moderation-queue";

const catalogs = { es, en, fr, de, nl, pt };

describe("cola de moderación (UI, ticket 6.1)", () => {
  it.each(Object.entries(catalogs))("se renderiza en %s con sus textos", (locale, messages) => {
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale,
        messages,
        timeZone: "UTC",
        children: createElement(ModerationQueueView),
      }),
    );
    const t = messages.Moderation;
    expect(html).toContain(t.title);
    expect(html).toContain(t.loading);
    expect(html).toContain(t.tabs.appeals.replace("{count}", "0"));
    expect(html).not.toMatch(/Moderation\./);
  });
});
