# Parameter Comparison Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move parameter comparison into a row-level detail modal on `/parameters` and retire the standalone `/parameter-comparison` page as a business feature.

**Architecture:** Add a pure single-parameter comparison helper, a focused `ParameterDetailDialog`, then wire it through `ParametersTable` and `ParametersPage`. Remove user-facing comparison navigation and make direct `/parameter-comparison` access render a no-entry page instead of the old comparison workspace.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, existing shadcn/Radix dialog primitives, lucide-react icons.

---

## File Structure

Create:

- `src/domain/parameters/singleParameterComparison.ts`  
  Pure domain helper for aggregating one same-name parameter across all projects.
- `src/domain/parameters/singleParameterComparison.test.ts`  
  Focused unit tests for numeric deltas, text changes, missing values, unit mismatch, and coverage counts.
- `src/components/ParameterDetailDialog.tsx`  
  Modal UI for definition and cross-project comparison.
- `src/components/ParameterDetailDialog.test.tsx`  
  Component tests for modal rendering, target selection, disabled draft action, and add-to-draft callback.
- `src/components/NoEntryPage.tsx`  
  Small reusable no-entry state for retired or unavailable routes.
- `src/components/NoEntryPage.test.tsx`  
  Component test for accessible no-entry copy and navigation action.

Modify:

- `src/components/ParametersTable.tsx`  
  Add `onViewRow` prop and render row-level view button in the operation column.
- `src/components/ParametersTable.test.tsx`  
  Add test coverage for the view action and event propagation.
- `src/ParametersPage.tsx`  
  Own modal state, compute default target project, wire dialog, remove topbar standalone comparison action.
- `src/ParametersPage.test.tsx`  
  Add integration tests for modal workflow, no URL change, all-project comparison, target selection, add-to-draft, read-only disabled state, and removed topbar comparison action.
- `src/ParameterManagementHomePage.tsx`  
  Remove the comparison quick nav entry.
- `src/ParameterManagementHomePage.test.tsx`  
  Update quick-entry assertions so comparison is not advertised.
- `src/app/routes.tsx`  
  Remove `ParameterComparisonPage` rendering and return `NoEntryPage` for `parameter-comparison`.
- `src/appConfig.ts`  
  Remove `/parameter-comparison` from `navigationItems`; keep `getPageByPath("/parameter-comparison")` as a synthetic retired page config.
- `src/App.tsx`  
  Remove comparison-selection state plumbing and pass simpler props to `PageRouter` and `UnifiedAgent`.
- `src/features/agent/UnifiedAgent.tsx`  
  Remove `/parameter-comparison` specific insight dependency and `comparisonSelection` prop.
- `src/features/agent/UnifiedAgent.test.tsx`  
  Update tests for the simplified `UnifiedAgent` props.
- `src/App.test.tsx`  
  Replace standalone comparison expectations with retired-route and modal-flow expectations.
- `src/styles.css`  
  Add modal layout styles and remove or ignore unused standalone comparison page styles.

Retire if no longer imported:

- `src/ParameterComparison/ParameterComparisonPage.tsx`
- `src/ParameterComparison/index.ts`
- `src/ParameterComparison/components/*`
- `src/ParameterComparison/hooks/*`
- `src/ParameterComparison/utils/*`
- `src/ParameterComparison/__tests__/*`
- `src/features/parameter-comparison/useParameterComparisonViewModel.ts`
- `src/features/parameter-comparison/useParameterComparisonViewModel.test.ts`

Keep only shared pure logic that remains imported by the new helper.

---

### Task 1: Single-Parameter Comparison Helper

**Files:**
- Create: `src/domain/parameters/singleParameterComparison.ts`
- Create: `src/domain/parameters/singleParameterComparison.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `src/domain/parameters/singleParameterComparison.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ParameterRecord, Project } from "@/mockData";
import { buildSingleParameterProjectComparison } from "./singleParameterComparison";

const projects: Project[] = [
  { id: "aurora", code: "AUR-Prod", name: "Aurora Production" },
  { id: "nebula", code: "NEB-RD", name: "Nebula Lab" },
  { id: "atlas", code: "ATL-Intl", name: "Atlas Intl" },
  { id: "orion", code: "ORI-New", name: "Orion New" }
];

function parameter(patch: Partial<ParameterRecord>): ParameterRecord {
  return {
    id: `${patch.projectId ?? "aurora"}-${patch.name ?? "fast_charge_current_limit_ma"}`,
    name: patch.name ?? "fast_charge_current_limit_ma",
    description: patch.description ?? "Fast charge current limit",
    explanation: patch.explanation ?? "Limits fast charging current.",
    configFormat: patch.configFormat ?? "charging.fast_charge_current_limit_ma=3850",
    module: patch.module ?? "Charging Policy",
    projectId: patch.projectId ?? "aurora",
    currentValue: patch.currentValue ?? "3850",
    recommendedValue: patch.recommendedValue ?? "3200",
    range: patch.range ?? "2500 - 4500",
    unit: patch.unit ?? "mA",
    risk: patch.risk ?? "High",
    updatedAt: patch.updatedAt ?? "today 10:00",
    updatedAtTs: patch.updatedAtTs ?? "2026-05-21T02:00:00.000Z",
    history: patch.history ?? []
  };
}

