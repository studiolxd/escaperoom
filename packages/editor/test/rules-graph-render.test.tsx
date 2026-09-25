import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { RulesGraph, triggerNodeId, writeRules, type RulesGraphLabelsInput } from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const { rules } = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

// El repo no usa jsdom/testing-library: render en servidor (React Flow admite SSR).
describe("<RulesGraph> — render básico", () => {
  const labels: RulesGraphLabelsInput = {
    kinds: { trigger: "Cuando", condition: "Si", action: "Entonces" },
    triggers: { on_interact: "Al interactuar" },
    ui: { newRule: "Nueva regla" },
  };

  it("pinta un nodo por trigger/condición/acción con los textos recibidos por props", () => {
    const doc = new Y.Doc();
    writeRules(doc, rules);
    const html = renderToStaticMarkup(
      <RulesGraph
        doc={doc}
        labels={labels}
        issues={[{ id: "r-encender-brasero", severity: "error", message: "Dead end" }]}
        height={480}
      />,
    );

    const count = (needle: string) => html.split(needle).length - 1;
    const nodeCount = rules.reduce(
      (sum, r) =>
        sum +
        1 +
        r.conditions.length +
        r.actions.reduce((n, a) => n + 1 + (a.type === "delay" ? a.actions.length : 0), 0),
      0,
    );
    expect(count('class="rules-graph-node ')).toBe(nodeCount);
    expect(count("rules-graph-node--trigger")).toBe(rules.length);
    expect(html).toContain(`data-id="${triggerNodeId("r-encender-brasero")}"`);
    expect(html).toContain('value="r-encender-brasero"');
    expect(html).toContain("Al interactuar");
    expect(html).toContain("Nueva regla");
    // Sin traducción cae al identificador técnico.
    expect(html).toContain("on_puzzle_solved");
    // El problema del validador pinta la regla con su severidad.
    expect(html).toContain('data-severity="error"');
    expect(html).toContain('title="Dead end"');
  });

  it("en solo lectura no ofrece la barra de creación", () => {
    const doc = new Y.Doc();
    writeRules(doc, rules.slice(0, 1));
    const html = renderToStaticMarkup(
      <RulesGraph doc={doc} labels={{ ui: { readOnly: "Solo lectura" } }} readOnly />,
    );
    expect(html).toContain("Solo lectura");
    expect(html).not.toContain("newRule");
  });

  it("usa el `Select` y el `Button` del host vía `components` (auditoría F-6)", () => {
    const doc = new Y.Doc();
    writeRules(doc, rules.slice(0, 1));
    const html = renderToStaticMarkup(
      <RulesGraph
        doc={doc}
        labels={labels}
        height={480}
        components={{
          Button: (props) => <button {...props} data-host-kit="button" type="button" />,
          Select: ({ value, options, placeholder, ...rest }) => (
            <select {...rest} data-host-kit="select" defaultValue={value}>
              {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ),
        }}
      />,
    );
    expect(html).toContain('data-host-kit="button"');
    expect(html).toContain('data-host-kit="select"');
  });
});

describe("<RulesGraph> — foco desde el inspector (3.4)", () => {
  it("focusRuleId selecciona los nodos de esa regla y solo esos", () => {
    const doc = new Y.Doc();
    writeRules(doc, rules);
    const html = renderToStaticMarkup(
      <RulesGraph doc={doc} focusRuleId="r-abrir-arca" height={480} />,
    );
    const selected = [
      ...html.matchAll(/class="react-flow__node[^"]*\bselected\b[^"]*"[^>]*data-id="([^"]+)"/g),
    ].map((m) => m[1]);
    const alt = [
      ...html.matchAll(/data-id="([^"]+)"[^>]*class="react-flow__node[^"]*\bselected\b/g),
    ].map((m) => m[1]);
    const ids = selected.length > 0 ? selected : alt;
    expect(ids).toEqual(["r-abrir-arca/trigger", "r-abrir-arca/a/0"]);
  });
});
