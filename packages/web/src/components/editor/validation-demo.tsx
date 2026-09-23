"use client";

import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import * as Y from "yjs";
import {
  createRulesOverlaySerializer,
  insertCondition,
  readRules,
  removeCondition,
  RulesGraph,
  useRoomValidation,
  ValidationPanel,
  writeRules,
  type RulesGraphLabelsInput,
  type ValidationPanelLabelsInput,
} from "@escaperoom/editor";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { Button } from "@/components/ui/button";

const LOCK = { type: "flag_is", flag: "armario-desbloqueado", value: true } as const;

/**
 * Demo de la validación continua (ticket 3.7): las reglas del paquete viven
 * en un doc Yjs local; cada cambio (grafo o botones) revalida con debounce y
 * los problemas se pintan en el grafo y en el panel. El resto del paquete sale
 * del fixture hasta que 3.1 publique la serialización doc → RoomPackage.
 */
export function ValidationDemo({ pkg }: { pkg: RoomPackage }) {
  const t = useTranslations("ValidationPanel");
  const graphLabels = useTranslations("RulesGraph").raw("labels") as RulesGraphLabelsInput;
  const panelLabels = t.raw("labels") as ValidationPanelLabelsInput;
  const [doc] = useState(() => {
    const d = new Y.Doc();
    writeRules(d, pkg.rules);
    return d;
  });
  const serialize = useMemo(() => createRulesOverlaySerializer(pkg), [pkg]);
  const validation = useRoomValidation(doc, serialize);

  const breakRule = () => insertCondition(doc, "r-abrir-armario", LOCK);
  const fixRule = () => {
    const rule = readRules(doc).find((candidate) => candidate.id === "r-abrir-armario");
    const index = rule?.conditions.findIndex(
      (condition) => condition.type === "flag_is" && condition.flag === LOCK.flag,
    );
    if (index !== undefined && index >= 0) removeCondition(doc, "r-abrir-armario", index);
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3 pr-40">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={breakRule}>
          {t("breakRule")}
        </Button>
        <Button variant="outline" size="sm" onClick={fixRule}>
          {t("fixRule")}
        </Button>
      </header>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <RulesGraph
          doc={doc}
          labels={graphLabels}
          issues={validation.ruleGraphIssues}
          height="calc(100dvh - 8rem)"
        />
        <div className="max-h-[calc(100dvh-8rem)] overflow-auto rounded-md border p-3">
          <ValidationPanel state={validation} labels={panelLabels} />
        </div>
      </div>
    </div>
  );
}