describe("buildSingleParameterProjectComparison", () => {
  it("compares one parameter by name across every project", () => {
    const data = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", currentValue: "3850" }),
        parameter({ projectId: "nebula", currentValue: "4200", recommendedValue: "4000" }),
        parameter({ projectId: "atlas", currentValue: "3000", risk: "Medium" })
      ],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(data.rows.map((row) => row.projectCode)).toEqual(["AUR-Prod", "NEB-RD", "ATL-Intl", "ORI-New"]);
    expect(data.baseRow?.currentValue).toBe("3850 mA");
    expect(data.targetRow?.currentValue).toBe("4200 mA");
    expect(data.rows.find((row) => row.projectId === "orion")).toMatchObject({
      status: "missing",
      currentValue: "Not configured"
    });
    expect(data.coverage).toEqual({ configured: 3, missing: 1, total: 4 });
  });

  it("calculates numeric absolute and percentage deltas for the emphasized target", () => {
    const data = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", currentValue: "3850" }),
        parameter({ projectId: "nebula", currentValue: "4200" })
      ],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(data.delta).toEqual({
      kind: "numeric",
      direction: "up",
      amount: 350,
      percent: 9.1,
      unit: "mA",
      label: "+350 mA (+9.1%)"
    });
  });

  it("reports text changes without numeric delta", () => {
    const data = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", name: "charge_mode", currentValue: "adaptive", unit: "" }),
        parameter({ projectId: "nebula", name: "charge_mode", currentValue: "aggressive", unit: "" })
      ],
      projects,
      parameterName: "charge_mode",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(data.delta).toEqual({
      kind: "text",
      status: "changed",
      label: "adaptive -> aggressive"
    });
  });

  it("flags target missing and unit mismatch states", () => {
    const missing = buildSingleParameterProjectComparison({
      parameters: [parameter({ projectId: "aurora", currentValue: "3850" })],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(missing.delta).toEqual({ kind: "missing", label: "Target project is not configured" });

    const unitMismatch = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", currentValue: "3850", unit: "mA" }),
        parameter({ projectId: "nebula", currentValue: "4.2", unit: "A" })
      ],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(unitMismatch.rows.find((row) => row.projectId === "nebula")?.unitMismatch).toBe(true);
    expect(unitMismatch.delta).toEqual({ kind: "unit-mismatch", label: "Unit mismatch: mA vs A" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/domain/parameters/singleParameterComparison.test.ts
```

Expected: FAIL because `src/domain/parameters/singleParameterComparison.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/domain/parameters/singleParameterComparison.ts`:

```ts
import type { ParameterRecord, Project } from "@/mockData";

export type SingleParameterComparisonRow = {
  projectId: string;
  projectCode: string;
  projectName: string;
  parameter: ParameterRecord | null;
  status: "configured" | "missing";
  currentValue: string;
  recommendedValue: string;
  risk: ParameterRecord["risk"] | "Missing";
  updatedAt: string;
  unit: string;
  unitMismatch: boolean;
  isBase: boolean;
  isTarget: boolean;
};

export type SingleParameterDelta =
  | { kind: "numeric"; direction: "up" | "down" | "same"; amount: number; percent: number | null; unit: string; label: string }
  | { kind: "text"; status: "changed" | "same"; label: string }
  | { kind: "missing"; label: string }
  | { kind: "unit-mismatch"; label: string };

export type SingleParameterProjectComparison = {
  rows: SingleParameterComparisonRow[];
  baseRow: SingleParameterComparisonRow | null;
  targetRow: SingleParameterComparisonRow | null;
  delta: SingleParameterDelta;
  coverage: { configured: number; missing: number; total: number };
  missingProjectIds: string[];
};

export type BuildSingleParameterProjectComparisonInput = {
  parameters: ParameterRecord[];
  projects: Project[];
  parameterName: string;
  baseProjectId: string;
  targetProjectId: string;
};

function formatValue(value: string | null | undefined, unit: string) {
  if (!value || value.trim() === "") {
    return "Not configured";
  }
  return `${value} ${unit}`.trim();
}

function parseNumeric(value: string | null | undefined) {
  if (!value || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function buildDelta(baseRow: SingleParameterComparisonRow | null, targetRow: SingleParameterComparisonRow | null): SingleParameterDelta {
  if (!targetRow || targetRow.status === "missing") {
    return { kind: "missing", label: "Target project is not configured" };
  }
  if (!baseRow || baseRow.status === "missing") {
    return { kind: "missing", label: "Base project is not configured" };
  }
  if (baseRow.unitMismatch || targetRow.unitMismatch || baseRow.unit !== targetRow.unit) {
    return { kind: "unit-mismatch", label: `Unit mismatch: ${baseRow.unit || "none"} vs ${targetRow.unit || "none"}` };
  }

  const baseNumeric = parseNumeric(baseRow.parameter?.currentValue);
  const targetNumeric = parseNumeric(targetRow.parameter?.currentValue);
  if (baseNumeric !== null && targetNumeric !== null) {
    const amount = targetNumeric - baseNumeric;
    const direction = amount > 0 ? "up" : amount < 0 ? "down" : "same";
    const percent = baseNumeric === 0 ? null : roundOne((amount / Math.abs(baseNumeric)) * 100);
    const signedAmount = `${amount > 0 ? "+" : ""}${roundOne(amount)} ${baseRow.unit}`.trim();
    const percentLabel = percent === null ? "" : ` (${percent > 0 ? "+" : ""}${percent.toFixed(1)}%)`;
    return {
      kind: "numeric",
      direction,
      amount: roundOne(Math.abs(amount)),
      percent,
      unit: baseRow.unit,
      label: `${signedAmount}${percentLabel}`
    };
  }

  const baseValue = baseRow.parameter?.currentValue ?? "";
  const targetValue = targetRow.parameter?.currentValue ?? "";
  if (baseValue === targetValue) {
    return { kind: "text", status: "same", label: "Same value" };
  }
  return { kind: "text", status: "changed", label: `${baseValue} -> ${targetValue}` };
}

export function buildSingleParameterProjectComparison({
  parameters,
  projects,
  parameterName,
  baseProjectId,
  targetProjectId
}: BuildSingleParameterProjectComparisonInput): SingleParameterProjectComparison {
  const matchingParameters = parameters.filter((parameter) => parameter.name === parameterName);
  const byProjectId = new Map(matchingParameters.map((parameter) => [parameter.projectId, parameter]));
  const baseParameter = byProjectId.get(baseProjectId) ?? null;
  const baseUnit = baseParameter?.unit ?? matchingParameters[0]?.unit ?? "";

  const rows = projects.map((project) => {
    const parameter = byProjectId.get(project.id) ?? null;
    const status = parameter ? "configured" : "missing";
    const unit = parameter?.unit ?? baseUnit;

    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      parameter,
      status,
      currentValue: parameter ? formatValue(parameter.currentValue, parameter.unit) : "Not configured",
      recommendedValue: parameter ? formatValue(parameter.recommendedValue, parameter.unit) : "Not configured",
      risk: parameter?.risk ?? "Missing",
      updatedAt: parameter?.updatedAt ?? "-",
      unit,
      unitMismatch: Boolean(parameter && baseUnit && parameter.unit !== baseUnit),
      isBase: project.id === baseProjectId,
      isTarget: project.id === targetProjectId
    } satisfies SingleParameterComparisonRow;
  });

  const baseRow = rows.find((row) => row.projectId === baseProjectId) ?? null;
  const targetRow = rows.find((row) => row.projectId === targetProjectId) ?? null;
  const configured = rows.filter((row) => row.status === "configured").length;
  const missingProjectIds = rows.filter((row) => row.status === "missing").map((row) => row.projectId);

  return {
    rows,
    baseRow,
    targetRow,
    delta: buildDelta(baseRow, targetRow),
    coverage: {
      configured,
      missing: rows.length - configured,
      total: rows.length
    },
    missingProjectIds
  };
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm test -- src/domain/parameters/singleParameterComparison.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper**

```bash
git add src/domain/parameters/singleParameterComparison.ts src/domain/parameters/singleParameterComparison.test.ts
git commit -m "feat: add single parameter comparison helper"
```

---

### Task 2: Parameter Detail Dialog Component

**Files:**
- Create: `src/components/ParameterDetailDialog.tsx`
- Create: `src/components/ParameterDetailDialog.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the failing dialog tests**

Create `src/components/ParameterDetailDialog.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterRecord, Project } from "@/mockData";
import { ParameterDetailDialog } from "./ParameterDetailDialog";

const projects: Project[] = [
  { id: "aurora", code: "AUR-Prod", name: "Aurora Production" },
  { id: "nebula", code: "NEB-RD", name: "Nebula Lab" },
  { id: "atlas", code: "ATL-Intl", name: "Atlas Intl" }
];

function parameter(projectId: string, value: string, patch: Partial<ParameterRecord> = {}): ParameterRecord {
  return {
    id: `${projectId}-fast-charge-current`,
    name: "fast_charge_current_limit_ma",
    description: "Fast charge input current limit",
    explanation: "Limits fast charge current to keep thermal load controlled.",
    configFormat: "charging.fast_charge_current_limit_ma=3850",
    module: "Charging Policy",
    projectId,
    currentValue: value,
    recommendedValue: "3200",
    range: "2500 - 4500",
    unit: "mA",
    risk: "High",
    updatedAt: "today 10:00",
    updatedAtTs: "2026-05-21T02:00:00.000Z",
    history: [
      { version: "v5.2", value: "3800", changedAt: "yesterday", changedBy: "Wang Jie" }
    ],
    ...patch
  };
}

const selectedParameter = parameter("aurora", "3850");
const allParameters = [
  selectedParameter,
  parameter("nebula", "4200"),
  parameter("atlas", "3000", { risk: "Medium", updatedAt: "yesterday" })
];

afterEach(() => {
  cleanup();
});

describe("ParameterDetailDialog", () => {
  it("shows definition and all-project comparison for the selected parameter", () => {
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /fast_charge_current_limit_ma/ });
    expect(within(dialog).getByText("Fast charge input current limit")).toBeInTheDocument();
    expect(within(dialog).getByText("Limits fast charge current to keep thermal load controlled.")).toBeInTheDocument();
    expect(within(dialog).getByText("charging.fast_charge_current_limit_ma=3850")).toBeInTheDocument();
    expect(within(dialog).getByText("v5.2")).toBeInTheDocument();
    expect(within(dialog).getByText("AUR-Prod")).toBeInTheDocument();
    expect(within(dialog).getByText("NEB-RD")).toBeInTheDocument();
    expect(within(dialog).getByText("ATL-Intl")).toBeInTheDocument();
    expect(within(dialog).getByText("+350 mA (+9.1%)")).toBeInTheDocument();
  });

  it("changes the emphasized target project", () => {
    const onTargetProjectChange = vi.fn();
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={onTargetProjectChange}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Emphasized comparison target"), { target: { value: "atlas" } });

    expect(onTargetProjectChange).toHaveBeenCalledWith("atlas");
  });

  it("adds the parameter to the draft or reports disabled and already-added states", () => {
    const onAddToDraft = vi.fn();
    const { rerender } = render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={onAddToDraft}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to modification draft" }));
    expect(onAddToDraft).toHaveBeenCalledTimes(1);

    rerender(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft
        onTargetProjectChange={vi.fn()}
        onAddToDraft={onAddToDraft}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Already in draft" })).toBeDisabled();

    rerender(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit={false}
        disabledReason="Requires parameter edit permission."
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={onAddToDraft}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Add to modification draft" })).toBeDisabled();
    expect(screen.getByText("Requires parameter edit permission.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run dialog tests to verify they fail**

Run:

```bash
npm test -- src/components/ParameterDetailDialog.test.tsx
```

Expected: FAIL because `ParameterDetailDialog` does not exist.

- [ ] **Step 3: Implement `ParameterDetailDialog`**

Create `src/components/ParameterDetailDialog.tsx`:

```tsx
import { X } from "lucide-react";
import type { ParameterRecord, Project } from "@/mockData";
import {
  buildSingleParameterProjectComparison,
  type SingleParameterComparisonRow
} from "@/domain/parameters/singleParameterComparison";

export type ParameterDetailDialogProps = {
  parameter: ParameterRecord;
  parameters: ParameterRecord[];
  projects: Project[];
  currentProjectId: string;
  targetProjectId: string;
  canEdit: boolean;
  disabledReason?: string;
  alreadyInDraft: boolean;
  onTargetProjectChange: (projectId: string) => void;
  onAddToDraft: () => void;
  onClose: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="parameter-detail-field">
      <dt>{label}</dt>
      <dd>{value || "-"}</dd>
    </div>
  );
}

function rowTone(row: SingleParameterComparisonRow) {
  if (row.isBase) return "base";
  if (row.isTarget) return "target";
  if (row.status === "missing") return "missing";
  return "configured";
}

export function ParameterDetailDialog({
  parameter,
  parameters,
  projects,
  currentProjectId,
  targetProjectId,
  canEdit,
  disabledReason,
  alreadyInDraft,
  onTargetProjectChange,
  onAddToDraft,
  onClose
}: ParameterDetailDialogProps) {
  const comparison = buildSingleParameterProjectComparison({
    parameters,
    projects,
    parameterName: parameter.name,
    baseProjectId: currentProjectId,
    targetProjectId
  });
  const draftDisabled = !canEdit || alreadyInDraft;
  const draftLabel = alreadyInDraft ? "Already in draft" : "Add to modification draft";

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="parameter-detail-title">
      <div className="parameter-detail-dialog">
        <header className="parameter-detail-dialog__header">
          <div>
            <span className="eyebrow">{parameter.module} / {parameter.risk}</span>
            <h2 id="parameter-detail-title">{parameter.name}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close parameter detail" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="parameter-detail-dialog__body">
          <section className="parameter-detail-panel" aria-label="Parameter definition">
            <div className="parameter-detail-panel__head">
              <h3>Parameter definition</h3>
              <span>{parameter.projectId}</span>
            </div>
            <dl className="parameter-detail-grid">
              <Field label="Current value" value={`${parameter.currentValue} ${parameter.unit}`.trim()} />
              <Field label="Recommended value" value={`${parameter.recommendedValue} ${parameter.unit}`.trim()} />
              <Field label="Range" value={`${parameter.range} ${parameter.unit}`.trim()} />
              <Field label="Updated" value={parameter.updatedAt} />
            </dl>
            <div className="parameter-detail-copy">
              <strong>Description</strong>
              <p>{parameter.description}</p>
            </div>
            <div className="parameter-detail-copy">
              <strong>Explanation</strong>
              <p>{parameter.explanation}</p>
            </div>
            <div className="parameter-detail-copy">
              <strong>Config format</strong>
              <code>{parameter.configFormat || "-"}</code>
            </div>
            {parameter.history.length > 0 ? (
              <div className="parameter-detail-history">
                <strong>Recent history</strong>
                <ul>
                  {parameter.history.slice(0, 3).map((entry) => (
                    <li key={`${entry.version}-${entry.changedAt}`}>
                      <span>{entry.version}</span>
                      <span>{entry.value}</span>
                      <small>{entry.changedAt} / {entry.changedBy}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="parameter-detail-panel" aria-label="Cross-project comparison">
            <div className="parameter-detail-panel__head">
              <div>
                <h3>Cross-project comparison</h3>
                <span>{comparison.coverage.configured}/{comparison.coverage.total} projects configured</span>
              </div>
              <label className="parameter-detail-target">
                <span>Target</span>
                <select
                  aria-label="Emphasized comparison target"
                  value={targetProjectId}
                  onChange={(event) => onTargetProjectChange(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id} disabled={project.id === currentProjectId}>
                      {project.code} {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="parameter-detail-delta" data-kind={comparison.delta.kind}>
              <span>Focused delta</span>
              <strong>{comparison.delta.label}</strong>
            </div>

            <div className="parameter-detail-comparison-list" role="table" aria-label="Project parameter values">
              <div className="parameter-detail-comparison-list__head" role="row">
                <span role="columnheader">Project</span>
                <span role="columnheader">Current</span>
                <span role="columnheader">Recommended</span>
                <span role="columnheader">Risk</span>
              </div>
              {comparison.rows.map((row) => (
                <div className="parameter-detail-comparison-row" data-tone={rowTone(row)} key={row.projectId} role="row">
                  <span role="cell">
                    <strong>{row.projectCode}</strong>
                    <small>{row.projectName}</small>
                    {row.isBase ? <em>Base</em> : null}
                    {row.isTarget ? <em>Target</em> : null}
                  </span>
                  <span role="cell">{row.currentValue}</span>
                  <span role="cell">{row.recommendedValue}</span>
                  <span role="cell">{row.unitMismatch ? `${row.risk} / unit mismatch` : row.risk}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="parameter-detail-dialog__footer">
          {disabledReason && !alreadyInDraft ? <span className="parameter-detail-disabled-reason">{disabledReason}</span> : <span />}
          <button className="button subtle" type="button" onClick={onClose}>
            Close
          </button>
          <button className="button primary" type="button" disabled={draftDisabled} onClick={onAddToDraft}>
            {draftLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add focused modal styles**

Add to `src/styles.css` near the other parameter workbench styles:

```css
.parameter-detail-dialog {
  width: min(1120px, calc(100vw - 32px));
  max-height: calc(100vh - 40px);
  overflow: hidden;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.parameter-detail-dialog__header,
.parameter-detail-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.24);
}

.parameter-detail-dialog__footer {
  border-top: 1px solid rgba(148, 163, 184, 0.24);
  border-bottom: 0;
}

.parameter-detail-dialog__header h2 {
  margin: 4px 0 0;
  font-size: 22px;
  letter-spacing: 0;
}

.parameter-detail-dialog__body {
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: minmax(280px, 0.85fr) minmax(360px, 1.15fr);
  gap: 14px;
  padding: 16px 20px 20px;
  background: #f8fafc;
}

.parameter-detail-panel {
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 12px;
  background: #ffffff;
  padding: 14px;
  min-width: 0;
}

.parameter-detail-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.parameter-detail-panel__head h3 {
  margin: 0;
  font-size: 15px;
}

.parameter-detail-panel__head span,
.parameter-detail-target span,
.parameter-detail-field dt,
.parameter-detail-history small {
  color: #64748b;
  font-size: 12px;
}

.parameter-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0 0 12px;
}

.parameter-detail-field {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 10px;
  padding: 9px 10px;
  min-width: 0;
}

.parameter-detail-field dd {
  margin: 3px 0 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.parameter-detail-copy,
.parameter-detail-history {
  display: grid;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.parameter-detail-copy + .parameter-detail-copy,
.parameter-detail-history {
  margin-top: 12px;
}

.parameter-detail-copy p {
  margin: 0;
  color: #334155;
  line-height: 1.5;
}

.parameter-detail-copy code {
  display: block;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f1f5f9;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.parameter-detail-history ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.parameter-detail-history li {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.parameter-detail-target {
  display: flex;
  align-items: center;
  gap: 8px;
}

.parameter-detail-target select {
  height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 8px;
  background: #ffffff;
  padding: 0 10px;
}

.parameter-detail-delta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 10px;
  background: #eef6ff;
  color: #0f3f70;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.parameter-detail-delta span {
  font-size: 12px;
}

.parameter-detail-comparison-list {
  display: grid;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 10px;
  overflow: hidden;
}

.parameter-detail-comparison-list__head,
.parameter-detail-comparison-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(90px, 0.7fr) minmax(110px, 0.8fr) minmax(80px, 0.6fr);
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
}

.parameter-detail-comparison-list__head {
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.parameter-detail-comparison-row {
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.parameter-detail-comparison-row[data-tone="base"] {
  background: #f0fdf4;
}

.parameter-detail-comparison-row[data-tone="target"] {
  background: #eff6ff;
}

.parameter-detail-comparison-row[data-tone="missing"] {
  color: #64748b;
  background: #f8fafc;
}

.parameter-detail-comparison-row strong,
.parameter-detail-comparison-row small,
.parameter-detail-comparison-row em {
  display: block;
}

.parameter-detail-comparison-row em {
  width: fit-content;
  margin-top: 4px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  padding: 2px 7px;
  color: #334155;
  font-size: 11px;
  font-style: normal;
}

.parameter-detail-disabled-reason {
  color: #9a3412;
  font-size: 13px;
}

@media (max-width: 860px) {
  .parameter-detail-dialog__body {
    grid-template-columns: 1fr;
  }

  .parameter-detail-comparison-list__head {
    display: none;
  }

  .parameter-detail-comparison-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
```

- [ ] **Step 5: Run dialog tests**

Run:

```bash
npm test -- src/components/ParameterDetailDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit dialog component**

```bash
git add src/components/ParameterDetailDialog.tsx src/components/ParameterDetailDialog.test.tsx src/styles.css
git commit -m "feat: add parameter detail comparison dialog"
```

---

### Task 3: Table View Action

**Files:**
- Modify: `src/components/ParametersTable.tsx`
- Modify: `src/components/ParametersTable.test.tsx`

- [ ] **Step 1: Add failing table tests for the view action**

Append to the existing `describe("ParametersTable", () => { ... })` block in `src/components/ParametersTable.test.tsx`:

```tsx
  it("renders a view action for each row and does not focus the row when clicked", () => {
    const onViewRow = vi.fn();
    const { onFocusRow } = setup({ onViewRow });

    fireEvent.click(screen.getByRole("button", { name: "View fast_charge_current_limit_ma" }));

    expect(onViewRow).toHaveBeenCalledWith("p1");
    expect(onFocusRow).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run table test to verify it fails**

Run:

```bash
npm test -- src/components/ParametersTable.test.tsx -t "renders a view action"
```

Expected: FAIL because `ParametersTableProps` has no `onViewRow` prop and no view button.

- [ ] **Step 3: Add the table prop and render the view button**

In `src/components/ParametersTable.tsx`, update imports:

```tsx
import { Eye, Pencil, Search } from "lucide-react";
```

Add the prop to `ParametersTableProps`:

```ts
  onViewRow?: (id: string) => void;
```

Destructure it in `ParametersTable`:

```ts
  onEditRow,
  onViewRow,
  stashedIds,
```

Replace the operation cell contents with this structure:

```tsx
                <td data-label="鎿嶄綔">
                  <div className="parameter-row-actions">
                    <button
                      type="button"
                      className="view-row-button"
                      aria-label={`View ${row.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onViewRow?.(row.id);
                      }}
                    >
                      <Eye size={15} />
                    </button>
                    {canEdit ? (
                      <button
                        type="button"
                        className="edit-row-button"
                        aria-label={`缂栬緫 ${row.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditRow?.(row.id);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                    ) : (
                      <span className="permission-muted-action">Read only</span>
                    )}
                  </div>
                </td>
```

Add this small style block near existing table button styles in `src/styles.css` if `.edit-row-button` does not already share layout:

```css
.parameter-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.view-row-button,
.edit-row-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 4: Run table tests**

Run:

```bash
npm test -- src/components/ParametersTable.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit table action**

```bash
git add src/components/ParametersTable.tsx src/components/ParametersTable.test.tsx src/styles.css
git commit -m "feat: add parameter table view action"
```

---

### Task 4: Wire Modal Into Parameters Page

**Files:**
- Modify: `src/ParametersPage.tsx`
- Modify: `src/ParametersPage.test.tsx`

- [ ] **Step 1: Add failing page tests for modal workflow**

Append to `src/ParametersPage.test.tsx` under the existing `describe("ParametersPage draft edge cases", () => { ... })` block:

```tsx
  it("opens parameter detail without changing routes and shows cross-project comparison", () => {
    window.history.replaceState(null, "", "/parameters");
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "View fast_charge_current_limit_ma" }));

    expect(window.location.pathname).toBe("/parameters");
    const dialog = screen.getByRole("dialog", { name: /fast_charge_current_limit_ma/ });
    expect(within(dialog).getByRole("region", { name: "Parameter definition" })).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Cross-project comparison" })).toBeInTheDocument();
    expect(within(dialog).getByText("AUR-Prod")).toBeInTheDocument();
    expect(within(dialog).getByText("NEB-RD")).toBeInTheDocument();
    expect(within(dialog).getByText("ATL-Intl")).toBeInTheDocument();
  });

  it("changes the emphasized project and adds the viewed parameter to the draft sheet", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "View fast_charge_current_limit_ma" }));
    fireEvent.change(screen.getByLabelText("Emphasized comparison target"), { target: { value: "atlas" } });

    expect(screen.getByText("-850 mA (-22.1%)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add to modification draft" }));

    expect(screen.getByRole("dialog", { name: "淇敼鑽夌" })).toBeInTheDocument();
    expect(screen.getByText("鏈疆鎻愪氦 1 椤?)).toBeInTheDocument();
  });

  it("keeps parameter detail viewable but disables draft action for read-only users", () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={{ ...initialState, activeRoleId: "guest" }}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    fireEvent.click(screen.getByRole("button", { name: "View fast_charge_current_limit_ma" }));

    expect(screen.getByRole("dialog", { name: /fast_charge_current_limit_ma/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to modification draft" })).toBeDisabled();
    expect(screen.getByText("闇€瑕?User 瑙掕壊鎵嶈兘缂栬緫銆佹殏瀛樻垨鎻愪氦鍙傛暟鍙樻洿銆?)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Update the existing topbar action test expectation**

In `src/ParametersPage.test.tsx`, find the test named `uses subtle-style topbar actions with AI audit as the only primary action`. Replace the labels array:

```tsx
    ["瀵煎嚭 Excel", "鍘嗗彶鎻愪氦"].forEach((label) => {
      const action = within(topbar as HTMLElement).getByRole("button", { name: label });
      expect(action).toHaveClass("button", "subtle");
    });
    expect(within(topbar as HTMLElement).queryByRole("button", { name: "璺ㄩ」鐩姣? })).not.toBeInTheDocument();
```

- [ ] **Step 3: Run page tests to verify they fail**

Run:

```bash
npm test -- src/ParametersPage.test.tsx -t "parameter detail"
```

Expected: FAIL because the modal is not wired into `ParametersPage`.

- [ ] **Step 4: Wire state and callbacks in `ParametersPage`**

In `src/ParametersPage.tsx`, add import:

```tsx
import { ParameterDetailDialog } from "./components/ParameterDetailDialog";
```

Add state near existing sheet state:

```tsx
  const [viewingParameterId, setViewingParameterId] = useState<string | null>(null);
  const [comparisonTargetProjectId, setComparisonTargetProjectId] = useState<string>("");
```

Add derived values after `activeProject` is defined:

```tsx
  const comparisonTargetOptions = runtimeProjects.filter((project) => project.id !== resolvedProjectId);
  const effectiveComparisonTargetProjectId =
    comparisonTargetProjectId && comparisonTargetProjectId !== resolvedProjectId
      ? comparisonTargetProjectId
      : comparisonTargetOptions[0]?.id ?? resolvedProjectId;
  const viewingParameter = viewingParameterId ? parameterById.get(viewingParameterId) ?? null : null;
  const draftDisabledReason = initializationLocked
    ? "璇ラ」鐩彲鏌ョ湅锛屽垵濮嬪寲閫氳繃鍓嶆殏涓嶅彲鎻愪氦鏅€氬弬鏁板彉鏇淬€?
    : !canEdit
      ? "闇€瑕?User 瑙掕壊鎵嶈兘缂栬緫銆佹殏瀛樻垨鎻愪氦鍙傛暟鍙樻洿銆?
      : undefined;
```

Add handlers near `handleEditRow`:

```tsx
  const handleViewRow = (id: string) => {
    const parameter = parameterById.get(id);
    if (!parameter) {
      return;
    }
    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
    setViewingParameterId(parameter.id);
    setComparisonTargetProjectId((current) =>
      current && current !== parameter.projectId
        ? current
        : runtimeProjects.find((project) => project.id !== parameter.projectId)?.id ?? parameter.projectId
    );
  };

  const addViewingParameterToDraft = () => {
    if (!viewingParameter) {
      return;
    }
    handleEditRow(viewingParameter.id);
  };
```

Pass `onViewRow={handleViewRow}` to both `ParametersTable` instances:

```tsx
                onViewRow={handleViewRow}
```

Remove the standalone comparison topbar button from `useTopBarActions`:

```tsx
      <button className="button subtle" type="button" onClick={() => onNavigate("/parameter-submissions")}>
        鍘嗗彶鎻愪氦
      </button>
```

Add the dialog render before `ParameterSubmissionDialog`:

```tsx
      {viewingParameter ? (
        <ParameterDetailDialog
          parameter={viewingParameter}
          parameters={state.parameters}
          projects={runtimeProjects}
          currentProjectId={resolvedProjectId}
          targetProjectId={effectiveComparisonTargetProjectId}
          canEdit={effectiveCanEdit}
          disabledReason={draftDisabledReason}
          alreadyInDraft={Boolean(drafts[viewingParameter.id])}
          onTargetProjectChange={setComparisonTargetProjectId}
          onAddToDraft={addViewingParameterToDraft}
          onClose={() => setViewingParameterId(null)}
        />
      ) : null}
```

- [ ] **Step 5: Run page tests**

Run:

```bash
npm test -- src/ParametersPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit page integration**

```bash
git add src/ParametersPage.tsx src/ParametersPage.test.tsx
git commit -m "feat: wire parameter detail modal into workbench"
```

---

### Task 5: Retire Standalone Comparison Navigation And Route

**Files:**
- Create: `src/components/NoEntryPage.tsx`
- Create: `src/components/NoEntryPage.test.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/appConfig.ts`
- Modify: `src/ParameterManagementHomePage.tsx`
- Modify: `src/ParameterManagementHomePage.test.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write `NoEntryPage` test**

Create `src/components/NoEntryPage.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoEntryPage } from "./NoEntryPage";

afterEach(() => {
  cleanup();
});

describe("NoEntryPage", () => {
  it("renders an accessible retired-route state with a workbench action", () => {
    const onNavigate = vi.fn();
    render(
      <NoEntryPage
        title="Comparison workspace unavailable"
        description="Use the View action in the parameter table to compare a parameter across projects."
        actionLabel="Back to parameter workbench"
        actionPath="/parameters"
        onNavigate={onNavigate}
      />
    );

    expect(screen.getByRole("region", { name: "Comparison workspace unavailable" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to parameter workbench" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameters");
  });
});
```

- [ ] **Step 2: Implement `NoEntryPage`**

Create `src/components/NoEntryPage.tsx`:

```tsx
type NoEntryPageProps = {
  title: string;
  description: string;
  actionLabel: string;
  actionPath: string;
  onNavigate: (path: string) => void;
};

export function NoEntryPage({ title, description, actionLabel, actionPath, onNavigate }: NoEntryPageProps) {
  return (
    <section className="no-entry-page" aria-label={title}>
      <span className="eyebrow">No entry</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="button primary" type="button" onClick={() => onNavigate(actionPath)}>
        {actionLabel}
      </button>
    </section>
  );
}
```

Add styles to `src/styles.css`:

```css
.no-entry-page {
  min-height: min(560px, calc(100vh - 180px));
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: #ffffff;
  padding: 32px;
}

.no-entry-page h2 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 0;
}

.no-entry-page p {
  max-width: 560px;
  margin: 0;
  color: #64748b;
  line-height: 1.55;
}
```

- [ ] **Step 3: Update route test expectations in `App.test.tsx`**

Replace the test named `opens a parameter comparison workspace from the compare action` with:

```tsx
  it("does not expose standalone comparison from the parameter workbench", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    expect(screen.queryByRole("button", { name: "璺ㄩ」鐩姣? })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View fast_charge_current_limit_ma" })).toBeInTheDocument();
  });
```

Add a new retired route test near the route tests:

```tsx
  it("renders a no-entry state for the retired parameter comparison route", () => {
    window.history.replaceState(null, "", "/parameter-comparison");

    renderAppForCurrentPath();

    expect(window.location.pathname).toBe("/parameter-comparison");
    expect(screen.getByRole("region", { name: "Parameter comparison moved" })).toBeInTheDocument();
    expect(screen.queryByTestId("comparison-page-v2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to parameter workbench" }));
    expect(window.location.pathname).toBe("/parameters");
  });
```

Remove or rewrite tests that assert old comparison matrix behavior:

- `exports the project comparison matrix as an Excel-readable file`
- `compares parameter values between two real projects with project chips and delta badges`
- `consumes parameter comparison context from query strings`
- `filters the parameter comparison matrix and shows parameter meanings`
- `keeps comparison insights inside the floating WiseAgent after opening it`

Those tests should be deleted because their page no longer exists.

- [ ] **Step 4: Update homepage quick-entry test**

In `src/ParameterManagementHomePage.test.tsx`, add this assertion to `renders compact homepage content without large entry cards`:

```tsx
    expect(screen.queryByRole("button", { name: "瀵规瘮鍒嗘瀽" })).not.toBeInTheDocument();
```

- [ ] **Step 5: Implement route and navigation changes**

In `src/app/routes.tsx`:

Remove imports:

```ts
import { ParameterComparisonPage } from "@/ParameterComparison";
import type { ComparisonProjectSelection } from "@/ParameterComparison/types";
```

Add import:

```ts
import { NoEntryPage } from "@/components/NoEntryPage";
```

Remove these props from `PageRouterProps`:

```ts
  comparisonSelection: ComparisonProjectSelection;
  onComparisonSelectionChange: Dispatch<SetStateAction<ComparisonProjectSelection>>;
  onSearchChange: (search: string) => void;
```

Remove destructured values with the same names from `PageRouter`.

Replace `case "parameter-comparison":` with:

```tsx
    case "parameter-comparison":
      return (
        <NoEntryPage
          title="Parameter comparison moved"
          description="Cross-project comparison is now available from each parameter row in the user workbench. Open a parameter with View to inspect its definition and project values."
          actionLabel="Back to parameter workbench"
          actionPath="/parameters"
          onNavigate={onNavigate}
        />
      );
```

In `src/appConfig.ts`, remove the `parameter-comparison` object from `navigationItems`. Add this branch inside `getPageByPath` before the final return:

```ts
  if (path === "/parameter-comparison") {
    return {
      key: "parameter-comparison",
      path: "/parameter-comparison",
      label: "Comparison unavailable",
      group: "鍙傛暟绠＄悊",
      icon: SlidersHorizontal,
      title: "Parameter comparison moved",
      subtitle: "Use the View action in the parameter table to compare one parameter across projects."
    };
  }
```

In `src/ParameterManagementHomePage.tsx`, remove this quick entry:

```ts
  { title: "瀵规瘮鍒嗘瀽", path: "/parameter-comparison" },
```

- [ ] **Step 6: Run route and homepage tests**

Run:

```bash
npm test -- src/components/NoEntryPage.test.tsx src/ParameterManagementHomePage.test.tsx src/App.test.tsx
```

Expected: PASS after stale old comparison expectations are removed.

- [ ] **Step 7: Commit route retirement**

```bash
git add src/components/NoEntryPage.tsx src/components/NoEntryPage.test.tsx src/styles.css src/app/routes.tsx src/appConfig.ts src/ParameterManagementHomePage.tsx src/ParameterManagementHomePage.test.tsx src/App.test.tsx
git commit -m "feat: retire standalone parameter comparison route"
```

---

### Task 6: Remove Comparison Selection Plumbing And Agent Dependency

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/features/agent/UnifiedAgent.tsx`
- Modify: `src/features/agent/UnifiedAgent.test.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Update `UnifiedAgent` tests first**

In `src/features/agent/UnifiedAgent.test.tsx`, remove:

```ts
const comparisonSelection = {
  baseProjectId: "aurora",
  targetProjectId: "nebula"
};
```

Remove `comparisonSelection={comparisonSelection}` from both `UnifiedAgent` renders.

Run:

```bash
npm test -- src/features/agent/UnifiedAgent.test.tsx
```

Expected: FAIL because `UnifiedAgent` still requires `comparisonSelection`.

- [ ] **Step 2: Simplify `UnifiedAgent` props**

In `src/features/agent/UnifiedAgent.tsx`, remove:

```ts
import { projects, type PrototypeState } from "@/mockData";
import type { ComparisonProjectSelection } from "@/ParameterComparison/types";
```

Replace with:

```ts
import type { PrototypeState } from "@/mockData";
```

Delete the full `createComparisonInsights` function.

Change the function signature from:

```tsx
export function UnifiedAgent({
  path,
  plan,
  state,
  dispatch,
  comparisonSelection
}: {
  path: string;
  plan: ReturnType<typeof createAgentPlan>;
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  comparisonSelection: ComparisonProjectSelection;
}) {
```

to:

```tsx
export function UnifiedAgent({
  path,
  plan,
  state,
  dispatch
}: {
  path: string;
  plan: ReturnType<typeof createAgentPlan>;
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
}) {
```

Remove:

```ts
  const comparisonInsights = path === "/parameter-comparison" ? createComparisonInsights(state, comparisonSelection) : null;
```

Remove the entire JSX block guarded by `{comparisonInsights ? (...) : null}`.

- [ ] **Step 3: Remove comparison state from `App.tsx`**

In `src/App.tsx`, remove:

```ts
import type { ComparisonProjectSelection } from "@/ParameterComparison/types";
```

Remove the `comparisonSelection` state block:

```tsx
  const [comparisonSelection, setComparisonSelection] = useState<ComparisonProjectSelection>(() => {
    const comparisonProjects = getComparisonProjects(initialAppState);
    const contextProjectId =
      getPageByPath(window.location.pathname).key === "parameter-comparison" ? getContextQuery(window.location.search).projectId : "";
    const baseProjectId = comparisonProjects.some((project) => project.id === contextProjectId)
      ? contextProjectId
      : state.activeProjectId;

    return {
      baseProjectId,
      targetProjectId: getFallbackComparisonProjectId(baseProjectId, comparisonProjects)
    };
  });
```

Remove the `useEffect` that updates `comparisonSelection` based on `page.key`, `search`, `state.activeProjectId`, and `state.configDraft.projects`.

Remove `comparisonSelection`, `onComparisonSelectionChange`, and `onSearchChange` props from both `PageRouter` calls.

Change the `UnifiedAgent` render to:

```tsx
        <UnifiedAgent path={path} plan={agentPlan} state={state} dispatch={dispatch} />
```

If `getComparisonProjects` or `getFallbackComparisonProjectId` become unused in `App.tsx`, remove their definitions.

- [ ] **Step 4: Run app and agent tests**

Run:

```bash
npm test -- src/features/agent/UnifiedAgent.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit plumbing cleanup**

```bash
git add src/App.tsx src/features/agent/UnifiedAgent.tsx src/features/agent/UnifiedAgent.test.tsx src/App.test.tsx
git commit -m "refactor: remove standalone comparison state plumbing"
```

---

### Task 7: Delete Retired Comparison Page Code

**Files:**
- Delete: retired comparison page files and tests no longer imported.
- Modify: `src/app/permissions.test.ts`
- Modify: `src/app/permissions.ts` only if the retained synthetic route should stay guest-accessible.
- Modify: `src/App.test.tsx` if snapshots or route lists still mention navigation exposure.

- [ ] **Step 1: Confirm no imports remain**

Run:

```bash
rg -n "ParameterComparison|comparisonSelection|useParameterComparisonViewModel|comparison-page-v2|exportComparisonRowsAsExcel|ComparisonMatrix|ComparisonHeader|ComparisonFilterBar" src
```

Expected: only files inside `src/ParameterComparison`, `src/features/parameter-comparison`, or deleted old tests still match.

- [ ] **Step 2: Delete retired files**

Delete these paths after Step 1 confirms they are not imported by live code:

```bash
git rm -r src/ParameterComparison
git rm -r src/features/parameter-comparison
```

If `git rm -r` reports a path does not exist because earlier tasks removed it, continue with the remaining path.

- [ ] **Step 3: Re-run search**

Run:

```bash
rg -n "ParameterComparison|comparisonSelection|useParameterComparisonViewModel|comparison-page-v2|exportComparisonRowsAsExcel|ComparisonMatrix|ComparisonHeader|ComparisonFilterBar" src
```

Expected: no output.

- [ ] **Step 4: Keep or adjust permission behavior**

Run:

```bash
npm test -- src/app/permissions.test.ts
```

Expected: PASS if `parameter-comparison` remains guest-accessible as a retired no-entry route. If the test fails because route expectations changed, update the assertion to:

```ts
expect(canAccessPage("guest", "parameter-comparison")).toBe(true);
```

This keeps direct URL access able to show the no-entry state instead of a permission-denied page.

- [ ] **Step 5: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS with no missing imports.

- [ ] **Step 6: Commit deletion**

```bash
git add src appConfig.ts
git add -u
git commit -m "refactor: delete retired parameter comparison page"
```

If `git add src appConfig.ts` fails because `appConfig.ts` is under `src/appConfig.ts`, use:

```bash
git add src
git add -u
git commit -m "refactor: delete retired parameter comparison page"
```

---

### Task 8: Full Verification And Browser QA

**Files:**
- No planned source edits unless verification finds a defect.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm test -- src/domain/parameters/singleParameterComparison.test.ts src/components/ParameterDetailDialog.test.tsx src/components/ParametersTable.test.tsx src/ParametersPage.test.tsx src/components/NoEntryPage.test.tsx src/ParameterManagementHomePage.test.tsx src/features/agent/UnifiedAgent.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Start local dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`. Keep the server running for browser QA.

- [ ] **Step 5: Browser QA for `/parameters`**

Open `http://127.0.0.1:5173/parameters`.

Verify:

- Parameter table operation column has a view icon/button for rows.
- Clicking "View fast_charge_current_limit_ma" opens a modal.
- URL remains `/parameters`.
- Modal uses the two-column layout.
- Definition column shows description, explanation, config format, and history.
- Comparison column shows all projects.
- Changing target project updates the focused delta.
- "Add to modification draft" opens the existing draft sheet.
- Closing the modal leaves the draft sheet usable.

- [ ] **Step 6: Browser QA for retired route and navigation**

Open `http://127.0.0.1:5173/parameter-comparison`.

Verify:

- Page shows no-entry state.
- Old comparison matrix does not appear.
- "Back to parameter workbench" navigates to `/parameters`.
- Sidebar and parameter homepage do not advertise comparison analysis as a separate page.

- [ ] **Step 7: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional source changes are present, or clean if every task committed.

---

## Self-Review Checklist

- Spec coverage: Tasks cover helper semantics, modal layout, row entry point, draft integration, navigation removal, retired route, agent cleanup, deletion of old page code, tests, build, and browser QA.
- Placeholder scan: The plan contains no placeholder markers or unspecified implementation steps.
- Type consistency: `buildSingleParameterProjectComparison`, `ParameterDetailDialog`, `onViewRow`, and `NoEntryPage` signatures are introduced before later tasks use them.
- Scope: The plan does not add sync, export, approval, or backend behavior.
