# 批量参数导入向导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder parameter import dialog with a five-step wizard that supports spreadsheet/JSON/DTS sources, Step 1 mandatory target project selection (including create project), per-row review with diff/edit/skip, and new-parameter prefill — then applies via existing import batch APIs.

**Architecture:** Browser-side format detection and parsing adapters produce `ParsedImportRow[]`, matched to the library by `name + module` against the selected target project. A React wizard collects review decisions, maps approved rows to `ParameterImportSourceItem[]`, and calls existing `createImportPreview` / `applyImportBatch`. No backend file upload in P1.

**Tech Stack:** React 19, Vitest, SheetJS (`xlsx`, already in repo), existing `ParameterRepository` HTTP/mock ports, `ProjectAdminFormDialog`, `ParameterDefinitionForm`.

**Design spec:** `docs/zh-CN/superpowers/specs/2026-07-06-parameter-batch-import-design.md`

**Scope:** **P1 only** in this plan (wizard + spreadsheet + JSON + DTS fragment + review). P2 (full DTS file + module heuristics) and P3 (audit reviewMetadata, server-side DTS) go to tech-debt after P1 ships.

---

## File Map

| File | Responsibility |
| --- | --- |
| `src/application/parameters/import/types.ts` | `ParsedImportRow`, `ImportReviewStatus`, wizard state types |
| `src/application/parameters/import/columnMap.ts` | Chinese ↔ field mapping for wide template |
| `src/application/parameters/import/normalizeRow.ts` | Risk/valueKind normalization, required field validation |
| `src/application/parameters/import/matchToLibrary.ts` | Match `name + module` to existing definitions + project values |
| `src/application/parameters/import/parseJson.ts` | JSON array / `{ items }` parser |
| `src/application/parameters/import/parseSpreadsheet.ts` | `.xlsx` + `.csv` wide-table parser |
| `src/application/parameters/import/parseDtsFragment.ts` | P1: paste / single-property DTS fragments |
| `src/application/parameters/import/detectImportFormat.ts` | Format detection from file name + content |
| `src/application/parameters/import/buildImportTemplate.ts` | Downloadable admin `.xlsx` template |
| `src/application/parameters/import/toSourceItems.ts` | Approved reviewed rows → `ParameterImportSourceItem[]` |
| `src/components/ParameterImportWizard/ParameterImportWizard.tsx` | Wizard shell, step routing, state |
| `src/components/ParameterImportWizard/steps/StepSourceAndProject.tsx` | Step 1 |
| `src/components/ParameterImportWizard/steps/StepParseReport.tsx` | Step 2 |
| `src/components/ParameterImportWizard/steps/StepRowReview.tsx` | Step 3 |
| `src/components/ParameterImportWizard/steps/StepBatchPreview.tsx` | Step 4 |
| `src/components/ParameterImportWizard/steps/StepConfirmApply.tsx` | Step 5 |
| `src/components/ParameterImportWizard/ImportReviewCard.tsx` | Single-row diff / edit / skip UI |
| `src/ParameterAdminPage.tsx` | Open wizard; remove inline `parseImportItems` + old dialog |
| `src/styles.css` | `.parameter-import-wizard*` scoped styles |

---

## Git & PR Workflow

- Branch: `feat/parameter-batch-import-wizard` from latest `main`
- Implementation agent: commit on feature branch only; do not open/merge PR
- Parent agent: verify, open PR, merge, sync `main`

---

## Task 1: Import domain types and column map

**Files:**
- Create: `src/application/parameters/import/types.ts`
- Create: `src/application/parameters/import/columnMap.ts`
- Create: `src/application/parameters/import/columnMap.test.ts`

- [ ] **Step 1: Write failing test for column map**

```typescript
// src/application/parameters/import/columnMap.test.ts
import { describe, expect, it } from "vitest";
import { IMPORT_TEMPLATE_HEADERS, mapRowRecordToFields } from "./columnMap";

describe("columnMap", () => {
  it("maps Chinese template headers to internal fields", () => {
    const row = mapRowRecordToFields({
      "参数名称": "fast_charge_current_limit_ma",
      "模块": "Charging Policy",
      "当前值": "3200",
      "推荐值": "3400",
      "范围": "2500 - 4500",
      "单位": "mA",
      "重要性": "高"
    });
    expect(row.name).toBe("fast_charge_current_limit_ma");
    expect(row.module).toBe("Charging Policy");
    expect(row.risk).toBe("High");
  });

  it("exports stable template header order", () => {
    expect(IMPORT_TEMPLATE_HEADERS[0]).toBe("参数名称");
    expect(IMPORT_TEMPLATE_HEADERS).toContain("值类型");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- src/application/parameters/import/columnMap.test.ts --run`

