import {
  formatDanglingReferenceSummary,
  partitionDanglingReferenceDiagnostics
} from "@/domain/parameter-topology/toolchainDiagnostics";
import type { TopologyDiagnostic } from "@/domain/parameter-topology/types";

type WorkbenchDiagnosticsSectionProps = {
  diagnostics: TopologyDiagnostic[];
  /**
   * `dangling` — only the collapsed self-anchor summary (footer / soft notice).
   * `other` — only non-dangling product diagnostics (top governance).
   * `all` — both (default; used by teaching / mock layouts).
   */
  variant?: "all" | "dangling" | "other";
};

function formatDiagnosticLine(diagnostic: TopologyDiagnostic): string {
  const prefix = diagnostic.severity ? `[${diagnostic.severity}] ` : "";
  return `${prefix}${diagnostic.message}`;
}

/**
 * Governance-surface diagnostics list. Self-anchored dangling `&label` warnings
 * collapse to one expandable summary so overlay-only projects do not flood the
 * technical view; other product diagnostics stay as a flat list.
 */
export function WorkbenchDiagnosticsSection({
  diagnostics,
  variant = "all"
}: WorkbenchDiagnosticsSectionProps) {
  if (diagnostics.length === 0) return null;

  const { dangling, other, summary } = partitionDanglingReferenceDiagnostics(diagnostics);
  const showDangling = variant !== "other" && summary;
  const showOther = variant !== "dangling" && other.length > 0;

  if (!showDangling && !showOther) return null;

  return (
    <section
      aria-label={showDangling && !showOther ? "解析提示" : "编译诊断"}
      className={`workbench-diagnostics${showDangling && !showOther ? " workbench-diagnostics--soft" : ""}`}
    >
      {showDangling ? (
        <details className="workbench-diagnostics__dangling">
          <summary className="workbench-diagnostics__dangling-summary">
            {formatDanglingReferenceSummary(summary)}
          </summary>
          <ul className="workbench-diagnostics__dangling-list">
            {summary.labels.length > 0
              ? summary.labels.map((label) => (
                  <li key={label}>
                    <code>&{label}</code>
                  </li>
                ))
              : dangling.map((diagnostic) => (
                  <li key={`${diagnostic.code ?? ""}:${diagnostic.message}`}>
                    {formatDiagnosticLine(diagnostic)}
                  </li>
                ))}
          </ul>
        </details>
      ) : null}
      {showOther ? (
        <ul className="workbench-diagnostics__other">
          {other.map((diagnostic) => (
            <li key={`${diagnostic.code ?? ""}:${diagnostic.message}`}>
              {formatDiagnosticLine(diagnostic)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
