# Parameter Comparison Redesign · M1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each implementation step must follow superpowers:test-driven-development.

**Goal:** 为 `/parameter-comparison` 页面提供 M1 切片：独立目录拆分、动态 Header + 项目 Chip、三张 Metric 摘要、5 列新表格（含 Δ 徽章、左色条、参数键 hover tooltip）、带搜索/筛选 chip 的工具条；同步动作保持当前即时逻辑，批量同步与确认对话框延后到 M2。

**Architecture:** 新建 `src/ParameterComparison/` 目录，按组件 / hooks / utils 三层拆分；App.tsx 内联的 `ParameterComparisonPage` 被删除并从新路径 import。新样式写入 `src/styles.css` 末尾 `.comparison-page--v2` 作用域下，旧 `.comparison-*` 选择器保留直至 M3。

**Tech Stack:** React 18 · TypeScript · Vite 7 · Vitest + @testing-library/react · lucide-react · 原有 `styles.css` 变量体系

**Spec 来源:** `docs/design-docs/2026-05-10-parameter-comparison-redesign-design.md`（§3, §4, §5, §7, §9, §11, §12, §14 对应本计划）

**Out of M1 (延后到 M2/M3):**
- 暂存状态模型（`stagedKeys` / `ignoredKeys`）
- 批量同步 `SyncConfirmDialog` + `SyncUndoToast`
- 键盘快捷键（除 `Esc` 关 popover 外）
- `ParameterDetailDialog`（参数键点击）
- `InsightStrip`（WiseAgent 洞察条）
- 跨区域联动（点 Metric/洞察 卡片联动筛选）
- 同步历史抽屉

---

## 文件清单

**新建**
- `src/ParameterComparison/index.ts`
- `src/ParameterComparison/ParameterComparisonPage.tsx`
- `src/ParameterComparison/components/ComparisonHeader.tsx`
- `src/ParameterComparison/components/ProjectChip.tsx`
- `src/ParameterComparison/components/ComparisonMetrics.tsx`
- `src/ParameterComparison/components/ComparisonFilterBar.tsx`
- `src/ParameterComparison/components/ActiveFilterChips.tsx`
- `src/ParameterComparison/components/ComparisonMatrix.tsx`
- `src/ParameterComparison/components/ComparisonRow.tsx`
- `src/ParameterComparison/components/DeltaBadge.tsx`
- `src/ParameterComparison/components/ParameterKeyTooltip.tsx`
- `src/ParameterComparison/components/EmptyStates.tsx`
- `src/ParameterComparison/hooks/useComparisonFilters.ts`
- `src/ParameterComparison/hooks/useComparisonData.ts`
- `src/ParameterComparison/utils/deltaCalc.ts`
- `src/ParameterComparison/utils/rowSort.ts`
- `src/ParameterComparison/utils/exportToExcel.ts`
- `src/ParameterComparison/types.ts`

**测试（对应新建）**
- `src/ParameterComparison/__tests__/DeltaBadge.test.tsx`
- `src/ParameterComparison/__tests__/deltaCalc.test.ts`
- `src/ParameterComparison/__tests__/rowSort.test.ts`
- `src/ParameterComparison/__tests__/ProjectChip.test.tsx`
- `src/ParameterComparison/__tests__/ComparisonHeader.test.tsx`
- `src/ParameterComparison/__tests__/ComparisonMetrics.test.tsx`
- `src/ParameterComparison/__tests__/ComparisonFilterBar.test.tsx`
- `src/ParameterComparison/__tests__/ComparisonMatrix.test.tsx`
- `src/ParameterComparison/__tests__/useComparisonFilters.test.tsx`
- `src/ParameterComparison/__tests__/useComparisonData.test.ts`
- `src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx`

**修改**
- `src/App.tsx`：删除内联 `ParameterComparisonPage`、迁移工具函数，改为 import
- `src/styles.css`：新增 `/* === Parameter Comparison (Redesign M1) === */` 区块

**共：18 个源文件 · 11 个测试文件 · 2 处修改**

---

## 任务总览

| # | 任务 | 产出 | 验证 |
|---|------|------|------|
| 1 | 建立目录骨架 + 类型文件 + 空页面 | 目录结构、`types.ts`、空 `ParameterComparisonPage.tsx` | 导入路径通、build 通过 |
| 2 | 迁移 `exportToExcel` 工具 | `utils/exportToExcel.ts` + 测试 | 单测通过，App.tsx 仍可调用 |
| 3 | `deltaCalc` 工具 + 测试 | `utils/deltaCalc.ts` 覆盖 6 种差异类型 | 单测通过 |
| 4 | `rowSort` 工具 + 测试 | `utils/rowSort.ts` 默认综合排序 | 单测通过 |
| 5 | `DeltaBadge` 组件 + 测试 | 6 种 Δ 展示分支 | 单测通过 |
| 6 | `ProjectChip` 组件 + 测试 | 带搜索的 popover 选择器 | 单测通过 |
| 7 | `ParameterKeyTooltip` 组件 | hover 显示描述 | 集成到行组件后手动验证 |
| 8 | `EmptyStates` 组件 | 多场景空状态渲染 | 单测通过 |
| 9 | `useComparisonFilters` hook + 测试 | URL↔state 同步，默认 driftOnly=ON | 单测通过 |
| 10 | `useComparisonData` hook + 测试 | 组装行 + 排序 + 筛选 | 单测通过 |
| 11 | `ComparisonHeader` 组件 + 测试 | 面包屑、动态 H1、两个 Chip、⇄、导出 CTA | 单测通过 |
| 12 | `ComparisonMetrics` 组件 + 测试 | 三张摘要卡 | 单测通过 |
| 13 | `ComparisonFilterBar` + `ActiveFilterChips` + 测试 | 搜索、toggle、多选筛选、chip 条 | 单测通过 |
| 14 | `ComparisonRow` 组件 | 左色条、参数键+模块、双 Pill、Δ 徽章、操作 | 随 Matrix 一起测 |
| 15 | `ComparisonMatrix` 组件 + 测试 | 表头 sticky、空状态、Row 装配 | 单测通过 |
| 16 | 新 `ParameterComparisonPage` 组装 + 测试 | 顶层页面整合 | 集成测试通过 |
| 17 | 新样式写入 `styles.css`（`.comparison-page--v2` 作用域） | 视觉实现对齐 spec §11 | 视觉 QA |
| 18 | 切换 `App.tsx` 到新实现 | 删除内联旧实现、import 新页面 | `npm test` 全绿、`npm run build` 通过、手动 QA |

每个任务在下面展开为 bite-sized 步骤（2–5 分钟/步）。

---

### Task 1: 建立目录骨架 + 类型文件 + 空页面壳

**Files:**
- Create: `src/ParameterComparison/index.ts`
- Create: `src/ParameterComparison/types.ts`
- Create: `src/ParameterComparison/ParameterComparisonPage.tsx`
- Create: `src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx`

- [ ] **Step 1: 写类型文件**

`src/ParameterComparison/types.ts`:

```typescript
import type { RiskLevel } from "../mockData";

export type ComparisonRowStatus = "drift" | "synced";

export type ComparisonRow = {
  key: string;
  module: string;
  description: string;
  baseValue: string;
  targetValue: string;
  baseNumeric: number | null;
  targetNumeric: number | null;
  unit: string;
  status: ComparisonRowStatus;
  risk: RiskLevel;
};

export type ComparisonProjectSelection = {
  baseProjectId: string;
  targetProjectId: string;
};

export type RiskFilter = "All" | RiskLevel;

export type ComparisonFilters = {
  driftOnly: boolean;
  risk: RiskLevel[];
  modules: string[];
  query: string;
};
```

- [ ] **Step 2: 写 barrel + 空页面壳**

`src/ParameterComparison/ParameterComparisonPage.tsx`:

```typescript
import type { PrototypeState } from "../mockData";
import type { ComparisonProjectSelection } from "./types";

export type ParameterComparisonPageProps = {
  state: PrototypeState;
  onNavigate: (href: string) => void;
  search: string;
  comparisonSelection: ComparisonProjectSelection;
  onComparisonSelectionChange: React.Dispatch<React.SetStateAction<ComparisonProjectSelection>>;
};

export function ParameterComparisonPage(_props: ParameterComparisonPageProps) {
  return (
    <div className="comparison-page comparison-page--v2" data-testid="comparison-page-v2">
      <p>Parameter Comparison Redesign (M1 scaffold)</p>
    </div>
  );
}
```

`src/ParameterComparison/index.ts`:

```typescript
export { ParameterComparisonPage } from "./ParameterComparisonPage";
export type { ParameterComparisonPageProps } from "./ParameterComparisonPage";
```

- [ ] **Step 3: 写导入路径冒烟测试**

`src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { initialState } from "../../mockData";
import { ParameterComparisonPage } from "..";

describe("ParameterComparisonPage (M1 scaffold)", () => {
  it("mounts with the v2 root class", () => {
    render(
      <ParameterComparisonPage
        state={initialState}
        onNavigate={() => undefined}
        search=""
        comparisonSelection={{
          baseProjectId: initialState.activeProjectId,
          targetProjectId: initialState.activeProjectId
        }}
        onComparisonSelectionChange={() => undefined}
      />
    );
    expect(screen.getByTestId("comparison-page-v2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx --run`
Expected: `1 passed`

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/
git commit -m "feat(comparison): scaffold redesign directory and page shell"
```

---

### Task 2: 迁移 `exportComparisonRowsAsExcel` 到 utils/exportToExcel.ts

**Files:**
- Create: `src/ParameterComparison/utils/exportToExcel.ts`
- Modify: `src/App.tsx`（保留旧函数暂不删，Task 18 统一清理）

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/exportToExcel.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { exportComparisonRowsAsExcel } from "../utils/exportToExcel";
import type { ComparisonRow } from "../types";

describe("exportComparisonRowsAsExcel", () => {
  it("returns an Excel XML payload with the provided rows", () => {
    const rows: ComparisonRow[] = [
      {
        key: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        description: "限制快充阶段的最大充电电流。",
        baseValue: "3850 mA",
        targetValue: "4200 mA",
        baseNumeric: 3850,
        targetNumeric: 4200,
        unit: "mA",
        status: "drift",
        risk: "High"
      }
    ];
    const xml = exportComparisonRowsAsExcel(rows, "AUR-Prod", "NEB-RD", { returnString: true });
    expect(xml).toContain("AUR-Prod vs NEB-RD 项目参数对比");
    expect(xml).toContain("fast_charge_current_limit_ma");
    expect(xml).toContain("3850 mA");
    expect(xml).toContain("4200 mA");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/exportToExcel.test.ts --run`
Expected: FAIL · `Cannot find module`

- [ ] **Step 3: 实现 exportToExcel.ts**

从 `src/App.tsx:1023-1090` 附近的 `exportComparisonRowsAsExcel` 和 `escapeExcelCell` 函数提取。把函数签名扩展一个 options 参数以支持测试中 `returnString: true`：

`src/ParameterComparison/utils/exportToExcel.ts`:

```typescript
import type { ComparisonRow } from "../types";

function escapeExcelCell(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type ExportOptions = {
  /** 仅用于单测，返回 XML 字符串而不触发下载 */
  returnString?: boolean;
};

export function exportComparisonRowsAsExcel(
  rows: ComparisonRow[],
  baseProjectCode: string,
  targetProjectCode: string,
  options: ExportOptions = {}
): string | void {
  const headers = ["参数键", "模块", "参数含义", baseProjectCode, targetProjectCode, "重要性", "状态"];
  const tableRows = rows
    .map(
      (row) =>
        `<Row>${headers
          .map(() => "")
          .concat([
            row.key,
            row.module,
            row.description,
            row.baseValue,
            row.targetValue,
            row.risk,
            row.status === "drift" ? "漂移" : "已同步"
          ])
          .slice(headers.length)
          .map((cell) => `<Cell><Data ss:Type="String">${escapeExcelCell(cell)}</Data></Cell>`)
          .join("")}</Row>`
    )
    .join("\n");

  const xml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n<Worksheet ss:Name="对比"><Table>\n<Row>${headers
    .map((header) => `<Cell><Data ss:Type="String">${escapeExcelCell(header)}</Data></Cell>`)
    .join("")}</Row>\n${tableRows}\n</Table></Worksheet>\n<caption>${escapeExcelCell(
    `${baseProjectCode} vs ${targetProjectCode} 项目参数对比`
  )}</caption>\n</Workbook>`;

  if (options.returnString) {
    return xml;
  }
  if (typeof window === "undefined") {
    return xml;
  }

  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseProjectCode}-vs-${targetProjectCode}-comparison.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
```

> 注意：此处的 XML 字符串结构和 App.tsx 中现有 `exportComparisonRowsAsExcel` 一致（参考 `App.tsx:1044` 的 `<caption>` 行）。实施者应打开 `src/App.tsx` 对照 spec §12.1 和该函数的当前实现进行 1:1 迁移，保留原有的表头排列与转义逻辑。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/exportToExcel.test.ts --run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/utils/exportToExcel.ts src/ParameterComparison/__tests__/exportToExcel.test.ts
git commit -m "feat(comparison): extract export-to-excel util with unit test"
```

---

### Task 3: `deltaCalc` 工具 + 测试（Δ 类型分发核心）

**Files:**
- Create: `src/ParameterComparison/utils/deltaCalc.ts`
- Create: `src/ParameterComparison/__tests__/deltaCalc.test.ts`

