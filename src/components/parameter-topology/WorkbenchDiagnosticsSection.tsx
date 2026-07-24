import {
  formatDanglingReferenceSummary,
  partitionDanglingReferenceDiagnostics
} from "@/domain/parameter-topology/toolchainDiagnostics";
import type { TopologyDiagnostic } from "@/domain/parameter-topology/types";

type WorkbenchDiagnosticsSectionProps = {
  diagnostics: TopologyDiagnostic[];
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
export function WorkbenchDiagnosticsSection({ diagnostics }: WorkbenchDiagnosticsSectionProps) {
  if (diagnostics.length === 0) return null;

  const { dangling, other, summary } = partitionDanglingReferenceDiagnostics(diagnostics);

  return (
    <section aria-label="编译诊断" className="workbench-diagnostics">
      {summary ? (
        <details className="workbench-diagnostics__dangling">
          <summary className="workbench-diagnostics__dangling-summary">
            [{summary.severity}] {formatDanglingReferenceSummary(summary)}
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
      {other.length > 0 ? (
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
