"use client";

import "@xyflow/react/dist/style.css";
import { useState } from "react";
import { useTranslations } from "next-intl";
import * as Y from "yjs";
import {
  getRulesMap,
  RulesGraph,
  writeRules,
  type RulesGraphLabelsInput,
} from "@escaperoom/editor";
import type { Rule } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";

/**
 * Monta el grafo de reglas sobre un doc Yjs local sembrado con `rules`. Los
 * textos salen del namespace `RulesGraph.labels` (el paquete del editor no
 * depende de next-intl). El botón simula una tool call del MCP que escribe en
 * el doc sin pasar por el grafo: el cambio aparece solo.
 */
export function RulesGraphDemo({ rules }: { rules: Rule[] }) {
  const t = useTranslations("RulesGraph");
  const labels = t.raw("labels") as RulesGraphLabelsInput;
  const [doc] = useState(() => {
    const d = new Y.Doc();
    writeRules(d, rules);
    return d;
  });

  const simulateExternalChange = () => {
    const rule = getRulesMap(doc).get("r-inspeccionar-cuadro");
    const actions = rule?.get("actions") as Y.Array<unknown> | undefined;
    actions?.push([{ type: "play_sound", soundId: "fx-cuadro" }]);
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3 pr-40">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={simulateExternalChange}>
          {t("externalChange")}
        </Button>
      </header>
      <RulesGraph
        doc={doc}
        labels={labels}
        height="calc(100dvh - 8rem)"
        issues={[{ id: "r-aviso-10min", severity: "warning" }]}
      />
    </div>
  );
}