- [ ] **Step 3: Implement types + columnMap**

```typescript
// src/application/parameters/import/types.ts
import type { ParameterImportSourceItem } from "@/application/ports/ParameterRepository";
import type { ParameterRecord } from "@/mockData";
import type { ParameterValueKind } from "@/powerManagementConfig";

export type ImportSourceFormat = "spreadsheet" | "json" | "dts-fragment" | "dts-full";

export type ImportReviewStatus =
  | "pending"
  | "approved"
  | "skipped"
  | "needs-module"
  | "conflict"
  | "new-confirmed";

export type ParsedImportRow = {
  name: string;
  module: string;
  currentValue?: string;
  recommendedValue?: string;
  range?: string;
  unit?: string;
  risk?: ParameterImportSourceItem["risk"];
  description?: string;
  explanation?: string;
  configFormat?: string;
  valueKind?: ParameterValueKind;
  sourceFormat: ImportSourceFormat;
  sourceLocation?: string;
  rawSnippet?: string;
  parseWarnings?: string[];
};

export type ReviewedImportRow = ParsedImportRow & {
  rowId: string;
  status: ImportReviewStatus;
  skipReason?: string;
  existingParameter?: ParameterRecord;
  matchKey: string;
};

export type ImportWizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  targetProjectId: string;
  sourceName: string;
  sourceFormat: ImportSourceFormat | null;
  parsedRows: ParsedImportRow[];
  reviewedRows: ReviewedImportRow[];
  parseErrors: string[];
};
```

```typescript
// src/application/parameters/import/columnMap.ts
import type { ParsedImportRow } from "./types";

export const IMPORT_TEMPLATE_HEADERS = [
  "参数名称",
  "模块",
  "当前值",
  "推荐值",
  "范围",
  "单位",
  "重要性",
  "描述",
  "说明",
  "配置格式",
  "值类型"
] as const;

const HEADER_TO_FIELD: Record<string, keyof ParsedImportRow> = {
  "参数名称": "name",
  "模块": "module",
  "当前值": "currentValue",
  "推荐值": "recommendedValue",
  "范围": "range",
  "单位": "unit",
  "重要性": "risk",
  "描述": "description",
  "说明": "explanation",
  "配置格式": "configFormat",
  "值类型": "valueKind",
  name: "name",
  module: "module",
  currentValue: "currentValue",
  recommendedValue: "recommendedValue",
  range: "range",
  unit: "unit",
  risk: "risk",
  description: "description",
  explanation: "explanation",
  configFormat: "configFormat",
  valueKind: "valueKind"
};

export function mapRowRecordToFields(record: Record<string, string>): Partial<ParsedImportRow> {
  const mapped: Partial<ParsedImportRow> = {};
  for (const [header, value] of Object.entries(record)) {
    const field = HEADER_TO_FIELD[header.trim()];
    if (field && value.trim()) {
      (mapped as Record<string, string>)[field] = value.trim();
    }
  }
  return mapped;
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/application/parameters/import/
git commit -m "Add parameter import column map and domain types."
```

---

## Task 2: Row normalization and library matching

**Files:**
- Create: `src/application/parameters/import/normalizeRow.ts`
- Create: `src/application/parameters/import/matchToLibrary.ts`
- Create: `src/application/parameters/import/normalizeRow.test.ts`
- Create: `src/application/parameters/import/matchToLibrary.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// normalizeRow.test.ts — risk 高→High, valueKind complex, reject missing name
// matchToLibrary.test.ts — match by name+module, duplicate batch conflict, missing module → needs-module
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/application/parameters/import/normalizeRow.test.ts src/application/parameters/import/matchToLibrary.test.ts --run`

- [ ] **Step 3: Implement**

`normalizeRow(partial)` returns `ParsedImportRow | null` with:
- `normalizeRisk`: 高/中/低 → High/Medium/Low
- `normalizeValueKind`: 标量/complex/scalar aliases
- require `name`; `module` may be empty for DTS (caller sets needs-module)

`matchToLibrary(rows, parameters, projectId)` returns `ReviewedImportRow[]`:
- `matchKey = \`${name}::${module}\``
- existing: find parameter where `parameter.name === name && parameter.module === module && parameter.projectId === projectId` OR global library match on name+module from admin library records
- duplicate keys in same batch → `status: "conflict"`
- no module → `status: "needs-module"`
- no existing → `status: "pending"` (new candidate)

Use `initialState.parameters` shape from tests; for admin page pass `state.parameters` filtered by project for value diff.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Task 3: JSON and spreadsheet parsers

