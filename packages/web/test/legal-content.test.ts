import { describe, expect, it } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import { cookiesPolicy } from "../src/content/legal/cookies";
import { dpaAnnex } from "../src/content/legal/dpa";
import { legalNotice } from "../src/content/legal/legal-notice";
import { privacyPolicy } from "../src/content/legal/privacy";
import { termsOfService } from "../src/content/legal/terms";
import type { LegalDocument, LegalHref, LegalText } from "../src/content/legal/types";

const documents: Record<LegalHref, LegalDocument> = {
  "/legal/terms": termsOfService,
  "/legal/privacy": privacyPolicy,
  "/legal/dpa": dpaAnnex,
  "/legal/legal-notice": legalNotice,
  "/legal/cookies": cookiesPolicy,
};

function linksOf(doc: LegalDocument): LegalHref[] {
  const texts: LegalText[] = doc.sections.flatMap((s) => [...s.paragraphs, ...(s.list ?? [])]);
  return texts.flatMap((text) =>
    typeof text === "string"
      ? []
      : text.flatMap((fragment) => (typeof fragment === "string" ? [] : [fragment.href])),
  );
}

describe("contenido legal", () => {
  it("cierra los cinco documentos con la sección de versiones lingüísticas", () => {
    for (const [href, doc] of Object.entries(documents)) {
      expect(doc.sections.at(-1)?.heading, href).toMatch(/^\d+\. Versiones lingüísticas$/);
    }
  });

  it("enlaza de verdad las remisiones clave entre documentos", () => {
    expect(linksOf(termsOfService)).toEqual(
      expect.arrayContaining(["/legal/privacy", "/legal/cookies", "/legal/dpa", "/legal/legal-notice"]),
    );
    expect(linksOf(privacyPolicy)).toEqual(
      expect.arrayContaining(["/legal/terms", "/legal/dpa", "/legal/cookies", "/legal/legal-notice"]),
    );
    expect(linksOf(dpaAnnex)).toEqual(expect.arrayContaining(["/legal/terms", "/legal/privacy"]));
    expect(linksOf(legalNotice)).toEqual(
      expect.arrayContaining(["/legal/terms", "/legal/privacy", "/legal/cookies"]),
    );
  });

  it("ningún documento se enlaza a sí mismo", () => {
    for (const [href, doc] of Object.entries(documents)) {
      expect(linksOf(doc), href).not.toContain(href);
    }
  });

  it("nombra el DPA como anexo, no como plantilla, en los seis idiomas", () => {
    for (const catalog of [es, en, fr, de, nl, pt]) {
      expect(catalog.Legal.nav.dpa).not.toMatch(/plantilla|template|modèle|vorlage|sjabloon|modelo/i);
      expect(catalog.Legal.dpa.title).not.toMatch(/plantilla|template|modèle|vorlage|sjabloon|modelo/i);
      expect(catalog.Legal.onlyInSpanishNotice).toBeTruthy();
    }
  });
});