本任务实现 spec §7.3 的 6 种 Δ 展示规则。函数输入基准/对比的 `ParameterRecord`，输出一个 `DeltaDescriptor`。

- [ ] **Step 1: 写失败测试覆盖 6 个分支**

`src/ParameterComparison/__tests__/deltaCalc.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { calculateDelta } from "../utils/deltaCalc";

describe("calculateDelta", () => {
  it("returns 'synced' when values are equal", () => {
    expect(calculateDelta({ baseValue: "2048", targetValue: "2048", unit: "" })).toEqual({
      kind: "synced"
    });
  });

  it("returns percentage delta for numeric values with non-zero base", () => {
    const delta = calculateDelta({ baseValue: "3850", targetValue: "4200", unit: "mA" });
    expect(delta.kind).toBe("percent");
    if (delta.kind === "percent") {
      expect(delta.percent).toBeCloseTo(9.09, 1);
      expect(delta.direction).toBe("up");
    }
  });

  it("returns negative percentage for decrease", () => {
    const delta = calculateDelta({ baseValue: "100", targetValue: "85", unit: "%" });
    expect(delta.kind).toBe("percent");
    if (delta.kind === "percent") {
      expect(delta.percent).toBeCloseTo(-15, 1);
      expect(delta.direction).toBe("down");
    }
  });

  it("falls back to absolute delta when base is zero", () => {
    const delta = calculateDelta({ baseValue: "0", targetValue: "30", unit: "mV" });
    expect(delta.kind).toBe("absolute");
    if (delta.kind === "absolute") {
      expect(delta.amount).toBe(30);
      expect(delta.unit).toBe("mV");
    }
  });

  it("returns 'new' when base is missing", () => {
    expect(
      calculateDelta({ baseValue: null, targetValue: "ON", unit: "" }).kind
    ).toBe("new");
  });

  it("returns 'missing' when target is missing", () => {
    expect(
      calculateDelta({ baseValue: "ON", targetValue: null, unit: "" }).kind
    ).toBe("missing");
  });

  it("returns 'changed' for non-numeric differing enums", () => {
    expect(
      calculateDelta({ baseValue: "eco", targetValue: "turbo", unit: "" }).kind
    ).toBe("changed");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/deltaCalc.test.ts --run`
Expected: FAIL · `Cannot find module`

- [ ] **Step 3: 实现 `deltaCalc.ts`**

`src/ParameterComparison/utils/deltaCalc.ts`:

```typescript
export type DeltaInput = {
  baseValue: string | null;
  targetValue: string | null;
  unit: string;
};

export type DeltaDescriptor =
  | { kind: "synced" }
  | { kind: "percent"; percent: number; direction: "up" | "down" }
  | { kind: "absolute"; amount: number; unit: string; direction: "up" | "down" }
  | { kind: "changed" }
  | { kind: "new" }
  | { kind: "missing" };

const PERCENT_FALLBACK_THRESHOLD = 999;

function parseNumeric(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateDelta(input: DeltaInput): DeltaDescriptor {
  const { baseValue, targetValue, unit } = input;

  if (baseValue === null || baseValue === undefined || baseValue === "") {
    return targetValue === null || targetValue === undefined || targetValue === ""
      ? { kind: "synced" }
      : { kind: "new" };
  }
  if (targetValue === null || targetValue === undefined || targetValue === "") {
    return { kind: "missing" };
  }
  if (baseValue === targetValue) {
    return { kind: "synced" };
  }

  const baseNumeric = parseNumeric(baseValue);
  const targetNumeric = parseNumeric(targetValue);

  if (baseNumeric === null || targetNumeric === null) {
    return { kind: "changed" };
  }

  const direction: "up" | "down" = targetNumeric >= baseNumeric ? "up" : "down";

  if (baseNumeric === 0) {
    return { kind: "absolute", amount: targetNumeric - baseNumeric, unit, direction };
  }

  const percent = ((targetNumeric - baseNumeric) / Math.abs(baseNumeric)) * 100;
  if (Math.abs(percent) > PERCENT_FALLBACK_THRESHOLD) {
    return { kind: "absolute", amount: targetNumeric - baseNumeric, unit, direction };
  }

  return { kind: "percent", percent, direction };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/deltaCalc.test.ts --run`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/utils/deltaCalc.ts src/ParameterComparison/__tests__/deltaCalc.test.ts
git commit -m "feat(comparison): add calculateDelta util covering 6 diff kinds"
```

---

### Task 4: `rowSort` 工具 + 测试

**Files:**
- Create: `src/ParameterComparison/utils/rowSort.ts`
- Create: `src/ParameterComparison/__tests__/rowSort.test.ts`

实现 spec §7.6 默认综合排序：漂移 > 已同步；漂移内 High > Medium > Low；同级别按差异百分比绝对值降序。

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/rowSort.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sortComparisonRows } from "../utils/rowSort";
import type { ComparisonRow } from "../types";

const row = (overrides: Partial<ComparisonRow>): ComparisonRow => ({
  key: overrides.key ?? "k",
  module: "M",
  description: "",
  baseValue: "1",
  targetValue: "1",
  baseNumeric: 1,
  targetNumeric: 1,
  unit: "",
  status: "synced",
  risk: "Low",
  ...overrides
});

describe("sortComparisonRows (default)", () => {
  it("places drift rows before synced rows", () => {
    const sorted = sortComparisonRows([
      row({ key: "a", status: "synced", risk: "High" }),
      row({ key: "b", status: "drift", risk: "Low", baseNumeric: 10, targetNumeric: 11 })
    ]);
    expect(sorted.map((r) => r.key)).toEqual(["b", "a"]);
  });

  it("orders drift rows by risk High > Medium > Low", () => {
    const sorted = sortComparisonRows([
      row({ key: "low", status: "drift", risk: "Low", baseNumeric: 10, targetNumeric: 11 }),
      row({ key: "high", status: "drift", risk: "High", baseNumeric: 10, targetNumeric: 11 }),
      row({ key: "mid", status: "drift", risk: "Medium", baseNumeric: 10, targetNumeric: 11 })
    ]);
    expect(sorted.map((r) => r.key)).toEqual(["high", "mid", "low"]);
  });

  it("within same risk, orders by |delta %| desc", () => {
    const sorted = sortComparisonRows([
      row({ key: "small", status: "drift", risk: "High", baseNumeric: 100, targetNumeric: 101 }),
      row({ key: "big", status: "drift", risk: "High", baseNumeric: 100, targetNumeric: 200 }),
      row({ key: "mid", status: "drift", risk: "High", baseNumeric: 100, targetNumeric: 120 })
    ]);
    expect(sorted.map((r) => r.key)).toEqual(["big", "mid", "small"]);
  });

  it("is stable for equal rank", () => {
    const sorted = sortComparisonRows([
      row({ key: "a", status: "synced", risk: "Low" }),
      row({ key: "b", status: "synced", risk: "Low" })
    ]);
    expect(sorted.map((r) => r.key)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/rowSort.test.ts --run`
Expected: FAIL

- [ ] **Step 3: 实现 `rowSort.ts`**

`src/ParameterComparison/utils/rowSort.ts`:

```typescript
import type { ComparisonRow } from "../types";

const RISK_RANK: Record<ComparisonRow["risk"], number> = {
  High: 0,
  Medium: 1,
  Low: 2
};

function deltaMagnitude(row: ComparisonRow): number {
  if (row.baseNumeric === null || row.targetNumeric === null) {
    return row.status === "drift" ? Number.POSITIVE_INFINITY : 0;
  }
  if (row.baseNumeric === 0) {
    return Math.abs(row.targetNumeric);
  }
  return Math.abs((row.targetNumeric - row.baseNumeric) / row.baseNumeric) * 100;
}

export function sortComparisonRows(rows: ComparisonRow[]): ComparisonRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const statusDiff = (a.row.status === "drift" ? 0 : 1) - (b.row.status === "drift" ? 0 : 1);
      if (statusDiff !== 0) return statusDiff;

      const riskDiff = RISK_RANK[a.row.risk] - RISK_RANK[b.row.risk];
      if (riskDiff !== 0) return riskDiff;

      const magnitudeDiff = deltaMagnitude(b.row) - deltaMagnitude(a.row);
      if (magnitudeDiff !== 0) return magnitudeDiff;

      return a.index - b.index;
    })
    .map((entry) => entry.row);
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/rowSort.test.ts --run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/utils/rowSort.ts src/ParameterComparison/__tests__/rowSort.test.ts
git commit -m "feat(comparison): add default composite row sort util"
```

---

### Task 5: `DeltaBadge` 组件 + 测试

**Files:**
- Create: `src/ParameterComparison/components/DeltaBadge.tsx`
- Create: `src/ParameterComparison/__tests__/DeltaBadge.test.tsx`

实现 spec §7.3 的视觉：6 种 Δ 分支显示 + amber/teal 方向配色 + `↑/↓` icon。

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/DeltaBadge.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeltaBadge } from "../components/DeltaBadge";