**Files:**
- Create: `src/application/parameters/import/parseJson.ts`
- Create: `src/application/parameters/import/parseSpreadsheet.ts`
- Create: `src/application/parameters/import/parseJson.test.ts`
- Create: `src/application/parameters/import/parseSpreadsheet.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- JSON array of objects with English keys
- JSON `{ items: [...] }`
- CSV with Chinese headers (UTF-8 BOM)
- xlsx buffer with one sheet, Chinese headers (use `buildImportTemplate` fixture bytes)

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement parseJson**

```typescript
export function parseJsonImport(source: string, sourceFormat: ImportSourceFormat = "json"): ParsedImportRow[] {
  const parsed = JSON.parse(source.trim());
  const rows: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
  return rows
    .map((row, index) => {
      if (!row || typeof row !== "object") return null;
      const mapped = mapRowRecordToFields(Object.fromEntries(
        Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
      ));
      return normalizeRow({ ...mapped, sourceFormat, sourceLocation: `json:${index + 1}` });
    })
    .filter((row): row is ParsedImportRow => Boolean(row));
}
```

- [ ] **Step 4: Implement parseSpreadsheet**

Use `xlsx` read with `{ type: "array" }` for File bytes; first sheet; `sheet_to_json` with `header: 1`, row 0 = headers; map via `mapRowRecordToFields`.

CSV: strip BOM, split lines, parse with quoted-field aware splitter (reuse pattern from old `splitCsvLine` in ParameterAdminPage before deletion).

- [ ] **Step 5: Run tests — PASS**

- [ ] **Step 6: Commit**

---

## Task 4: DTS fragment parser (P1)

**Files:**
- Create: `src/application/parameters/import/parseDtsFragment.ts`
- Create: `src/application/parameters/import/parseDtsFragment.test.ts`

- [ ] **Step 1: Write failing test**

Input:
```dts
fast-charge-profile-matrix = "0", "5000", "1500", "40", "entry";
battery-thermal-derate-curve = <
  0 38 3800 4350
  1 42 3200 4320
