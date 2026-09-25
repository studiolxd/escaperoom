"use client";

import type { CSSProperties } from "react";
import { resolveUiKit, type EditorUiKit } from "../ui-kit";
import type { RoomValidationState } from "./controller";
import type { FindingSeverity, ValidationFinding, ValidationTarget } from "./findings";
import { createValidationLabeler, type ValidationPanelLabelsInput } from "./labels";

export type ValidationPanelProps = {
  /** Estado de `useRoomValidation` / `createRoomValidator`. */
  state: Pick<
    RoomValidationState,
    "status" | "pending" | "report" | "pkg" | "findings" | "conversionErrors"
  >;
  labels?: ValidationPanelLabelsInput;
  /** Clic en un elemento señalado (seleccionarlo en el lienzo o el grafo). */
  onSelectTarget?: (target: ValidationTarget) => void;
  /** Controles interactivos del host (auditoría F-6); por defecto, elemento nativo. */
  components?: Partial<EditorUiKit>;
  className?: string;
};

const SEVERITY_COLOR: Record<FindingSeverity, string> = { error: "#dc2626", warning: "#d97706" };
const SEVERITY_ICON: Record<FindingSeverity, string> = { error: "❌", warning: "🟡" };

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const headingStyle: CSSProperties = { fontSize: 13, fontWeight: 600, margin: 0 };
const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const chipStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
  padding: "1px 6px",
  borderRadius: 4,
  border: "1px solid #d1d5db",
  background: "#f9fafb",
  color: "#111827",
};

type Labeler = ReturnType<typeof createValidationLabeler>;

function FindingItem(props: {
  finding: ValidationFinding;
  t: Labeler;
  kit: EditorUiKit;
  onSelectTarget?: (target: ValidationTarget) => void;
}) {
  const { finding, t, kit, onSelectTarget } = props;
  return (
    <li
      data-severity={finding.severity}
      data-check={finding.checkId}
      style={{ borderLeft: `3px solid ${SEVERITY_COLOR[finding.severity]}`, paddingLeft: 8 }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        {SEVERITY_ICON[finding.severity]} {t.check(finding.checkId)}
      </div>
      <div style={{ fontSize: 12 }}>{finding.message}</div>
      {finding.playerCounts ? (
        <div style={{ fontSize: 11, opacity: 0.8 }}>
          {t.ui("playerCounts", { counts: finding.playerCounts.join(", ") })}
        </div>
      ) : null}
      {finding.targets.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
          {finding.targets.map((target) => {
            const text = `${t.kind(target.kind)}: ${target.id}`;
            return onSelectTarget ? (
              <kit.Button
                key={target.id}
                type="button"
                data-target-id={target.id}
                data-target-kind={target.kind}
                style={{ ...chipStyle, cursor: "pointer" }}
                onClick={() => onSelectTarget(target)}
              >
                {text}
              </kit.Button>
            ) : (
              <span
                key={target.id}
                data-target-id={target.id}
                data-target-kind={target.kind}
                style={chipStyle}
              >
                {text}
              </span>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Panel de avisos del validador (specs/09 §5): errores ❌ (bloquean la
 * publicación), avisos 🟡, estimación de duración y ruta crítica. Solo
 * presenta el estado; la validación la hace `useRoomValidation`.
 */
export function ValidationPanel({
  state,
  labels,
  onSelectTarget,
  components,
  className,
}: ValidationPanelProps) {
  const t = createValidationLabeler(labels);
  const kit = resolveUiKit(components);
  const { report, findings } = state;
  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");

  const statusText =
    state.status === "idle"
      ? t.ui("idle")
      : state.pending
        ? t.ui("validating")
        : state.status === "invalid"
          ? t.ui("invalidDraft")
          : report?.ok
            ? t.ui("publishable")
            : t.ui("blocked");

  return (
    <section
      className={["validation-panel", className].filter(Boolean).join(" ")}
      aria-label={t.ui("title")}
      aria-busy={state.pending}
      data-status={state.status}
      style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12 }}
    >
      <header>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t.ui("title")}</h2>
        <p role="status" style={{ margin: 0, opacity: 0.8 }}>
          {statusText}
        </p>
      </header>

      {state.status === "invalid" ? (
        <ul style={listStyle} data-section="conversion">
          {state.conversionErrors.map((error, i) => (
            <li key={i} data-severity="error">
              <code>{error.path || "(raíz)"}</code>: {error.message}
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === "ready" ? (
        <>
          {findings.length === 0 ? <p style={{ margin: 0 }}>{t.ui("noIssues")}</p> : null}
          {errors.length > 0 ? (
            <div style={sectionStyle} data-section="errors">
              <h3 style={headingStyle}>
                {t.ui("errors")} ({errors.length})
              </h3>
              <ul style={listStyle}>
                {errors.map((finding) => (
                  <FindingItem
                    key={finding.key}
                    finding={finding}
                    t={t}
                    kit={kit}
                    {...(onSelectTarget ? { onSelectTarget } : {})}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div style={sectionStyle} data-section="warnings">
              <h3 style={headingStyle}>
                {t.ui("warnings")} ({warnings.length})
              </h3>
              <ul style={listStyle}>
                {warnings.map((finding) => (
                  <FindingItem
                    key={finding.key}
                    finding={finding}
                    t={t}
                    kit={kit}
                    {...(onSelectTarget ? { onSelectTarget } : {})}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <div style={sectionStyle} data-section="estimate">
            <h3 style={headingStyle}>{t.ui("estimate")}</h3>
            {report?.estimate ? (
              <>
                <p style={{ margin: 0 }}>
                  {t.ui("estimateValue", {
                    minutes: report.estimate.minutes,
                    min: report.estimate.range.min,
                    max: report.estimate.range.max,
                    players: report.estimate.playerCount,
                    steps: report.estimate.routeSteps,
                  })}
                </p>
                {state.pkg ? (
                  <p style={{ margin: 0, opacity: 0.8 }}>
                    {t.ui("difficulty", {
                      declared: state.pkg.meta.difficulty,
                      expected: report.estimate.expectedDifficulty,
                    })}
                  </p>
                ) : null}
              </>
            ) : (
              <p style={{ margin: 0 }}>{t.ui("noRoute")}</p>
            )}
          </div>

          {report?.criticalRoute ? (
            <div style={sectionStyle} data-section="route">
              <h3 style={headingStyle}>
                {t.ui("route", { players: report.criticalRoute.playerCount })}
              </h3>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {report.criticalRoute.steps.map((step) => (
                  <li key={step.index} data-subject-id={step.subjectId}>
                    {step.description}
                    {step.outcome ? <span style={{ opacity: 0.75 }}> → {step.outcome}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