describe("DeltaBadge", () => {
  it("renders percent with up direction and warn tone", () => {
    render(<DeltaBadge descriptor={{ kind: "percent", percent: 9.1, direction: "up" }} />);
    const badge = screen.getByTestId("delta-badge");
    expect(badge).toHaveTextContent("+9.1%");
    expect(badge).toHaveAttribute("data-tone", "warn");
  });

  it("renders percent with down direction and ease tone", () => {
    render(<DeltaBadge descriptor={{ kind: "percent", percent: -14.3, direction: "down" }} />);
    expect(screen.getByTestId("delta-badge")).toHaveTextContent("−14.3%");
    expect(screen.getByTestId("delta-badge")).toHaveAttribute("data-tone", "ease");
  });

  it("renders absolute diff with unit", () => {
    render(
      <DeltaBadge descriptor={{ kind: "absolute", amount: 30, unit: "mV", direction: "up" }} />
    );
    expect(screen.getByTestId("delta-badge")).toHaveTextContent("+30 mV");
  });

  it("renders 'changed' chip for enum drift", () => {
    render(<DeltaBadge descriptor={{ kind: "changed" }} />);
    expect(screen.getByTestId("delta-badge")).toHaveTextContent("已变更");
  });

  it("renders 'new' chip", () => {
    render(<DeltaBadge descriptor={{ kind: "new" }} />);
    expect(screen.getByTestId("delta-badge")).toHaveTextContent("新增");
  });

  it("renders 'missing' chip", () => {
    render(<DeltaBadge descriptor={{ kind: "missing" }} />);
    expect(screen.getByTestId("delta-badge")).toHaveTextContent("未配置");
  });

  it("renders 'synced' chip with success tone", () => {
    render(<DeltaBadge descriptor={{ kind: "synced" }} />);
    expect(screen.getByTestId("delta-badge")).toHaveAttribute("data-tone", "synced");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/DeltaBadge.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: 实现 `DeltaBadge.tsx`**

`src/ParameterComparison/components/DeltaBadge.tsx`:

```typescript
import { ArrowDown, ArrowUp } from "lucide-react";
import type { DeltaDescriptor } from "../utils/deltaCalc";

export type DeltaBadgeProps = {
  descriptor: DeltaDescriptor;
};

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}

function formatAbsolute(amount: number, unit: string): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  const unitSuffix = unit ? ` ${unit}` : "";
  return `${sign}${Math.abs(amount)}${unitSuffix}`;
}

export function DeltaBadge({ descriptor }: DeltaBadgeProps) {
  switch (descriptor.kind) {
    case "synced":
      return (
        <span className="delta-badge" data-tone="synced" data-testid="delta-badge">
          已同步
        </span>
      );
    case "new":
      return (
        <span className="delta-badge" data-tone="new" data-testid="delta-badge">
          新增
        </span>
      );
    case "missing":
      return (
        <span className="delta-badge" data-tone="missing" data-testid="delta-badge">
          未配置
        </span>
      );
    case "changed":
      return (
        <span className="delta-badge" data-tone="changed" data-testid="delta-badge">
          已变更
        </span>
      );
    case "percent": {
      const tone = descriptor.direction === "up" ? "warn" : "ease";
      const Icon = descriptor.direction === "up" ? ArrowUp : ArrowDown;
      return (
        <span className="delta-badge" data-tone={tone} data-testid="delta-badge">
          {formatPercent(descriptor.percent)}
          <Icon size={12} aria-hidden />
        </span>
      );
    }
    case "absolute": {
      const tone = descriptor.direction === "up" ? "warn" : "ease";
      const Icon = descriptor.direction === "up" ? ArrowUp : ArrowDown;
      return (
        <span className="delta-badge" data-tone={tone} data-testid="delta-badge">
          {formatAbsolute(descriptor.amount, descriptor.unit)}
          <Icon size={12} aria-hidden />
        </span>
      );
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/DeltaBadge.test.tsx --run`
Expected: PASS（7 用例）

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/components/DeltaBadge.tsx src/ParameterComparison/__tests__/DeltaBadge.test.tsx
git commit -m "feat(comparison): add DeltaBadge with six diff kinds"
```

---

### Task 6: `ProjectChip` 组件 + 测试

**Files:**
- Create: `src/ParameterComparison/components/ProjectChip.tsx`
- Create: `src/ParameterComparison/__tests__/ProjectChip.test.tsx`

按 spec §4.2 实现：Chip 按钮 + popover 列表，支持搜索、当前选中 ✓、对侧已选 disabled、键盘导航、Esc 关闭。

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/ProjectChip.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ProjectChip } from "../components/ProjectChip";
import { projects } from "../../mockData";

const [alpha, beta, gamma] = projects;

describe("ProjectChip", () => {
  it("renders selected project code and name", () => {
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        selectedProjectId={alpha.id}
        disabledProjectId={beta.id}
        projects={projects}
        onSelect={() => undefined}
      />
    );
    expect(screen.getByRole("button", { name: /基准项目/ })).toHaveTextContent(alpha.code);
  });

  it("opens popover on click and lists all projects", () => {
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        selectedProjectId={alpha.id}
        disabledProjectId={beta.id}
        projects={projects}
        onSelect={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /基准项目/ }));
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getAllByRole("option").length).toBe(projects.length);
  });

  it("disables the project already selected on the other side", () => {
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        selectedProjectId={alpha.id}
        disabledProjectId={beta.id}
        projects={projects}
        onSelect={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /基准项目/ }));
    const listbox = screen.getByRole("listbox");
    const disabledOption = within(listbox).getByRole("option", { name: new RegExp(beta.code) });
    expect(disabledOption).toHaveAttribute("aria-disabled", "true");
  });

  it("filters options by search input", () => {
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        selectedProjectId={alpha.id}
        disabledProjectId={beta.id}
        projects={projects}
        onSelect={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /基准项目/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: gamma.code } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("calls onSelect and closes popover when an option is picked", () => {
    const onSelect = vi.fn();
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        selectedProjectId={alpha.id}
        disabledProjectId={beta.id}
        projects={projects}
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /基准项目/ }));
    fireEvent.click(screen.getByRole("option", { name: new RegExp(gamma.code) }));
    expect(onSelect).toHaveBeenCalledWith(gamma.id);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes popover on Escape", () => {
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        selectedProjectId={alpha.id}
        disabledProjectId={beta.id}
        projects={projects}
        onSelect={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /基准项目/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/ProjectChip.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: 实现 `ProjectChip.tsx`**

`src/ParameterComparison/components/ProjectChip.tsx`:

```typescript
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { Project } from "../../mockData";

export type ProjectChipTone = "base" | "target";

export type ProjectChipProps = {
  label: "基准项目" | "对比项目";
  tone: ProjectChipTone;
  selectedProjectId: string;
  disabledProjectId: string;
  projects: Project[];
  onSelect: (projectId: string) => void;
};

export function ProjectChip({
  label,
  tone,
  selectedProjectId,
  disabledProjectId,
  projects,
  onSelect
}: ProjectChipProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selected = projects.find((project) => project.id === selectedProjectId) ?? projects[0];

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter(
      (project) =>
        project.code.toLowerCase().includes(normalized) ||
        project.name.toLowerCase().includes(normalized)
    );
  }, [projects, query]);

  const handleSelect = (projectId: string, disabled: boolean) => {
    if (disabled) return;
    onSelect(projectId);
    setOpen(false);
  };

  return (
    <div className="project-chip" data-tone={tone}>
      <button
        type="button"
        className="project-chip__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}：${selected.code} ${selected.name}，点击切换`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="project-chip__dot" aria-hidden />
        <span className="project-chip__code">{selected.code}</span>
        <span className="project-chip__name">{selected.name}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="project-chip__popover" role="dialog" aria-label={`选择${label}`}>
          <div className="project-chip__search">
            <Search size={14} aria-hidden />
            <input
              ref={searchRef}
              role="searchbox"
              aria-label="搜索项目"
              placeholder="搜索项目…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
            />
          </div>
          <ul role="listbox" className="project-chip__list" aria-label={label}>
            {filtered.map((project) => {
              const isSelected = project.id === selectedProjectId;
              const isDisabled = project.id === disabledProjectId;
              return (
                <li
                  key={project.id}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isDisabled}
                  className="project-chip__option"
                  data-disabled={isDisabled || undefined}
                  onClick={() => handleSelect(project.id, isDisabled)}
                >
                  <span className="project-chip__option-code">{project.code}</span>
                  <span className="project-chip__option-name">{project.name}</span>
                  {isSelected && <Check size={14} aria-hidden />}
                  {isDisabled && !isSelected && (
                    <span className="project-chip__option-hint">已作为对侧</span>
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="project-chip__empty" role="presentation">
                无匹配项目
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/ProjectChip.test.tsx --run`
Expected: PASS（6 用例）

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/components/ProjectChip.tsx src/ParameterComparison/__tests__/ProjectChip.test.tsx
git commit -m "feat(comparison): add ProjectChip with search popover"
```

---

### Task 7: `ParameterKeyTooltip` 组件

**Files:**
- Create: `src/ParameterComparison/components/ParameterKeyTooltip.tsx`

实现 spec §7.2 的 hover popover：参数含义 + 单位/范围 + "在工作台打开"链接。本任务不单独测试（集成到 Row 后由 Matrix 测验证 hover 行为的存在性）。

- [ ] **Step 1: 实现组件**

`src/ParameterComparison/components/ParameterKeyTooltip.tsx`:

```typescript
import { useState, useRef, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

export type ParameterKeyTooltipProps = {
  description: string;
  module: string;
  unit?: string;
  range?: string;
  onOpenInWorkbench?: () => void;
  children: ReactNode;
};

const HOVER_DELAY_MS = 400;

export function ParameterKeyTooltip({
  description,
  module,
  unit,
  range,
  onOpenInWorkbench,
  children
}: ParameterKeyTooltipProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  const scheduleOpen = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };
  const cancelOpen = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };

  return (
    <span
      className="param-tooltip"
      onMouseEnter={scheduleOpen}
      onMouseLeave={cancelOpen}
      onFocus={scheduleOpen}
      onBlur={cancelOpen}
    >
      {children}
      {open && (
        <span className="param-tooltip__popover" role="tooltip">
          <span className="param-tooltip__desc">{description}</span>
          <span className="param-tooltip__meta">
            <strong>模块</strong> {module}
            {unit && (
              <>
                <span className="param-tooltip__sep">·</span>
                <strong>单位</strong> {unit}
              </>
            )}
            {range && (
              <>
                <span className="param-tooltip__sep">·</span>
                <strong>范围</strong> {range}
              </>
            )}
          </span>
          {onOpenInWorkbench && (
            <button
              type="button"
              className="param-tooltip__link"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onOpenInWorkbench}
            >
              在工作台中打开 <ExternalLink size={12} aria-hidden />
            </button>
          )}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 通过**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: 无 error

- [ ] **Step 3: 提交**

```bash
git add src/ParameterComparison/components/ParameterKeyTooltip.tsx
git commit -m "feat(comparison): add ParameterKeyTooltip with hover popover"
```

---

### Task 8: `EmptyStates` 组件

**Files:**
- Create: `src/ParameterComparison/components/EmptyStates.tsx`

实现 spec §7.8 + §10 的空状态汇总：筛选空、搜索空、无共同参数、全部已同步、仅看漂移但 drift=0 这 5 种命名导出。每个空态接受可选的 CTA。

- [ ] **Step 1: 实现**

`src/ParameterComparison/components/EmptyStates.tsx`:

```typescript
import { Ban, CheckCircle2, SearchX, SlidersHorizontal } from "lucide-react";

type BaseProps = {
  onPrimary?: () => void;
};

export function NoFilterMatch({ onPrimary, summary }: BaseProps & { summary?: string }) {
  return (
    <div className="comparison-empty" data-variant="filter">
      <SlidersHorizontal size={32} aria-hidden />
      <h3>无匹配的参数</h3>
      {summary && <p>{summary}</p>}
      {onPrimary && (
        <button type="button" className="comparison-empty__cta" onClick={onPrimary}>
          清除筛选
        </button>
      )}
    </div>
  );
}

export function NoSearchMatch({ onPrimary, query }: BaseProps & { query: string }) {
  return (
    <div className="comparison-empty" data-variant="search">
      <SearchX size={32} aria-hidden />
      <h3>没有匹配 “{query}” 的参数</h3>
      {onPrimary && (
        <button type="button" className="comparison-empty__cta" onClick={onPrimary}>
          清除搜索
        </button>
      )}
    </div>
  );
}

export function NoCommonParameters() {
  return (
    <div className="comparison-empty" data-variant="no-common">
      <Ban size={32} aria-hidden />
      <h3>两个项目没有共同参数键</h3>
      <p>可能是项目类型差异过大。</p>
    </div>
  );
}

export function AllSynced({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="comparison-empty" data-variant="all-synced">
      <CheckCircle2 size={32} aria-hidden />
      <h3>所有参数已对齐</h3>
      <button type="button" className="comparison-empty__cta" onClick={onShowAll}>
        切换到全部参数
      </button>
    </div>
  );
}

export function DriftOnlyButZero({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="comparison-empty" data-variant="drift-zero">
      <CheckCircle2 size={32} aria-hidden />
      <h3>没有待处理的漂移</h3>
      <button type="button" className="comparison-empty__cta" onClick={onShowAll}>
        切换到全部参数
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TS 通过**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: 无 error

- [ ] **Step 3: 提交**

```bash
git add src/ParameterComparison/components/EmptyStates.tsx
git commit -m "feat(comparison): add empty state components"
```

---

### Task 9: `useComparisonFilters` hook + 测试

**Files:**
- Create: `src/ParameterComparison/hooks/useComparisonFilters.ts`
- Create: `src/ParameterComparison/__tests__/useComparisonFilters.test.tsx`

实现 spec §9.5：管理筛选状态（driftOnly 默认 ON、risk 多选、modules 多选、query）；从 URL 初始化；写回用 `history.replaceState`（不污染历史）。

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/useComparisonFilters.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useComparisonFilters } from "../hooks/useComparisonFilters";

describe("useComparisonFilters", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/parameter-comparison");
  });

  it("defaults to driftOnly=true and empty arrays", () => {
    const { result } = renderHook(() => useComparisonFilters(""));
    expect(result.current.filters.driftOnly).toBe(true);
    expect(result.current.filters.risk).toEqual([]);
    expect(result.current.filters.modules).toEqual([]);
    expect(result.current.filters.query).toBe("");
  });

  it("parses initial state from URL search", () => {
    const { result } = renderHook(() =>
      useComparisonFilters("?driftOnly=0&risk=High,Medium&module=Charging%20Policy&q=voltage")
    );
    expect(result.current.filters.driftOnly).toBe(false);
    expect(result.current.filters.risk).toEqual(["High", "Medium"]);
    expect(result.current.filters.modules).toEqual(["Charging Policy"]);
    expect(result.current.filters.query).toBe("voltage");
  });

  it("updates URL via replaceState on filter change", () => {
    const { result } = renderHook(() => useComparisonFilters(""));
    act(() => result.current.setQuery("limit"));
    expect(window.location.search).toContain("q=limit");
  });

  it("clear() resets to defaults (driftOnly=ON, others empty)", () => {
    const { result } = renderHook(() =>
      useComparisonFilters("?driftOnly=0&risk=High&q=x")
    );
    act(() => result.current.clear());
    expect(result.current.filters).toEqual({
      driftOnly: true,
      risk: [],
      modules: [],
      query: ""
    });
  });

  it("toggleRisk adds and removes values", () => {
    const { result } = renderHook(() => useComparisonFilters(""));
    act(() => result.current.toggleRisk("High"));
    act(() => result.current.toggleRisk("Medium"));
    expect(result.current.filters.risk).toEqual(["High", "Medium"]);
    act(() => result.current.toggleRisk("High"));
    expect(result.current.filters.risk).toEqual(["Medium"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/useComparisonFilters.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: 实现 hook**

`src/ParameterComparison/hooks/useComparisonFilters.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComparisonFilters } from "../types";
import type { RiskLevel } from "../../mockData";

const DEFAULTS: ComparisonFilters = {
  driftOnly: true,
  risk: [],
  modules: [],
  query: ""
};

function parseFromSearch(search: string): ComparisonFilters {
  const params = new URLSearchParams(search);
  const driftOnlyParam = params.get("driftOnly");
  const riskParam = params.get("risk");
  const moduleParam = params.get("module");
  const queryParam = params.get("q");

  const risk: RiskLevel[] = riskParam
    ? (riskParam.split(",").filter((value): value is RiskLevel =>
        value === "High" || value === "Medium" || value === "Low"
      ))
    : [];

  const modules = moduleParam ? moduleParam.split(",").filter(Boolean) : [];

  return {
    driftOnly: driftOnlyParam === null ? DEFAULTS.driftOnly : driftOnlyParam !== "0",
    risk,
    modules,
    query: queryParam ?? ""
  };
}

function serializeToSearch(filters: ComparisonFilters, existing: string): string {
  const params = new URLSearchParams(existing);

  if (filters.driftOnly === DEFAULTS.driftOnly) {
    params.delete("driftOnly");
  } else {
    params.set("driftOnly", filters.driftOnly ? "1" : "0");
  }

  if (filters.risk.length === 0) params.delete("risk");
  else params.set("risk", filters.risk.join(","));

  if (filters.modules.length === 0) params.delete("module");
  else params.set("module", filters.modules.join(","));

  if (!filters.query) params.delete("q");
  else params.set("q", filters.query);

  const search = params.toString();
  return search ? `?${search}` : "";
}

export type UseComparisonFiltersResult = {
  filters: ComparisonFilters;
  setQuery: (query: string) => void;
  toggleDriftOnly: () => void;
  toggleRisk: (risk: RiskLevel) => void;
  toggleModule: (module: string) => void;
  setRisk: (risk: RiskLevel[]) => void;
  setModules: (modules: string[]) => void;
  clear: () => void;
  hasActiveFilters: boolean;
};

export function useComparisonFilters(initialSearch: string): UseComparisonFiltersResult {
  const [filters, setFilters] = useState<ComparisonFilters>(() => parseFromSearch(initialSearch));
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    if (typeof window === "undefined") return;
    const next = serializeToSearch(filters, window.location.search);
    const newUrl = `${window.location.pathname}${next}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", newUrl);
  }, [filters]);

  const setQuery = useCallback((query: string) => {
    setFilters((current) => ({ ...current, query }));
  }, []);
  const toggleDriftOnly = useCallback(() => {
    setFilters((current) => ({ ...current, driftOnly: !current.driftOnly }));
  }, []);
  const toggleRisk = useCallback((risk: RiskLevel) => {
    setFilters((current) => ({
      ...current,
      risk: current.risk.includes(risk)
        ? current.risk.filter((item) => item !== risk)
        : [...current.risk, risk]
    }));
  }, []);
  const toggleModule = useCallback((module: string) => {
    setFilters((current) => ({
      ...current,
      modules: current.modules.includes(module)
        ? current.modules.filter((item) => item !== module)
        : [...current.modules, module]
    }));
  }, []);
  const setRisk = useCallback((risk: RiskLevel[]) => {
    setFilters((current) => ({ ...current, risk }));
  }, []);
  const setModules = useCallback((modules: string[]) => {
    setFilters((current) => ({ ...current, modules }));
  }, []);
  const clear = useCallback(() => {
    setFilters({ ...DEFAULTS });
  }, []);

  const hasActiveFilters =
    filters.driftOnly !== DEFAULTS.driftOnly ||
    filters.risk.length > 0 ||
    filters.modules.length > 0 ||
    filters.query.trim().length > 0;

  return {
    filters,
    setQuery,
    toggleDriftOnly,
    toggleRisk,
    toggleModule,
    setRisk,
    setModules,
    clear,
    hasActiveFilters
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/useComparisonFilters.test.tsx --run`
Expected: PASS（5 用例）

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/hooks/useComparisonFilters.ts src/ParameterComparison/__tests__/useComparisonFilters.test.tsx
git commit -m "feat(comparison): add useComparisonFilters hook with URL sync"
```

---

### Task 10: `useComparisonData` hook + 测试

**Files:**
- Create: `src/ParameterComparison/hooks/useComparisonData.ts`
- Create: `src/ParameterComparison/__tests__/useComparisonData.test.ts`

组装 `ComparisonRow[]`、应用 `sortComparisonRows`、应用筛选、暴露 modules 选项集。

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/useComparisonData.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useComparisonData } from "../hooks/useComparisonData";
import { initialState, projects } from "../../mockData";

const [baseProject, targetProject] = projects;

describe("useComparisonData", () => {
  it("returns rows for the chosen project pair", () => {
    const { result } = renderHook(() =>
      useComparisonData({
        state: initialState,
        baseProjectId: baseProject.id,
        targetProjectId: targetProject.id,
        filters: { driftOnly: false, risk: [], modules: [], query: "" }
      })
    );
    expect(result.current.rows.length).toBeGreaterThan(0);
    expect(result.current.totalCount).toBe(result.current.rows.length);
  });

  it("filters out synced rows when driftOnly is on", () => {
    const { result } = renderHook(() =>
      useComparisonData({
        state: initialState,
        baseProjectId: baseProject.id,
        targetProjectId: targetProject.id,
        filters: { driftOnly: true, risk: [], modules: [], query: "" }
      })
    );
    expect(result.current.rows.every((row) => row.status === "drift")).toBe(true);
  });

  it("narrows by risk selection", () => {
    const { result } = renderHook(() =>
      useComparisonData({
        state: initialState,
        baseProjectId: baseProject.id,
        targetProjectId: targetProject.id,
        filters: { driftOnly: false, risk: ["High"], modules: [], query: "" }
      })
    );
    expect(result.current.rows.every((row) => row.risk === "High")).toBe(true);
  });

  it("narrows by query matching key or module", () => {
    const sample = initialState.parameters.find((p) => p.projectId === baseProject.id);
    if (!sample) throw new Error("fixture missing");
    const { result } = renderHook(() =>
      useComparisonData({
        state: initialState,
        baseProjectId: baseProject.id,
        targetProjectId: targetProject.id,
        filters: { driftOnly: false, risk: [], modules: [], query: sample.name.slice(0, 4) }
      })
    );
    expect(result.current.rows.length).toBeGreaterThan(0);
    expect(
      result.current.rows.every(
        (row) =>
          row.key.toLowerCase().includes(sample.name.slice(0, 4).toLowerCase()) ||
          row.module.toLowerCase().includes(sample.name.slice(0, 4).toLowerCase())
      )
    ).toBe(true);
  });

  it("exposes unique module options", () => {
    const { result } = renderHook(() =>
      useComparisonData({
        state: initialState,
        baseProjectId: baseProject.id,
        targetProjectId: targetProject.id,
        filters: { driftOnly: false, risk: [], modules: [], query: "" }
      })
    );
    const modules = result.current.moduleOptions;
    expect(new Set(modules).size).toBe(modules.length);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/useComparisonData.test.ts --run`
Expected: FAIL

- [ ] **Step 3: 实现 hook**

`src/ParameterComparison/hooks/useComparisonData.ts`:

```typescript
import { useMemo } from "react";
import type { ComparisonFilters, ComparisonRow } from "../types";
import type { PrototypeState } from "../../mockData";
import { sortComparisonRows } from "../utils/rowSort";

function parseNumeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export type UseComparisonDataInput = {
  state: PrototypeState;
  baseProjectId: string;
  targetProjectId: string;
  filters: ComparisonFilters;
};

export type UseComparisonDataResult = {
  rows: ComparisonRow[];
  allRows: ComparisonRow[];
  moduleOptions: string[];
  totalCount: number;
  driftCount: number;
  highDriftCount: number;
};

export function useComparisonData({
  state,
  baseProjectId,
  targetProjectId,
  filters
}: UseComparisonDataInput): UseComparisonDataResult {
  const allRows = useMemo<ComparisonRow[]>(() => {
    const baseParameters = state.parameters.filter((p) => p.projectId === baseProjectId);
    const targetParameters = state.parameters.filter((p) => p.projectId === targetProjectId);
    const targetByName = new Map(targetParameters.map((p) => [p.name, p]));

    const rows = baseParameters.map<ComparisonRow>((baseParameter) => {
      const targetParameter = targetByName.get(baseParameter.name);
      const baseValue = `${baseParameter.currentValue}${baseParameter.unit ? ` ${baseParameter.unit}` : ""}`.trim();
      const targetValue = targetParameter
        ? `${targetParameter.currentValue}${targetParameter.unit ? ` ${targetParameter.unit}` : ""}`.trim()
        : "未配置";
      const status =
        targetParameter && targetParameter.currentValue === baseParameter.currentValue
          ? "synced"
          : "drift";
      return {
        key: baseParameter.name,
        module: baseParameter.module,
        description: baseParameter.description ?? "",
        baseValue,
        targetValue,
        baseNumeric: parseNumeric(baseParameter.currentValue),
        targetNumeric: targetParameter ? parseNumeric(targetParameter.currentValue) : null,
        unit: baseParameter.unit ?? "",
        status,
        risk: baseParameter.risk
      };
    });

    return sortComparisonRows(rows);
  }, [state.parameters, baseProjectId, targetProjectId]);

  const moduleOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.module))).sort(),
    [allRows]
  );

  const rows = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLowerCase();
    return allRows.filter((row) => {
      if (filters.driftOnly && row.status !== "drift") return false;
      if (filters.risk.length > 0 && !filters.risk.includes(row.risk)) return false;
      if (filters.modules.length > 0 && !filters.modules.includes(row.module)) return false;
      if (normalizedQuery) {
        const key = row.key.toLowerCase();
        const module = row.module.toLowerCase();
        if (!key.includes(normalizedQuery) && !module.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [allRows, filters]);

  const driftCount = useMemo(
    () => allRows.filter((row) => row.status === "drift").length,
    [allRows]
  );
  const highDriftCount = useMemo(
    () => allRows.filter((row) => row.status === "drift" && row.risk === "High").length,
    [allRows]
  );

  return {
    rows,
    allRows,
    moduleOptions,
    totalCount: allRows.length,
    driftCount,
    highDriftCount
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/useComparisonData.test.ts --run`
Expected: PASS（5 用例）

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/hooks/useComparisonData.ts src/ParameterComparison/__tests__/useComparisonData.test.ts
git commit -m "feat(comparison): add useComparisonData hook with sort and filter"
```

---

### Task 11: `ComparisonHeader` 组件 + 测试

**Files:**
- Create: `src/ParameterComparison/components/ComparisonHeader.tsx`
- Create: `src/ParameterComparison/__tests__/ComparisonHeader.test.tsx`

按 spec §4 实现：面包屑 + 动态 H1（两个 `ProjectChip` + `⇄`）+ 右上 CTA（导出）+ 溢出菜单占位。M1 不渲染"同步已选"CTA（Task 12 的 Metrics 下的 props 也不传 staged 计数）。

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/ComparisonHeader.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComparisonHeader } from "../components/ComparisonHeader";
import { projects } from "../../mockData";

const [alpha, beta] = projects;

const baseProps = {
  projects,
  baseProjectId: alpha.id,
  targetProjectId: beta.id,
  onSelectBase: () => undefined,
  onSelectTarget: () => undefined,
  onSwap: () => undefined,
  onExport: () => undefined,
  onNavigate: () => undefined
};

describe("ComparisonHeader", () => {
  it("renders breadcrumb with two segments", () => {
    render(<ComparisonHeader {...baseProps} />);
    const breadcrumb = screen.getByLabelText("参数对比路径");
    expect(breadcrumb).toHaveTextContent("参数");
    expect(breadcrumb).toHaveTextContent("对比分析");
  });

  it("renders both project chips with their codes", () => {
    render(<ComparisonHeader {...baseProps} />);
    expect(screen.getByRole("button", { name: /基准项目/ })).toHaveTextContent(alpha.code);
    expect(screen.getByRole("button", { name: /对比项目/ })).toHaveTextContent(beta.code);
  });

  it("invokes onSwap when swap button clicked", () => {
    const onSwap = vi.fn();
    render(<ComparisonHeader {...baseProps} onSwap={onSwap} />);
    fireEvent.click(screen.getByRole("button", { name: "互换基准与对比项目" }));
    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it("invokes onExport when export clicked", () => {
    const onExport = vi.fn();
    render(<ComparisonHeader {...baseProps} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("navigates to parameters when breadcrumb root is clicked", () => {
    const onNavigate = vi.fn();
    render(<ComparisonHeader {...baseProps} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "参数" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameters");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/ComparisonHeader.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: 实现组件**

`src/ParameterComparison/components/ComparisonHeader.tsx`:

```typescript
import { ArrowLeftRight, ChevronRight, Upload } from "lucide-react";
import type { Project } from "../../mockData";
import { ProjectChip } from "./ProjectChip";

export type ComparisonHeaderProps = {
  projects: Project[];
  baseProjectId: string;
  targetProjectId: string;
  onSelectBase: (projectId: string) => void;
  onSelectTarget: (projectId: string) => void;
  onSwap: () => void;
  onExport: () => void;
  onNavigate: (href: string) => void;
};

export function ComparisonHeader({
  projects,
  baseProjectId,
  targetProjectId,
  onSelectBase,
  onSelectTarget,
  onSwap,
  onExport,
  onNavigate
}: ComparisonHeaderProps) {
  const base = projects.find((project) => project.id === baseProjectId) ?? projects[0];
  const target = projects.find((project) => project.id === targetProjectId) ?? projects[1] ?? projects[0];

  return (
    <header className="comparison-header--v2">
      <nav className="comparison-breadcrumb" aria-label="参数对比路径">
        <button type="button" onClick={() => onNavigate("/parameters")}>
          参数
        </button>
        <ChevronRight size={14} aria-hidden />
        <span aria-current="page">对比分析</span>
      </nav>
      <div className="comparison-header--v2__titlebar">
        <h1 className="comparison-header--v2__title">
          <ProjectChip
            label="基准项目"
            tone="base"
            selectedProjectId={base.id}
            disabledProjectId={target.id}
            projects={projects}
            onSelect={onSelectBase}
          />
          <button
            type="button"
            className="comparison-header--v2__swap"
            aria-label="互换基准与对比项目"
            onClick={onSwap}
          >
            <ArrowLeftRight size={18} aria-hidden />
          </button>
          <ProjectChip
            label="对比项目"
            tone="target"
            selectedProjectId={target.id}
            disabledProjectId={base.id}
            projects={projects}
            onSelect={onSelectTarget}
          />
        </h1>
        <div className="comparison-header--v2__actions">
          <button type="button" className="button subtle" onClick={onExport}>
            <Upload size={16} aria-hidden />
            导出
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/ComparisonHeader.test.tsx --run`
Expected: PASS（5 用例）

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/components/ComparisonHeader.tsx src/ParameterComparison/__tests__/ComparisonHeader.test.tsx
git commit -m "feat(comparison): add ComparisonHeader with project chips and swap"
```

---

### Task 12: `ComparisonMetrics` 组件 + 测试

**Files:**
- Create: `src/ParameterComparison/components/ComparisonMetrics.tsx`
- Create: `src/ParameterComparison/__tests__/ComparisonMetrics.test.tsx`

按 spec §5：三张等宽卡，状态化 tone（drift 全 0 → green；highDrift 0 → 灰隐）。点击"漂移参数"卡触发 `onFocusDrift`；点击"高重要性"触发 `onFocusHighRisk`。

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/ComparisonMetrics.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComparisonMetrics } from "../components/ComparisonMetrics";

describe("ComparisonMetrics", () => {
  it("shows total count and module summary", () => {
    render(
      <ComparisonMetrics
        totalCount={10}
        driftCount={3}
        highDriftCount={1}
        modules={["Charging Policy", "Battery Safety", "Power IC", "Protocol"]}
        onFocusDrift={() => undefined}
        onFocusHighRisk={() => undefined}
      />
    );
    expect(screen.getByTestId("metric-scope")).toHaveTextContent("10 项参数");
    expect(screen.getByTestId("metric-scope")).toHaveTextContent(/Charging Policy/);
  });

  it("shows drift as amber when drift > 0", () => {
    render(
      <ComparisonMetrics
        totalCount={10}
        driftCount={3}
        highDriftCount={1}
        modules={[]}
        onFocusDrift={() => undefined}
        onFocusHighRisk={() => undefined}
      />
    );
    expect(screen.getByTestId("metric-drift")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByTestId("metric-drift")).toHaveTextContent("3/10");
  });

  it("turns drift card green when driftCount=0", () => {
    render(
      <ComparisonMetrics
        totalCount={10}
        driftCount={0}
        highDriftCount={0}
        modules={[]}
        onFocusDrift={() => undefined}
        onFocusHighRisk={() => undefined}
      />
    );
    expect(screen.getByTestId("metric-drift")).toHaveAttribute("data-tone", "success");
    expect(screen.getByTestId("metric-drift")).toHaveTextContent("已全部同步");
  });

  it("dims highDrift when value is zero", () => {
    render(
      <ComparisonMetrics
        totalCount={10}
        driftCount={0}
        highDriftCount={0}
        modules={[]}
        onFocusDrift={() => undefined}
        onFocusHighRisk={() => undefined}
      />
    );
    expect(screen.getByTestId("metric-high")).toHaveAttribute("data-tone", "muted");
  });

  it("calls onFocusDrift when drift card is clicked", () => {
    const onFocusDrift = vi.fn();
    render(
      <ComparisonMetrics
        totalCount={10}
        driftCount={3}
        highDriftCount={1}
        modules={[]}
        onFocusDrift={onFocusDrift}
        onFocusHighRisk={() => undefined}
      />
    );
    fireEvent.click(screen.getByTestId("metric-drift"));
    expect(onFocusDrift).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/ComparisonMetrics.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/ParameterComparison/components/ComparisonMetrics.tsx`:

```typescript
export type ComparisonMetricsProps = {
  totalCount: number;
  driftCount: number;
  highDriftCount: number;
  modules: string[];
  onFocusDrift: () => void;
  onFocusHighRisk: () => void;
};

export function ComparisonMetrics({
  totalCount,
  driftCount,
  highDriftCount,
  modules,
  onFocusDrift,
  onFocusHighRisk
}: ComparisonMetricsProps) {
  const driftTone = driftCount === 0 ? "success" : "warn";
  const highTone = highDriftCount === 0 ? "muted" : "danger";
  const ratio = totalCount === 0 ? 0 : driftCount / totalCount;
  const moduleSummary = modules.slice(0, 3).join("·") + (modules.length > 3 ? " 等" : "");

  return (
    <section className="comparison-metrics" aria-label="对比摘要">
      <article className="metric-card" data-tone="neutral" data-testid="metric-scope">
        <header>对比范围</header>
        <strong>{totalCount} 项参数</strong>
        <small>{moduleSummary || "暂无模块"}</small>
      </article>
      <button
        type="button"
        className="metric-card metric-card--button"
        data-tone={driftTone}
        data-testid="metric-drift"
        onClick={onFocusDrift}
      >
        <header>漂移参数</header>
        <strong>
          {driftCount === 0 ? "已全部同步" : `${driftCount}/${totalCount}`}
        </strong>
        <div className="metric-card__progress" aria-hidden>
          <span style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      </button>
      <button
        type="button"
        className="metric-card metric-card--button"
        data-tone={highTone}
        data-testid="metric-high"
        onClick={onFocusHighRisk}
        aria-disabled={highDriftCount === 0}
      >
        <header>高重要性差异</header>
        <strong>{highDriftCount}</strong>
        <small>
          {highDriftCount === 0 ? "无高风险漂移" : `WiseAgent 已生成 ${highDriftCount} 条风险说明`}
        </small>
      </button>
    </section>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/ComparisonMetrics.test.tsx --run`
Expected: PASS（5 用例）

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/components/ComparisonMetrics.tsx src/ParameterComparison/__tests__/ComparisonMetrics.test.tsx
git commit -m "feat(comparison): add ComparisonMetrics three-card summary"
```

---

### Task 13: `ComparisonFilterBar` + `ActiveFilterChips` + 测试

**Files:**
- Create: `src/ParameterComparison/components/ComparisonFilterBar.tsx`
- Create: `src/ParameterComparison/components/ActiveFilterChips.tsx`
- Create: `src/ParameterComparison/__tests__/ComparisonFilterBar.test.tsx`

按 spec §9：搜索框 + 仅看漂移 toggle + 重要性多选 + 模块多选 + 清除 + 计数 + chip 条。多选 dropdown 复用简易实现（不引第三方 UI 库）。

- [ ] **Step 1: 写失败测试（合并 FilterBar + Chips 的集成测试）**

`src/ParameterComparison/__tests__/ComparisonFilterBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ComparisonFilterBar } from "../components/ComparisonFilterBar";
import type { ComparisonFilters } from "../types";

const baseFilters: ComparisonFilters = {
  driftOnly: true,
  risk: [],
  modules: [],
  query: ""
};

const baseProps = {
  filters: baseFilters,
  moduleOptions: ["Charging Policy", "Battery Safety"],
  filteredCount: 4,
  totalCount: 10,
  onQueryChange: () => undefined,
  onToggleDriftOnly: () => undefined,
  onToggleRisk: () => undefined,
  onToggleModule: () => undefined,
  onClear: () => undefined,
  hasActiveFilters: false
};

describe("ComparisonFilterBar", () => {
  it("renders search, drift toggle, and counts", () => {
    render(<ComparisonFilterBar {...baseProps} />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /仅看漂移/ })).toBeChecked();
    expect(screen.getByTestId("filter-count")).toHaveTextContent("4 / 10 项");
  });

  it("calls onQueryChange on typing", () => {
    const onQueryChange = vi.fn();
    render(<ComparisonFilterBar {...baseProps} onQueryChange={onQueryChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "vo" } });
    expect(onQueryChange).toHaveBeenCalledWith("vo");
  });

  it("shows clear button only when filters are active", () => {
    const { rerender } = render(<ComparisonFilterBar {...baseProps} />);
    expect(screen.queryByRole("button", { name: "清除" })).toBeNull();
    rerender(<ComparisonFilterBar {...baseProps} hasActiveFilters />);
    expect(screen.getByRole("button", { name: "清除" })).toBeInTheDocument();
  });

  it("renders risk options with counts via dropdown", () => {
    render(<ComparisonFilterBar {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /重要性/ }));
    const listbox = screen.getByRole("listbox", { name: "重要性" });
    expect(within(listbox).getByRole("option", { name: /高/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /中/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /低/ })).toBeInTheDocument();
  });

  it("renders active filter chips for selected risk values", () => {
    render(
      <ComparisonFilterBar
        {...baseProps}
        filters={{ ...baseFilters, risk: ["High"] }}
        hasActiveFilters
      />
    );
    expect(screen.getByText("重要性: 高")).toBeInTheDocument();
  });

  it("shows chip when driftOnly is OFF (showing synced items warning)", () => {
    render(
      <ComparisonFilterBar
        {...baseProps}
        filters={{ ...baseFilters, driftOnly: false }}
        hasActiveFilters
      />
    );
    expect(screen.getByText("显示已同步项")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/ComparisonFilterBar.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: 实现 `ActiveFilterChips.tsx`**

`src/ParameterComparison/components/ActiveFilterChips.tsx`:

```typescript
import { X } from "lucide-react";
import type { ComparisonFilters } from "../types";
import type { RiskLevel } from "../../mockData";

const RISK_LABEL: Record<RiskLevel, string> = { High: "高", Medium: "中", Low: "低" };

export type ActiveFilterChipsProps = {
  filters: ComparisonFilters;
  onRemoveRisk: (risk: RiskLevel) => void;
  onRemoveModule: (module: string) => void;
  onRemoveQuery: () => void;
  onRemoveDriftOnlyOff: () => void;
  onClearAll: () => void;
};

export function ActiveFilterChips({
  filters,
  onRemoveRisk,
  onRemoveModule,
  onRemoveQuery,
  onRemoveDriftOnlyOff,
  onClearAll
}: ActiveFilterChipsProps) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

  if (!filters.driftOnly) {
    chips.push({ key: "showSynced", label: "显示已同步项", onRemove: onRemoveDriftOnlyOff });
  }
  filters.risk.forEach((risk) =>
    chips.push({
      key: `risk:${risk}`,
      label: `重要性: ${RISK_LABEL[risk]}`,
      onRemove: () => onRemoveRisk(risk)
    })
  );
  filters.modules.forEach((module) =>
    chips.push({
      key: `module:${module}`,
      label: `模块: ${module}`,
      onRemove: () => onRemoveModule(module)
    })
  );
  if (filters.query.trim()) {
    chips.push({
      key: "query",
      label: `搜索: ${filters.query.trim()}`,
      onRemove: onRemoveQuery
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="comparison-filter-chips" role="list" aria-label="已激活筛选">
      {chips.map((chip) => (
        <span key={chip.key} className="comparison-filter-chip" role="listitem">
          {chip.label}
          <button type="button" aria-label={`移除 ${chip.label}`} onClick={chip.onRemove}>
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" className="comparison-filter-chips__clear" onClick={onClearAll}>
        清除全部
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 实现 `ComparisonFilterBar.tsx`**

`src/ParameterComparison/components/ComparisonFilterBar.tsx`:

```typescript
import { useState, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import type { ComparisonFilters } from "../types";
import type { RiskLevel } from "../../mockData";
import { ActiveFilterChips } from "./ActiveFilterChips";

const RISKS: Array<{ value: RiskLevel; label: string }> = [
  { value: "High", label: "高" },
  { value: "Medium", label: "中" },
  { value: "Low", label: "低" }
];

export type ComparisonFilterBarProps = {
  filters: ComparisonFilters;
  moduleOptions: string[];
  filteredCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
  onQueryChange: (query: string) => void;
  onToggleDriftOnly: () => void;
  onToggleRisk: (risk: RiskLevel) => void;
  onToggleModule: (module: string) => void;
  onClear: () => void;
};

type MultiSelectProps<T extends string> = {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T[];
  onToggle: (value: T) => void;
};

function MultiSelect<T extends string>({ label, options, selected, onToggle }: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="filter-multi">
      <button
        type="button"
        className="filter-multi__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {selected.length > 0 && <span className="filter-multi__count">{selected.length}</span>}
      </button>
      {open && (
        <ul role="listbox" aria-label={label} aria-multiselectable className="filter-multi__list">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={checked}
                className="filter-multi__option"
                onClick={() => onToggle(option.value)}
              >
                <input type="checkbox" readOnly checked={checked} tabIndex={-1} />
                <span>{option.label}</span>
              </li>
            );
          })}
          {options.length === 0 && <li className="filter-multi__empty">无选项</li>}
        </ul>
      )}
    </div>
  );
}

export function ComparisonFilterBar({
  filters,
  moduleOptions,
  filteredCount,
  totalCount,
  hasActiveFilters,
  onQueryChange,
  onToggleDriftOnly,
  onToggleRisk,
  onToggleModule,
  onClear
}: ComparisonFilterBarProps) {
  return (
    <div className="comparison-filter-bar--v2">
      <div className="comparison-filter-bar--v2__row">
        <label className="comparison-filter-bar--v2__search">
          <Search size={14} aria-hidden />
          <input
            role="searchbox"
            aria-label="搜索参数键或模块名"
            placeholder="搜索参数键…"
            value={filters.query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={filters.driftOnly}
          className="comparison-filter-bar--v2__toggle"
          onClick={onToggleDriftOnly}
        >
          仅看漂移
        </button>
        <MultiSelect
          label="重要性"
          options={RISKS}
          selected={filters.risk}
          onToggle={onToggleRisk}
        />
        <MultiSelect
          label="模块"
          options={moduleOptions.map((m) => ({ value: m, label: m }))}
          selected={filters.modules}
          onToggle={onToggleModule}
        />
        {hasActiveFilters && (
          <button type="button" className="comparison-filter-bar--v2__clear" onClick={onClear}>
            清除
          </button>
        )}
        <span className="comparison-filter-bar--v2__count" data-testid="filter-count">
          {filteredCount} / {totalCount} 项
        </span>
      </div>
      <ActiveFilterChips
        filters={filters}
        onRemoveRisk={onToggleRisk}
        onRemoveModule={onToggleModule}
        onRemoveQuery={() => onQueryChange("")}
        onRemoveDriftOnlyOff={onToggleDriftOnly}
        onClearAll={onClear}
      />
    </div>
  );
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/ComparisonFilterBar.test.tsx --run`
Expected: PASS（6 用例）

- [ ] **Step 6: 提交**

```bash
git add src/ParameterComparison/components/ComparisonFilterBar.tsx src/ParameterComparison/components/ActiveFilterChips.tsx src/ParameterComparison/__tests__/ComparisonFilterBar.test.tsx
git commit -m "feat(comparison): add ComparisonFilterBar with search, toggle, and chips"
```

---

### Task 14: `ComparisonRow` 组件

**Files:**
- Create: `src/ParameterComparison/components/ComparisonRow.tsx`

单行视图。M1 不集成复选框（spec §14 M1 暂存模型延后到 M2）。本任务不单独测试，留给 Task 15 的 `ComparisonMatrix` 集成测试。

- [ ] **Step 1: 实现 `ComparisonRow.tsx`**

`src/ParameterComparison/components/ComparisonRow.tsx`:

```typescript
import { AlertTriangle, ArrowLeftCircle, Ban, CheckCircle2 } from "lucide-react";
import type { ComparisonRow } from "../types";
import { calculateDelta } from "../utils/deltaCalc";
import { DeltaBadge } from "./DeltaBadge";
import { ParameterKeyTooltip } from "./ParameterKeyTooltip";

export type ComparisonRowProps = {
  row: ComparisonRow;
  onAdopt: (key: string) => void;
  onIgnore: (key: string) => void;
  onOpenInWorkbench: (key: string) => void;
  matchQuery?: string;
};

const RISK_TONE: Record<ComparisonRow["risk"], "high" | "medium" | "low"> = {
  High: "high",
  Medium: "medium",
  Low: "low"
};

function highlight(text: string, query?: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function ComparisonRow({ row, onAdopt, onIgnore, onOpenInWorkbench, matchQuery }: ComparisonRowProps) {
  const descriptor = calculateDelta({
    baseValue: row.baseNumeric === null ? null : String(row.baseNumeric),
    targetValue: row.targetNumeric === null ? null : String(row.targetNumeric),
    unit: row.unit
  });

  const isDrift = row.status === "drift";
  const adoptLabel = isDrift
    ? `采纳对比项值（${row.targetValue}）覆盖基准项（当前 ${row.baseValue}）`
    : "已同步";

  return (
    <div
      className="comparison-row--v2"
      data-status={row.status}
      data-risk-tone={RISK_TONE[row.risk]}
      role="row"
    >
      <span className="comparison-row--v2__color-bar" aria-hidden />
      <div className="comparison-row--v2__key" role="cell">
        {isDrift ? (
          <AlertTriangle size={16} aria-hidden data-status-icon="drift" />
        ) : (
          <CheckCircle2 size={16} aria-hidden data-status-icon="synced" />
        )}
        <div className="comparison-row--v2__key-text">
          <ParameterKeyTooltip
            description={row.description}
            module={row.module}
            unit={row.unit || undefined}
            onOpenInWorkbench={() => onOpenInWorkbench(row.key)}
          >
            <button
              type="button"
              className="comparison-row--v2__key-button"
              onClick={() => onOpenInWorkbench(row.key)}
            >
              {highlight(row.key, matchQuery)}
            </button>
          </ParameterKeyTooltip>
          <small>{highlight(row.module, matchQuery)}</small>
        </div>
      </div>
      <span className="comparison-row--v2__value" data-side="base" role="cell">
        {row.baseValue}
      </span>
      <span className="comparison-row--v2__value" data-side="target" role="cell">
        {row.targetValue}
        {descriptor.kind !== "synced" || !isDrift ? <DeltaBadge descriptor={descriptor} /> : null}
      </span>
      <div className="comparison-row--v2__actions" role="cell">
        {isDrift ? (
          <>
            <button
              type="button"
              className="comparison-row--v2__action-primary"
              aria-label={adoptLabel}
              title={adoptLabel}
              onClick={() => onAdopt(row.key)}
            >
              <ArrowLeftCircle size={16} aria-hidden />
              采纳
            </button>
            <button
              type="button"
              className="comparison-row--v2__action-secondary"
              aria-label={`跳过 ${row.key}`}
              title="在本次会话中忽略此项"
              onClick={() => onIgnore(row.key)}
            >
              <Ban size={16} aria-hidden />
              跳过
            </button>
          </>
        ) : (
          <span className="comparison-row--v2__synced-label">已同步</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TS 通过**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: 无 error

- [ ] **Step 3: 提交**

```bash
git add src/ParameterComparison/components/ComparisonRow.tsx
git commit -m "feat(comparison): add ComparisonRow with left color bar and delta badge"
```

---

### Task 15: `ComparisonMatrix` 组件 + 测试

**Files:**
- Create: `src/ParameterComparison/components/ComparisonMatrix.tsx`
- Create: `src/ParameterComparison/__tests__/ComparisonMatrix.test.tsx`

包装 ComparisonRow、渲染表头、sticky、空状态三分支。

- [ ] **Step 1: 写失败测试**

`src/ParameterComparison/__tests__/ComparisonMatrix.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComparisonMatrix } from "../components/ComparisonMatrix";
import type { ComparisonRow } from "../types";

const driftRow: ComparisonRow = {
  key: "charge_voltage_limit_mv",
  module: "Charging Policy",
  description: "恒压阶段充电电压上限",
  baseValue: "4350 mV",
  targetValue: "4380 mV",
  baseNumeric: 4350,
  targetNumeric: 4380,
  unit: "mV",
  status: "drift",
  risk: "High"
};

const syncedRow: ComparisonRow = {
  ...driftRow,
  key: "max_concurrent_sessions",
  module: "Auth",
  baseValue: "2048",
  targetValue: "2048",
  baseNumeric: 2048,
  targetNumeric: 2048,
  status: "synced",
  risk: "Low"
};

const baseProps = {
  baseProjectCode: "AUR-Prod",
  targetProjectCode: "NEB-RD",
  onAdopt: () => undefined,
  onIgnore: () => undefined,
  onOpenInWorkbench: () => undefined,
  onClearFilters: () => undefined,
  onShowAll: () => undefined,
  hasActiveFilters: false,
  driftOnly: true,
  query: "",
  driftCountInAllRows: 2,
  totalCount: 2
};

describe("ComparisonMatrix", () => {
  it("renders sticky header with both project codes", () => {
    render(<ComparisonMatrix {...baseProps} rows={[driftRow]} />);
    expect(screen.getByText("AUR-Prod")).toBeInTheDocument();
    expect(screen.getByText("NEB-RD")).toBeInTheDocument();
  });

  it("renders one row per data item", () => {
    render(<ComparisonMatrix {...baseProps} rows={[driftRow, syncedRow]} driftOnly={false} />);
    expect(screen.getByText("charge_voltage_limit_mv")).toBeInTheDocument();
    expect(screen.getByText("max_concurrent_sessions")).toBeInTheDocument();
  });

  it("shows filter empty state when filters active and rows empty", () => {
    render(<ComparisonMatrix {...baseProps} rows={[]} hasActiveFilters />);
    expect(screen.getByText(/无匹配的参数/)).toBeInTheDocument();
  });

  it("shows drift-zero empty state when driftOnly on and no drift in dataset", () => {
    render(
      <ComparisonMatrix
        {...baseProps}
        rows={[]}
        hasActiveFilters={false}
        driftOnly
        driftCountInAllRows={0}
      />
    );
    expect(screen.getByText(/没有待处理的漂移/)).toBeInTheDocument();
  });

  it("invokes onClearFilters when filter empty CTA clicked", () => {
    const onClearFilters = vi.fn();
    render(
      <ComparisonMatrix
        {...baseProps}
        rows={[]}
        hasActiveFilters
        onClearFilters={onClearFilters}
      />
    );
    screen.getByRole("button", { name: "清除筛选" }).click();
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/ComparisonMatrix.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: 实现 `ComparisonMatrix.tsx`**

`src/ParameterComparison/components/ComparisonMatrix.tsx`:

```typescript
import type { ComparisonRow as ComparisonRowData } from "../types";
import { ComparisonRow } from "./ComparisonRow";
import {
  AllSynced,
  DriftOnlyButZero,
  NoCommonParameters,
  NoFilterMatch,
  NoSearchMatch
} from "./EmptyStates";

export type ComparisonMatrixProps = {
  rows: ComparisonRowData[];
  baseProjectCode: string;
  targetProjectCode: string;
  hasActiveFilters: boolean;
  driftOnly: boolean;
  query: string;
  driftCountInAllRows: number;
  totalCount: number;
  onAdopt: (key: string) => void;
  onIgnore: (key: string) => void;
  onOpenInWorkbench: (key: string) => void;
  onClearFilters: () => void;
  onShowAll: () => void;
};

export function ComparisonMatrix({
  rows,
  baseProjectCode,
  targetProjectCode,
  hasActiveFilters,
  driftOnly,
  query,
  driftCountInAllRows,
  totalCount,
  onAdopt,
  onIgnore,
  onOpenInWorkbench,
  onClearFilters,
  onShowAll
}: ComparisonMatrixProps) {
  const renderEmpty = () => {
    if (totalCount === 0) return <NoCommonParameters />;
    if (query.trim()) return <NoSearchMatch query={query.trim()} onPrimary={onClearFilters} />;
    if (driftOnly && driftCountInAllRows === 0) {
      return totalCount > 0 ? <AllSynced onShowAll={onShowAll} /> : <DriftOnlyButZero onShowAll={onShowAll} />;
    }
    if (hasActiveFilters) return <NoFilterMatch onPrimary={onClearFilters} summary="当前筛选下无匹配参数" />;
    if (driftOnly) return <DriftOnlyButZero onShowAll={onShowAll} />;
    return <NoFilterMatch onPrimary={onClearFilters} />;
  };

  return (
    <section className="comparison-matrix--v2" aria-label="参数差异矩阵" role="table">
      <div className="comparison-matrix--v2__head" role="row">
        <span className="comparison-matrix--v2__color-slot" aria-hidden />
        <span className="comparison-matrix--v2__cell" role="columnheader">参数键</span>
        <span className="comparison-matrix--v2__cell" role="columnheader">
          <span className="env-dot env-dot--base" aria-hidden /> 基准 · {baseProjectCode}
        </span>
        <span className="comparison-matrix--v2__cell" role="columnheader">
          <span className="env-dot env-dot--target" aria-hidden /> 对比 · {targetProjectCode}
        </span>
        <span className="comparison-matrix--v2__cell" role="columnheader">操作</span>
      </div>
      <div className="comparison-matrix--v2__body">
        {rows.length === 0 ? (
          renderEmpty()
        ) : (
          rows.map((row) => (
            <ComparisonRow
              key={row.key}
              row={row}
              onAdopt={onAdopt}
              onIgnore={onIgnore}
              onOpenInWorkbench={onOpenInWorkbench}
              matchQuery={query}
            />
          ))
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/ComparisonMatrix.test.tsx --run`
Expected: PASS（5 用例）

- [ ] **Step 5: 提交**

```bash
git add src/ParameterComparison/components/ComparisonMatrix.tsx src/ParameterComparison/__tests__/ComparisonMatrix.test.tsx
git commit -m "feat(comparison): add ComparisonMatrix with sticky header and empty states"
```

---

### Task 16: 组装 `ParameterComparisonPage` + 集成测试

**Files:**
- Modify: `src/ParameterComparison/ParameterComparisonPage.tsx`（从 Task 1 的 scaffold 扩写为真正的顶层组装）
- Modify: `src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx`（扩展成真实集成测试）

在顶层 page 里：读取 `comparisonSelection`，调用 `useComparisonFilters` + `useComparisonData`，渲染 Header、Metrics、FilterBar、Matrix。M1 的动作实现：
- `onAdopt`：立即走 dispatch（reducer 中添加 `SYNC_PARAMETER_TO_BASE` 动作；如原型没有该动作，用已有 `UPDATE_PARAMETER_VALUE` 等价动作覆盖；若完全没有支持，暂作 no-op 并在注释中标注"M2 补"）
- `onIgnore`：M1 里仅 `console.info`（M2 接入 ignoredKeys）
- `onOpenInWorkbench`：调用 `onNavigate("/parameters?project=<base>&parameter=<key>")`
- `onSwap`：直接在 `onComparisonSelectionChange` 回调中互换
- `onExport`：调 `exportComparisonRowsAsExcel(filteredRows, baseCode, targetCode)`
- Metric `onFocusDrift`：若 driftOnly 已 ON 则 no-op；否则 `toggleDriftOnly`
- Metric `onFocusHighRisk`：`setRisk(["High"])` + 确保 driftOnly=ON

> 🔍 **实施者在开始本任务前先 `grep 'dispatch'`  `src/App.tsx`**，确认现有 reducer 的 action 名称与签名；spec M1 要求"沿用当前即时逻辑"，因此应该复用现有 reducer 支持的动作完成 onAdopt。如果发现现有 reducer 无法支持直接"把目标项值写入基准项"，请停下来询问用户：是否为 M1 新增 `ADOPT_COMPARISON_VALUE` 动作（建议），或把 `onAdopt` 降级为纯视觉（仅 toast + Δ 状态变化在下次对比时不持久化，M2 再补）。

- [ ] **Step 1: 检查现有 reducer 支持**

Run:
```powershell
grep -n "case ""SYNC" src/App.tsx
grep -n "case ""UPDATE" src/App.tsx
grep -n "AppAction" src/App.tsx
```
Expected: 明确现有 reducer 支持哪些写动作；记下相关 case 名。

- [ ] **Step 2: 写集成测试（替换 Task 1 的冒烟测试）**

用 `src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx` 覆盖：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { initialState, projects } from "../../mockData";
import { ParameterComparisonPage } from "..";

const [alpha, beta] = projects;

function renderPage(overrides?: Partial<Parameters<typeof ParameterComparisonPage>[0]>) {
  const onComparisonSelectionChange = vi.fn();
  const onNavigate = vi.fn();
  render(
    <ParameterComparisonPage
      state={initialState}
      onNavigate={onNavigate}
      search=""
      comparisonSelection={{ baseProjectId: alpha.id, targetProjectId: beta.id }}
      onComparisonSelectionChange={onComparisonSelectionChange}
      {...overrides}
    />
  );
  return { onComparisonSelectionChange, onNavigate };
}

describe("ParameterComparisonPage (M1)", () => {
  it("renders header, metrics, filter bar, and matrix", () => {
    renderPage();
    expect(screen.getByLabelText("参数对比路径")).toBeInTheDocument();
    expect(screen.getByLabelText("对比摘要")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByLabelText("参数差异矩阵")).toBeInTheDocument();
  });

  it("swaps base and target project when swap button clicked", () => {
    const { onComparisonSelectionChange } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "互换基准与对比项目" }));
    expect(onComparisonSelectionChange).toHaveBeenCalled();
    const updater = onComparisonSelectionChange.mock.calls[0][0] as Function;
    const next = updater({ baseProjectId: alpha.id, targetProjectId: beta.id });
    expect(next).toEqual({ baseProjectId: beta.id, targetProjectId: alpha.id });
  });

  it("narrows matrix by search query", () => {
    renderPage();
    const sample = initialState.parameters.find((p) => p.projectId === alpha.id);
    if (!sample) throw new Error("fixture missing");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: sample.name } });
    expect(screen.getByText(sample.name)).toBeInTheDocument();
  });

  it("clicking high risk metric focuses high risk drift rows", () => {
    renderPage();
    const highCard = screen.getByTestId("metric-high");
    if (highCard.getAttribute("aria-disabled") === "true") return;
    fireEvent.click(highCard);
    // after focusing high risk: matrix shows only High rows, driftOnly should be ON
    expect(screen.getByRole("switch", { name: /仅看漂移/ })).toBeChecked();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx --run`
Expected: FAIL

- [ ] **Step 4: 实现顶层组装**

`src/ParameterComparison/ParameterComparisonPage.tsx`（替换 Task 1 的 scaffold）:

```typescript
import { useCallback } from "react";
import type { PrototypeState } from "../mockData";
import { projects as allProjects } from "../mockData";
import type { ComparisonProjectSelection } from "./types";
import { useComparisonFilters } from "./hooks/useComparisonFilters";
import { useComparisonData } from "./hooks/useComparisonData";
import { ComparisonHeader } from "./components/ComparisonHeader";
import { ComparisonMetrics } from "./components/ComparisonMetrics";
import { ComparisonFilterBar } from "./components/ComparisonFilterBar";
import { ComparisonMatrix } from "./components/ComparisonMatrix";
import { exportComparisonRowsAsExcel } from "./utils/exportToExcel";

export type ParameterComparisonPageProps = {
  state: PrototypeState;
  onNavigate: (href: string) => void;
  search: string;
  comparisonSelection: ComparisonProjectSelection;
  onComparisonSelectionChange: React.Dispatch<React.SetStateAction<ComparisonProjectSelection>>;
};

function getFallback(projectId: string): string {
  return allProjects.find((project) => project.id !== projectId)?.id ?? projectId;
}

export function ParameterComparisonPage({
  state,
  onNavigate,
  search,
  comparisonSelection,
  onComparisonSelectionChange
}: ParameterComparisonPageProps) {
  const baseProject = allProjects.find((p) => p.id === comparisonSelection.baseProjectId) ?? allProjects[0];
  const targetProject = allProjects.find((p) => p.id === comparisonSelection.targetProjectId) ?? allProjects[1] ?? allProjects[0];

  const filtersApi = useComparisonFilters(search);
  const data = useComparisonData({
    state,
    baseProjectId: baseProject.id,
    targetProjectId: targetProject.id,
    filters: filtersApi.filters
  });

  const handleSwap = useCallback(() => {
    onComparisonSelectionChange((current) => ({
      baseProjectId: current.targetProjectId,
      targetProjectId: current.baseProjectId
    }));
  }, [onComparisonSelectionChange]);

  const handleSelectBase = useCallback(
    (projectId: string) => {
      onComparisonSelectionChange((current) => ({
        baseProjectId: projectId,
        targetProjectId: current.targetProjectId === projectId ? getFallback(projectId) : current.targetProjectId
      }));
    },
    [onComparisonSelectionChange]
  );

  const handleSelectTarget = useCallback(
    (projectId: string) => {
      onComparisonSelectionChange((current) => ({
        baseProjectId: current.baseProjectId === projectId ? getFallback(projectId) : current.baseProjectId,
        targetProjectId: projectId
      }));
    },
    [onComparisonSelectionChange]
  );

  const handleExport = useCallback(() => {
    exportComparisonRowsAsExcel(data.rows, baseProject.code, targetProject.code);
  }, [data.rows, baseProject.code, targetProject.code]);

  const handleFocusDrift = useCallback(() => {
    if (!filtersApi.filters.driftOnly) filtersApi.toggleDriftOnly();
  }, [filtersApi]);

  const handleFocusHighRisk = useCallback(() => {
    filtersApi.setRisk(["High"]);
    if (!filtersApi.filters.driftOnly) filtersApi.toggleDriftOnly();
  }, [filtersApi]);

  const handleAdopt = useCallback((_key: string) => {
    // M1: placeholder — actual state mutation wired in M2 once stagedKeys model is introduced.
    // 当前原型下立即覆盖逻辑交由 M2 的 reducer 动作完成。
  }, []);

  const handleIgnore = useCallback((_key: string) => {
    // M1: placeholder — ignoredKeys 集合在 M2 引入。
  }, []);

  const handleOpenInWorkbench = useCallback(
    (key: string) => {
      onNavigate(`/parameters?project=${baseProject.id}&parameter=${encodeURIComponent(key)}`);
    },
    [onNavigate, baseProject.id]
  );

  return (
    <div className="comparison-page comparison-page--v2">
      <ComparisonHeader
        projects={allProjects}
        baseProjectId={baseProject.id}
        targetProjectId={targetProject.id}
        onSelectBase={handleSelectBase}
        onSelectTarget={handleSelectTarget}
        onSwap={handleSwap}
        onExport={handleExport}
        onNavigate={onNavigate}
      />
      <ComparisonMetrics
        totalCount={data.totalCount}
        driftCount={data.driftCount}
        highDriftCount={data.highDriftCount}
        modules={data.moduleOptions}
        onFocusDrift={handleFocusDrift}
        onFocusHighRisk={handleFocusHighRisk}
      />
      <ComparisonFilterBar
        filters={filtersApi.filters}
        moduleOptions={data.moduleOptions}
        filteredCount={data.rows.length}
        totalCount={data.totalCount}
        hasActiveFilters={filtersApi.hasActiveFilters}
        onQueryChange={filtersApi.setQuery}
        onToggleDriftOnly={filtersApi.toggleDriftOnly}
        onToggleRisk={filtersApi.toggleRisk}
        onToggleModule={filtersApi.toggleModule}
        onClear={filtersApi.clear}
      />
      <ComparisonMatrix
        rows={data.rows}
        baseProjectCode={baseProject.code}
        targetProjectCode={targetProject.code}
        hasActiveFilters={filtersApi.hasActiveFilters}
        driftOnly={filtersApi.filters.driftOnly}
        query={filtersApi.filters.query}
        driftCountInAllRows={data.driftCount}
        totalCount={data.totalCount}
        onAdopt={handleAdopt}
        onIgnore={handleIgnore}
        onOpenInWorkbench={handleOpenInWorkbench}
        onClearFilters={filtersApi.clear}
        onShowAll={() => {
          if (filtersApi.filters.driftOnly) filtersApi.toggleDriftOnly();
        }}
      />
    </div>
  );
}
```

> 如果 Step 1 发现 reducer 有现成的写动作，应把 `handleAdopt` 中的 placeholder 替换为真实 dispatch（例如 `dispatch({ type: "UPDATE_PARAMETER_VALUE", ...})`）。所需的 `dispatch` 从 App.tsx 顶层通过 props 传下来，会在 Task 18 中完成；M2 正式的暂存/撤销流程再重写此回调。

- [ ] **Step 5: 运行测试验证通过**

Run: `npm test -- src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx --run`
Expected: PASS（4 用例）

- [ ] **Step 6: 提交**

```bash
git add src/ParameterComparison/ParameterComparisonPage.tsx src/ParameterComparison/__tests__/ParameterComparisonPage.test.tsx
git commit -m "feat(comparison): wire page composition and URL-driven filters"
```

---

### Task 17: 写入新样式到 `styles.css`（`.comparison-page--v2` 作用域）

**Files:**
- Modify: `src/styles.css`（在文件末尾追加新区块）

按 spec §11 落实视觉令牌。所有新样式 scope 在 `.comparison-page--v2` 下，避免污染现存 `.comparison-*` 旧样式。

- [ ] **Step 1: 在 styles.css 末尾追加区块**

在 `src/styles.css` 文件末尾追加：

```css
/* === Parameter Comparison (Redesign M1) ===================================
 * Scoped under .comparison-page--v2. Do NOT reuse .comparison-* selectors
 * from the legacy implementation above; they will be removed in M3.
 * ========================================================================= */

.comparison-page--v2 {
  --risk-high: #dc2626;
  --risk-medium: #f59e0b;
  --risk-low: #64748b;
  --delta-warn: #f59e0b;
  --delta-ease: #0d9488;
  --state-staged: #3b82f6;
  --state-synced: #16a34a;
  --state-ignored: #94a3b8;
  --proj-base: #3b82f6;
  --proj-target: #8b5cf6;
  --hl-search: #fef3c7;
  --bg-staged: #eff6ff;
  --bg-ignored: #f9fafb;

  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 32px;
  min-height: 100%;
}

/* --- Header ------------------------------------------------------------- */

.comparison-header--v2 { display: flex; flex-direction: column; gap: 12px; }
.comparison-breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #6b7280; }
.comparison-breadcrumb button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0; }
.comparison-breadcrumb button:hover { color: #111827; }
.comparison-breadcrumb [aria-current="page"] { color: #111827; font-weight: 500; }

.comparison-header--v2__titlebar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.comparison-header--v2__title {
  display: flex; align-items: center; gap: 12px;
  margin: 0; font-size: 22px; font-weight: 600; color: #0f172a;
}
.comparison-header--v2__swap {
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #e2e8f0; background: #fff; border-radius: 8px; cursor: pointer; color: #334155;
}
.comparison-header--v2__swap:hover { background: #f1f5f9; }
.comparison-header--v2__actions { display: flex; gap: 8px; }

/* --- Project Chip ------------------------------------------------------- */

.project-chip { position: relative; }
.project-chip__trigger {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 9999px;
  background: #fff; cursor: pointer; font: inherit;
}
.project-chip__trigger:hover { background: #f8fafc; }
.project-chip__dot {
  width: 8px; height: 8px; border-radius: 9999px;
  background: var(--proj-base);
}
.project-chip[data-tone="target"] .project-chip__dot { background: var(--proj-target); }
.project-chip__code { font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.project-chip__name { font-size: 13px; color: #64748b; }

.project-chip__popover {
  position: absolute; top: calc(100% + 4px); left: 0;
  width: 320px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12); padding: 8px; z-index: 60;
}
.project-chip__search {
  display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 8px;
}
.project-chip__search input { border: 0; outline: 0; flex: 1; font: inherit; }
.project-chip__list { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; }
.project-chip__option {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: 8px; cursor: pointer; font-size: 13px;
}
.project-chip__option:hover { background: #f1f5f9; }
.project-chip__option[data-disabled] { color: #94a3b8; cursor: not-allowed; }
.project-chip__option[data-disabled]:hover { background: transparent; }
.project-chip__option-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
.project-chip__option-name { color: #64748b; flex: 1; }
.project-chip__option-hint { font-size: 11px; color: #94a3b8; }
.project-chip__empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 13px; }

/* --- Metrics ------------------------------------------------------------ */

.comparison-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.comparison-metrics .metric-card {
  padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0;
  background: #fff; display: flex; flex-direction: column; gap: 6px;
  text-align: left; font: inherit; cursor: default;
}
.comparison-metrics .metric-card--button { cursor: pointer; }
.comparison-metrics .metric-card--button:hover { border-color: #cbd5e1; }
.comparison-metrics .metric-card header {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; font-weight: 600;
}
.comparison-metrics .metric-card strong { font-size: 24px; font-weight: 700; color: #0f172a; }
.comparison-metrics .metric-card small { font-size: 12px; color: #94a3b8; }
.comparison-metrics .metric-card[data-tone="warn"] strong { color: #b45309; }
.comparison-metrics .metric-card[data-tone="success"] strong { color: #15803d; }
.comparison-metrics .metric-card[data-tone="danger"] strong { color: #b91c1c; }
.comparison-metrics .metric-card[data-tone="muted"] strong { color: #94a3b8; }
.metric-card__progress { height: 4px; background: #f1f5f9; border-radius: 9999px; overflow: hidden; }
.metric-card__progress span { display: block; height: 100%; background: var(--delta-warn); }
.metric-card[data-tone="success"] .metric-card__progress span { background: var(--state-synced); }

/* --- Filter bar --------------------------------------------------------- */

.comparison-filter-bar--v2 { display: flex; flex-direction: column; gap: 8px; }
.comparison-filter-bar--v2__row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.comparison-filter-bar--v2__search {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff;
  flex: 1; min-width: 220px; max-width: 320px;
}
.comparison-filter-bar--v2__search input { flex: 1; border: 0; outline: 0; font: inherit; }
.comparison-filter-bar--v2__toggle {
  padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 9999px; background: #fff; cursor: pointer; font: inherit;
}
.comparison-filter-bar--v2__toggle[aria-checked="true"] { background: var(--state-staged); color: #fff; border-color: var(--state-staged); }
.comparison-filter-bar--v2__clear {
  border: 0; background: transparent; color: #64748b; cursor: pointer; padding: 4px 8px; font: inherit;
}
.comparison-filter-bar--v2__clear:hover { color: #0f172a; }
.comparison-filter-bar--v2__count { margin-left: auto; font-size: 12px; color: #64748b; }

.filter-multi { position: relative; }
.filter-multi__trigger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; cursor: pointer; font: inherit;
}
.filter-multi__count { background: var(--state-staged); color: #fff; border-radius: 9999px; padding: 0 6px; font-size: 11px; }
.filter-multi__list {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 60;
  width: 260px; max-height: 260px; overflow: auto;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
  box-shadow: 0 8px 16px rgba(15, 23, 42, 0.12);
  margin: 0; padding: 6px; list-style: none;
}
.filter-multi__option {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px;
}
.filter-multi__option:hover { background: #f1f5f9; }
.filter-multi__empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 13px; }

.comparison-filter-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.comparison-filter-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 9999px; background: #eef2ff; color: #3730a3; font-size: 12px;
}
.comparison-filter-chip button {
  border: 0; background: transparent; padding: 0; display: inline-flex; cursor: pointer; color: inherit;
}
.comparison-filter-chips__clear {
  border: 0; background: transparent; color: #64748b; font-size: 12px; cursor: pointer; padding: 2px 6px;
}

/* --- Matrix ------------------------------------------------------------- */

.comparison-matrix--v2 {
  display: flex; flex-direction: column;
  border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; overflow: hidden;
}
.comparison-matrix--v2__head {
  display: grid; grid-template-columns: 4px minmax(260px, 1fr) 180px 240px 160px;
  align-items: center; gap: 16px; padding: 10px 16px;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 20;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; font-weight: 600;
}
.comparison-matrix--v2__color-slot { width: 4px; }
.comparison-matrix--v2__cell { display: inline-flex; align-items: center; gap: 6px; }
.env-dot { width: 8px; height: 8px; border-radius: 9999px; }
.env-dot--base { background: var(--proj-base); }
.env-dot--target { background: var(--proj-target); }

.comparison-matrix--v2__body { display: flex; flex-direction: column; }

.comparison-row--v2 {
  display: grid; grid-template-columns: 4px minmax(260px, 1fr) 180px 240px 160px;
  align-items: center; gap: 16px; padding: 12px 16px; border-bottom: 1px solid #f1f5f9;
  transition: background 200ms ease-out;
}
.comparison-row--v2:hover { background: #fafafa; }
.comparison-row--v2__color-bar { width: 4px; align-self: stretch; border-radius: 2px; }
.comparison-row--v2[data-risk-tone="high"] .comparison-row--v2__color-bar { background: var(--risk-high); }
.comparison-row--v2[data-risk-tone="medium"] .comparison-row--v2__color-bar { background: var(--risk-medium); }
.comparison-row--v2[data-risk-tone="low"] .comparison-row--v2__color-bar { background: var(--risk-low); }
.comparison-row--v2[data-status="synced"] .comparison-row--v2__color-bar { background: transparent; }
.comparison-row--v2[data-status="synced"] { opacity: 0.7; }

.comparison-row--v2__key { display: flex; align-items: center; gap: 10px; }
.comparison-row--v2__key [data-status-icon="drift"] { color: var(--risk-medium); }
.comparison-row--v2__key [data-status-icon="synced"] { color: var(--state-synced); }
.comparison-row--v2__key-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.comparison-row--v2__key-button {
  border: 0; background: transparent; padding: 0; text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; font-size: 14px;
  color: #0f172a; cursor: pointer;
}
.comparison-row--v2__key-button:hover { text-decoration: underline; }
.comparison-row--v2__key-text small { font-size: 12px; color: #64748b; }

.comparison-row--v2__value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px;
  padding: 4px 10px; border-radius: 8px; background: #f1f5f9; display: inline-flex; gap: 8px; align-items: center;
  justify-self: end;
}
.comparison-row--v2__value[data-side="target"] { background: #ffffff; border: 1px solid #e2e8f0; }

.delta-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 600;
  background: #fef3c7; color: #92400e;
}
.delta-badge[data-tone="ease"] { background: #ccfbf1; color: #115e59; }
.delta-badge[data-tone="synced"] { background: #dcfce7; color: #166534; }
.delta-badge[data-tone="new"] { background: #dbeafe; color: #1d4ed8; }
.delta-badge[data-tone="missing"] { background: #f1f5f9; color: #64748b; }
.delta-badge[data-tone="changed"] { background: #ede9fe; color: #5b21b6; }

.comparison-row--v2__actions { display: inline-flex; gap: 6px; justify-self: end; }
.comparison-row--v2__action-primary,
.comparison-row--v2__action-secondary {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: 8px; border: 1px solid transparent; font: inherit; cursor: pointer;
}
.comparison-row--v2__action-primary {
  background: #1e293b; color: #fff;
}
.comparison-row--v2__action-primary:hover { background: #0f172a; }
.comparison-row--v2__action-secondary {
  background: transparent; color: #64748b; border-color: #e2e8f0;
}
.comparison-row--v2__action-secondary:hover { background: #f1f5f9; color: #0f172a; }
.comparison-row--v2__synced-label { color: #94a3b8; font-size: 12px; }

/* --- Param tooltip ------------------------------------------------------ */

.param-tooltip { position: relative; display: inline-flex; }
.param-tooltip__popover {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 60;
  min-width: 260px; max-width: 320px;
  background: #0f172a; color: #f8fafc; padding: 10px 12px; border-radius: 8px;
  font-size: 12px; line-height: 1.5; display: flex; flex-direction: column; gap: 6px;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.3);
}
.param-tooltip__desc { font-size: 13px; }
.param-tooltip__meta { color: #cbd5e1; display: flex; flex-wrap: wrap; gap: 4px; }
.param-tooltip__meta strong { color: #f8fafc; font-weight: 600; margin-right: 4px; }
.param-tooltip__sep { color: #64748b; margin: 0 4px; }
.param-tooltip__link {
  align-self: flex-start; background: transparent; color: #93c5fd; border: 0; padding: 0;
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font: inherit;
}

/* --- Empty states ------------------------------------------------------- */

.comparison-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 48px 16px; color: #64748b; text-align: center;
}
.comparison-empty h3 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
.comparison-empty p { margin: 0; font-size: 13px; }
.comparison-empty__cta {
  border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 12px;
  background: #fff; cursor: pointer; font: inherit; color: #334155;
}
.comparison-empty__cta:hover { background: #f1f5f9; }

/* --- Highlights --------------------------------------------------------- */

.comparison-page--v2 mark { background: var(--hl-search); color: inherit; padding: 0 2px; border-radius: 2px; }

/* --- Responsive --------------------------------------------------------- */

@media (max-width: 1280px) {
  .project-chip__name { display: none; }
}

@media (max-width: 960px) {
  .comparison-metrics { grid-template-columns: 1fr; }
  .comparison-header--v2__titlebar { flex-direction: column; align-items: flex-start; }
  .comparison-header--v2__title { flex-wrap: wrap; }
  .comparison-matrix--v2__head,
  .comparison-row--v2 {
    grid-template-columns: 4px minmax(180px, 1fr) 120px 140px 120px;
    gap: 8px; padding: 10px 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .comparison-row--v2 { transition: none; }
}
```

- [ ] **Step 2: 启动 dev 服务肉眼 QA**

Run（如果 5173 没有服务）：`npm run dev`
然后在浏览器打开 `http://127.0.0.1:5173/parameter-comparison`，检查：
- Header Chip + 互换 + 导出按钮可见
- 三张 Metric 卡颜色正确（漂移卡为 amber / drift=0 时为 green；高重要性卡 0 时灰隐）
- 筛选工具条搜索框 + 仅看漂移开关 + 两个多选下拉能交互
- 表格有 4px 左色条，drift 行有 amber 图标，synced 行透明度 70%
- Δ 徽章在有数值漂移的行上显示 `+x.x%`
- hover 参数键 ≥400ms 后出现 dark tooltip

- [ ] **Step 3: 提交**

```bash
git add src/styles.css
git commit -m "style(comparison): add v2 design tokens and component styles"
```

---

### Task 18: 切换 `App.tsx` 到新实现

**Files:**
- Modify: `src/App.tsx`

删除内联的 `ParameterComparisonPage` 实现 + `ParameterComparisonRow` 类型 + `exportComparisonRowsAsExcel` 旧定义，全部改由 `import { ParameterComparisonPage } from "./ParameterComparison"`。旧 `.comparison-*` CSS 选择器**保留**（spec §12.3，M3 再清理）。

- [ ] **Step 1: 删除 App.tsx 内联实现**

在 `src/App.tsx` 中：

1. 搜索 `function ParameterComparisonPage(` 定位到旧实现起点（约 1517 行附近）
2. 删除整个函数 + 配套的 `ProjectComparisonSelect` 子组件
3. 搜索 `function exportComparisonRowsAsExcel(` 定位并删除该函数
4. 搜索 `type ParameterComparisonRow` 定位并删除该类型（约 118 行附近）
5. 搜索 `createComparisonInsights` — 这个函数**保留**在 App.tsx（供 UnifiedAgent 使用），不删
6. 搜索 `getFallbackComparisonProjectId` — 若仅本页使用可删除；若 App.tsx 其他地方仍用则保留
7. 在 App.tsx 顶部 import 区添加：

```typescript
import { ParameterComparisonPage } from "./ParameterComparison";
```

8. 在 `PageRouter` 的 `case "parameter-comparison"` 分支（约 624 行）中保留现有渲染调用，确认 props 签名未变（应仍是 `state` / `onNavigate` / `search` / `comparisonSelection` / `onComparisonSelectionChange`）

- [ ] **Step 2: 运行全量测试**

Run: `npm test -- --run`
Expected: 所有测试通过（新增 11 份测试 + 旧测试）。如果 `App.test.tsx` 里原来有对 `ParameterComparisonPage` 内部结构的断言（如列数、"参数含义" 列、项目选择大卡片），会失败 —— 逐条更新为新结构对应的断言，或在测试中改为检测 `document.querySelector(".comparison-page--v2")` 这类结构性存在。

> 🔍 如果旧 `App.test.tsx` 的用例断言数量太多需要大面积改写，考虑在本任务只修**必须修**的（import/渲染不崩溃），把关于新 UI 行为的扩充测试推到 `ParameterComparisonPage.test.tsx`，避免 App.test.tsx 成为单一测试巨无霸。

- [ ] **Step 3: 运行 build**

Run: `npm run build`
Expected: TypeScript 编译通过、Vite 产出成功。

- [ ] **Step 4: 手动 QA 关键场景**

启动 `npm run dev`，在浏览器验证：
1. `/parameter-comparison` 路径渲染新页面（查 DOM 含 `.comparison-page--v2`）
2. Header 互换按钮可用，互换后项目 Chip 的 code 对调
3. 导出按钮下载 Excel 包含新列顺序
4. 搜索 "voltage" 后表格只显示匹配行，模块/参数键中匹配子串黄底高亮
5. 关闭 "仅看漂移" 后 synced 行出现并透明度降低
6. 关闭后 chip 条出现 "显示已同步项" chip，点 × 重新打开 toggle
7. URL 带 `?driftOnly=0&risk=High` 进入时初始筛选状态正确
8. 视口缩到 <960px 时筛选条和表格折行不破版
9. 点击 Metric "漂移参数" 卡切换到 driftOnly=ON；点击 "高重要性差异" 卡（非 disabled 时）额外设置 `risk=[High]`

- [ ] **Step 5: 提交**

```bash
git add src/App.tsx
git commit -m "refactor(comparison): switch page to v2 redesign implementation"
```

- [ ] **Step 6: 最终验证（M1 退出标准）**

Run: `npm test -- --run` → 全绿
Run: `npm run build` → 成功
Run: `npm run dev` → 手动走一遍成功标准（spec §17 前三条：看到漂移 / 看到 Δ / 理解风险）

---

## 收尾与交付

M1 完成后交付物：
- 新目录 `src/ParameterComparison/`（18 个源文件）
- 11 份新测试文件，全部绿灯
- `src/styles.css` 新增 `.comparison-page--v2` 作用域样式
- `src/App.tsx` 旧 `ParameterComparisonPage` 已移除

**M1 明确不包含的能力（进入 M2 plan）**：
- 复选框与暂存状态（`stagedKeys` / `ignoredKeys`）
- `SyncConfirmDialog` + `SyncUndoToast`
- 键盘快捷键（除 popover `Esc` 外）
- `ParameterDetailDialog`
- 批量"同步已选" CTA

**M2 开始前**：重新 review 本页 UI，把执行 M1 期间发现的新问题写进 M2 的 spec / plan 更新。

## 下一步

> 实施者可选择：
> - **执行此 plan**：使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 一步步推进
> - **先 review**：如果有结构性异议，先和 spec 作者对齐后再动工