>;
```
Expect 2 rows with `name` from property, `currentValue` = full RHS, `module` empty, `sourceFormat: "dts-fragment"`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement minimal property extractor**

Regex/line scanner for `identifier = ... ;` supporting quoted strings, `< ... >`, `{ ... }` multiline. Map property name to `name` (normalize `-` to `_` optional — document: keep literal property name as name unless product says otherwise; **use property text as-is** to match existing mock names like `dts_fast_charge_profile_matrix` only when user maps manually in review — for fragments use raw property key).

**Decision (locked):** DTS property label becomes `name` with `-` replaced by `_` for consistency with seed data (`fast-charge-profile-matrix` → `fast_charge_profile_matrix` is WRONG; seed uses `dts_fast_charge_profile_matrix`). P1: use **full property string as name**; Step 3 review lets admin edit name to match library.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

---

## Task 5: Format detection + import template download

**Files:**
- Create: `src/application/parameters/import/detectImportFormat.ts`
- Create: `src/application/parameters/import/buildImportTemplate.ts`
- Create: `src/application/parameters/import/detectImportFormat.test.ts`

- [ ] **Step 1: Tests for detectImportFormat(fileName, bytes, textSnippet)**

- `.xlsx` / PK header → spreadsheet
- `.dts` / `/dts-v1/` / `/{` → dts-full (P1: treat as dts-fragment parser until P2)
- JSON parse → json
- else → spreadsheet csv path

- [ ] **Step 2: buildImportTemplate()** returns `Uint8Array` xlsx with header row only + one example row (commented in test, not in file)

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

---

## Task 6: Wizard shell and Step 1 (source + target project)

**Files:**
- Create: `src/components/ParameterImportWizard/ParameterImportWizard.tsx`
- Create: `src/components/ParameterImportWizard/steps/StepSourceAndProject.tsx`
- Create: `src/components/ParameterImportWizard/ParameterImportWizard.test.tsx`
- Modify: `src/ParameterAdminPage.tsx` — replace `importDialogOpen` with wizard

- [ ] **Step 1: Write failing test**

Open wizard from ParameterAdminPage → dialog `aria-label="批量参数导入向导"` → Step 1 shows:
- combobox `目标项目`
- file input accept `.xlsx,.csv,.json,.dts,.dtsi,.txt`
- button `下载导入模板`
- button `下一步` disabled until project + content present

- [ ] **Step 2: Implement StepSourceAndProject**

Props:
```typescript
type StepSourceAndProjectProps = {
  projects: Project[];
  targetProjectId: string;
  onTargetProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  sourceName: string;
  sourceText: string;
  sourceBytes: Uint8Array | null;
  onSourceChange: (input: { name: string; text: string; bytes: Uint8Array | null }) => void;
  onDownloadTemplate: () => void;
  onNext: () => void;
};
```

Integrate `ProjectAdminFormDialog`:
- `onCreateProject` opens dialog; on success call `parameterActions.createProject` (API) or dispatch equivalent; set `targetProjectId` to new id; refresh projects from state/props.

Default `targetProjectId = state.activeProjectId`.

- [ ] **Step 3: Wire ParameterAdminPage**

Remove old `ParameterImportDialog`; render `<ParameterImportWizard open={...} onClose={...} ... />`.

- [ ] **Step 4: Run tests — PASS**

Run: `npm test -- src/components/ParameterImportWizard/ParameterImportWizard.test.tsx src/ParameterAdminPage.test.tsx --run`

- [ ] **Step 5: Commit**

---

## Task 7: Step 2 parse report

**Files:**
- Create: `src/components/ParameterImportWizard/steps/StepParseReport.tsx`

- [ ] **Step 1: Test — after Next from Step 1 with JSON fixture, Step 2 shows counts and error list**

- [ ] **Step 2: Implement**

On enter Step 2:
1. `detectImportFormat`
2. Run appropriate parser
3. `matchToLibrary(parsed, parameters, targetProjectId)`
4. Show: 总行数 / 新增 / 已有 / 冲突 / 待补全模块 / 解析错误

Block Step 3 if `parsedRows.length === 0`.

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

---

## Task 8: Step 3 per-row review

**Files:**
- Create: `src/components/ParameterImportWizard/ImportReviewCard.tsx`
- Create: `src/components/ParameterImportWizard/steps/StepRowReview.tsx`
- Create: `src/components/ParameterImportWizard/ImportReviewCard.test.tsx`

- [ ] **Step 1: Test ImportReviewCard**

Existing parameter: shows diff for currentValue vs library; Approve / Edit / Skip (skip requires reason input).

New parameter: shows badge `库中不存在`; button `预填并创建` opens `ParameterDefinitionForm` with mapped initial values.

- [ ] **Step 2: Implement review state updates**

```typescript
function approveRow(rowId: string): void
function skipRow(rowId: string, reason: string): void
function updateRow(rowId: string, patch: Partial<ParsedImportRow>): void
function confirmNewParameter(rowId: string, draft: ParameterEditorDraft): void
```

Cannot approve `needs-module` until module filled.

Progress footer: `已核对 {approved}/{total}`.

- [ ] **Step 3: Block Next until all non-skipped rows approved or confirmed**

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

---

## Task 9: Steps 4–5 preview and apply

**Files:**
- Create: `src/components/ParameterImportWizard/steps/StepBatchPreview.tsx`
- Create: `src/components/ParameterImportWizard/steps/StepConfirmApply.tsx`
- Create: `src/application/parameters/import/toSourceItems.ts`

- [ ] **Step 1: toSourceItems(reviewedRows)** — only `approved` and `new-confirmed`; map to `ParameterImportSourceItem[]`

- [ ] **Step 2: Step 4 calls `parameterActions.createImportPreview({ projectId: targetProjectId, sourceName, items })`**

Reuse existing KPI strip UI from old dialog (新增/更新/不变/冲突/高风险) + checkboxes for eligible items (`isEligibleImportItem` — move to shared util).

- [ ] **Step 3: Step 5 read-only summary**

Show target project name + code, source file, KPI; button `确认应用` → `applyImportBatch`; close wizard on success.

- [ ] **Step 4: Test full flow in ParameterAdminPage.test.tsx**

Update existing import tests to walk wizard steps (select project → paste JSON → parse → approve all → preview → apply).

Expected `createImportPreview` called with explicit `projectId` from Step 1, not only `activeProjectId` when user changed selection.

- [ ] **Step 5: Commit**

---

## Task 10: Project change reset + styles

**Files:**
- Modify: `src/components/ParameterImportWizard/ParameterImportWizard.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Test changing target project after Step 3 triggers confirm dialog and resets review state**

- [ ] **Step 2: Add `.parameter-import-wizard` styles** — step indicator, review card layout, diff table; follow existing modal / param-admin patterns

- [ ] **Step 3: Run tests + build**

```bash
npm test -- src/ParameterAdminPage.test.tsx src/components/ParameterImportWizard --run
npm run build
```

- [ ] **Step 4: Commit**

---

## Task 11: Browser acceptance coverage

**Files:**
- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/developer/user-operation-coverage-matrix.md`
- Modify: `e2e/acceptance/parameters.acceptance.spec.ts` (or add `parameter-import.acceptance.spec.ts`)

- [ ] **Step 1: Add `PARAM-ADMIN-002`**

Operation: Admin opens import wizard, selects project, uploads template xlsx with one row, completes review, reaches preview (apply optional in smoke).

- [ ] **Step 2: Implement acceptance spec**

- [ ] **Step 3: Run `npm run acceptance:e2e -- e2e/acceptance/parameters.acceptance.spec.ts`** (or targeted file)

- [ ] **Step 4: Commit**

---

## Task 12: Cleanup and documentation

**Files:**
- Modify: `src/ParameterAdminPage.tsx` — delete `parseImportItems`, `parseCsvImportItems`, `normalizeImportItem`, old `ParameterImportDialog`
- Modify: `docs/zh-CN/product-specs/prototype-functional-spec.md` — §5.3 批量导入：五 step 向导、多格式、逐条核对
- Modify: `docs/product-specs/prototype-functional-spec.md` — matching English bullet (short)
- Modify: `docs/PLANS.md` — keep this plan in active list until complete

- [ ] **Step 1: Grep confirm no dead imports**

Run: `rg "parseImportItems|ParameterImportDialog" src/`

- [ ] **Step 2: Run full targeted verification**

```bash
npm test -- src/application/parameters/import src/ParameterAdminPage.test.tsx src/components/ParameterImportWizard --run
npm run build
npm run docs:check
```

- [ ] **Step 3: Commit**

---

## Verification Matrix

| Check | Command / action |
| --- | --- |
| Unit parsers | `npm test -- src/application/parameters/import --run` |
| Admin page integration | `npm test -- src/ParameterAdminPage.test.tsx --run` |
| Build | `npm run build` |
| Manual Numbers/Excel | Upload wide template xlsx, complete wizard |
| Manual new project | Step 1 create project → import applies to new project |
| Manual DTS fragment | Paste property block → review → module fill |
| Browser acceptance | `npm run acceptance:e2e` (PARAM-ADMIN-002) |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| Design spec | `docs/zh-CN/superpowers/specs/2026-07-06-parameter-batch-import-design.md` | No change (source of truth) |
| Active plan | `docs/exec-plans/active/2026-07-06-parameter-batch-import-wizard.md` | Update checkboxes during implementation |
| Product specs | `docs/zh-CN/product-specs/prototype-functional-spec.md` | **Update** §5.3 import behavior |
| Product specs EN | `docs/product-specs/prototype-functional-spec.md` | **Update** import bullet |
| Frontend | `docs/FRONTEND.md` | **Review** — add import module path under parameters |
| Browser acceptance | `docs/developer/browser-acceptance-coverage-map.md` | **Update** — add PARAM-ADMIN-002 |
| Operation matrix | `docs/developer/user-operation-coverage-matrix.md` | **Update** — add PARAM-ADMIN-002 |
| API / OpenAPI | `docs/generated/openapi.json` | No change (P1 uses existing endpoints) |
| Security | `docs/SECURITY.md` | No change |
| Chinese PLANS | `docs/zh-CN/PLANS.md` | **Update** active plan list |

## Documentation Update Gate

Before moving plan to `completed/`:
- [ ] Prototype functional spec updated (zh + en)
- [ ] PARAM-ADMIN-002 in coverage map + operation matrix
- [ ] `npm run docs:check` passes
- [ ] P2/P3 items logged in `docs/exec-plans/tech-debt-tracker.md` if not implemented

---

## P2 / P3 Follow-up (not in this plan)

| ID | Item |
| --- | --- |
| P2-a | Full `.dts` file parser with node path → module suggestions |
| P2-b | `parseDtsFull.ts` + tests with fixture from `power-management` seeds |
| P3-a | Optional `reviewMetadata` on import batch API for skip reasons audit |
| P3-b | Server-side DTS parse endpoint for files > 2MB |

Log as TD-0XX in tech-debt-tracker when P1 merges.

---

## Spec Coverage Self-Review

| Spec requirement | Task |
| --- | --- |
| Step 1 target project required | Task 6 |
| Create project in wizard | Task 6 |
| xlsx/csv/json | Task 3 |
| DTS fragment P1 | Task 4 |
| Wide admin template | Task 1, 5 |
| name+module match | Task 2 |
| Per-row review edit/skip | Task 8 |
| New parameter prefill | Task 8 |
| Existing batch preview/apply API | Task 9 |
| Step 5 confirm | Task 9 |
| Project change reset | Task 10 |

All P1 spec items mapped. Full DTS deferred to P2 with tech-debt entry.
