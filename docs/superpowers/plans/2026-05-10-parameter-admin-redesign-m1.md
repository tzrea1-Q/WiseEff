# 项目参数管理后台 · Milestone 1（地基 + P0 安全 + 列表治理 + 详情校正）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/parameter-admin`（项目参数管理后台）的地基和核心安全/治理能力落地：新增用户-角色-审计扩展数据模型、精简并去重 PageHeader、把 4 张 KPI 大卡压成单行 Strip、参数库列表一次性补齐搜索 + 风险/模块/覆盖筛选 + 模块分组折叠 + URL 同步（含"孤儿参数"独有视角）、共享定义表单改造（RiskPicker + 推荐值全局生效提示 + 范围 min/max 拆分 + 参数名校验）、项目值矩阵改造（只读 `updatedAt` + 单位 suffix + 越界校验 + 偏差色标）、脏态徽章 + 合并式「导出 ▾」菜单 + diff 摘要对话框、UndoableToast 统一组件 + 删除二次确认 + beforeunload 守护、Agent `createAgentPlan` 分支薄更新。M1 结束时 spec §27 演示脚本前 6 步可稳定走通。

**Architecture:** 把 `ParameterAdminPage` 抽到独立文件 `src/ParameterAdminPage.tsx`。状态层新增 `users / currentUserId / lastExportedSnapshot / _undoStack / insightDismissedIds / aiFlaggedImportIds` 六个字段；`Role` 扩展 `capabilities / description`；`AuditEvent` 扩展 `kind / parameterId / batchId / userId / metadata / viaAgent`。新增派生模块 `parameterAdminAnalytics.ts` 承载 `getCoverage / selectDirtyCount / migrateParameterRange / buildAuditEvent / deriveParameterAdminInsights`。Reducer 新增 `ASSIGN_USER_ROLE / TOGGLE_USER_ACTIVE / ADD_USER / UNDO_LAST_DESTRUCTIVE / CLEAR_UNDO / MARK_EXPORTED / DISMISS_INSIGHT / SET_AI_FLAGGED_IMPORT_IDS / AGENT_ACTION_EXECUTED` 9 个动作（`BULK_* / BATCH_IMPORT_*` 留给 M2）。新增 UI 组件：`DirtyIndicator / KpiStrip / ParameterLibraryList / ParameterGroupSection / RiskPicker / ProjectValueMatrixRow / UndoableToast / DeleteParameterDialog / ExportDiffDialog`。`AgentInsightBar` 复用 debugging-workbench 已做好的同名组件（`src/components/AgentInsightBar.tsx`）。

**Tech Stack:** React 19 + TypeScript + Vite 7 + Vitest 4 + @testing-library/react 16 + 原生 CSS。无新依赖（shadcn 组件按姊妹 spec 节奏延后到 m2 批次引入；本 m1 使用现有 `src/components` 自制组件维持视觉家族一致）。

**Spec:** `docs/superpowers/specs/2026-05-10-parameter-admin-redesign-design.md`

**Scope boundary (M1 不做):**

- 审计抽屉完整 UI（视角 chip、反向跳转、批次展开）—— 本 m1 只铺通数据契约和事件写入，UI 侧仅保留顶部 `[🕐 审计]` 按钮占位（点击仅 console.info）
- 权限 Modal 与 AddUserDialog UI —— 数据契约与 reducer 已就绪，UI 留给 m2；顶部 `[⛁ 权限]` 按钮同样占位
- 批量导入向导（Step 1-3 UI、Diff 预览、batchId 关联写入）
- 多选模式 + BulkActionBar + `BULK_* / BATCH_IMPORT_*` reducer actions
- 全量键盘快捷键 + `?` 帮助 Popover（本 m1 只做 Tab 基线 + `Esc` 关 Dialog）
- 响应式 ≤1280 审计抽屉变 Modal / ≤1024 列表变抽屉 / <768 子路由形态（本 m1 只做 ≥1440 主视图 + 1024–1280 优雅压缩；≤1024 降级到现有布局，不塌陷即可）
- AgentInsightBar 里的「权限异常」次级 Insight（需要审计事件数据足够丰富，留给 m2）
- Agent 四个动作的完整副作用（scan-orphans / draft-cleanup 本 m1 实现；preview-import / summarize-audit 留给 m2 因依赖未完成的 UI）

以上每一项都对应 spec 里明确定义的能力，M1 完成后由 m2 / m3 plan 承接。本 m1 结束时 `npm run dev` 打开 `/parameter-admin` 必须满足：

1. PageHeader 标题不重复；脏态徽章正确跟随编辑出现/消失。
2. KPI Strip 五项可点击跳转正确筛选。
3. 列表搜索 + 风险 chip + 模块多选 + 覆盖下拉（含孤儿）+ 模块分组折叠 + 排序 + URL 同步全部可用。
4. 详情编辑 1 个参数的任一字段 + 改 1 个项目取值后，脏态计数为 2。
5. 点删除参数弹 Confirm，确认后 Toast 10s 可 Undo。
6. 点导出 ▾ → 下载 → Confirm 预览 diff → 确认后脏态清零。
7. 有脏态时 `beforeunload` 拦截关闭标签页。
8. 所有新增单测 / 组件测试 / 现有回归测试全绿，`npm run build` 无 TS 错误。

---

## 文件结构

### 新增文件

- `src/ParameterAdminPage.tsx` — 抽出重构后的页面组件
- `src/ParameterAdminPage.test.tsx` — 页面级集成行为测试
- `src/parameterAdminAnalytics.ts` — 纯派生函数模块
- `src/parameterAdminAnalytics.test.ts` — 纯函数单测
- `src/components/DirtyIndicator.tsx` — 脏态徽章
- `src/components/DirtyIndicator.test.tsx`
- `src/components/KpiStrip.tsx` — KPI 单行带
- `src/components/KpiStrip.test.tsx`
- `src/components/RiskPicker.tsx` — 高/中/低 色标选择器
- `src/components/RiskPicker.test.tsx`
- `src/components/UndoableToast.tsx` — Undo 统一 Toast 组件
- `src/components/UndoableToast.test.tsx`
- `src/components/DeleteParameterDialog.tsx` — 删除参数 Confirm
- `src/components/DeleteParameterDialog.test.tsx`
- `src/components/ExportDiffDialog.tsx` — 导出 diff 摘要
- `src/components/ExportDiffDialog.test.tsx`
- `src/components/AgentInsightBar.tsx` — 复用 debugging m1 若已合入则跳过新建，仅扩展；否则先新建最简版
- `src/components/AgentInsightBar.test.tsx`
- `src/hooks/useParamAdminSearch.ts` — URL 查询参数 hook
- `src/hooks/useParamAdminSearch.test.ts`
- `src/hooks/useBeforeUnload.ts` — beforeunload hook
- `src/hooks/useBeforeUnload.test.ts`

### 修改文件

- `src/App.tsx` — 从内联 `ParameterAdminPage` 改为 `import { ParameterAdminPage } from "./ParameterAdminPage"`；`AppAction` 追加 9 个新动作；`appReducer` 实现它们；`AppState` 合并新字段
- `src/mockData.ts` — `Role` 扩展 `capabilities / description`；新增 `User / RoleCapability / ImportBatch / AuditEventKind / UndoEntry` 类型；`AuditEvent` 扩展字段；`PrototypeState` 扩展 6 字段；`createPrototypeState` 初始化；新增 8 条 `users` mock 和 20+ 条 `auditEvents` mock
- `src/appConfig.ts` — `createAgentPlan("/parameter-admin")` 分支：`prompts` 与 `actions` 升级为 spec §11.1 的四项（m1 只实现 `scan-orphans` / `draft-cleanup`，另外两项保留 id 不注册 handler 以便 m2 接入）
- `src/styles.css` — 新增 `.param-admin-shell / .param-admin-header / .kpi-strip / .kpi-item / .dirty-indicator / .library-header / .filter-chips / .param-group / .param-row / .risk-picker / .project-value-row / .undo-toast / .delete-parameter-dialog / .export-diff-dialog / .insight-bar`；删除 `.config-admin-grid / .library-list / .config-list-row / .config-list-actions / .project-value-table / .project-value-head / .project-value-row` 等旧 `/parameter-admin` 专属类（保留通用 `.library-panel / .panel-header` 以便不影响其它页）
- `src/App.test.tsx` — 修复因 `ParameterAdminPage` 抽出 + 数据契约变更导致的引用断言；尤其是对 `dispatch({ type: "DELETE_PROJECT_PARAMETER" })` 的旧断言需要配合新增 Confirm Dialog 更新；对 `dispatch({ type: "IMPORT_PARAMETERS" })` 的旧 Agent 动作断言保留但标注「留给 m2 重做」

### 删除文件

- 无

---

## 验证命令总览

- 单个文件单测：`npm test -- <file>`
- 全量单测：`npm test`
- TS 检查 + 构建：`npm run build`
- 启动预览：`npm run dev` 后浏览 `http://127.0.0.1:5173/parameter-admin`
- 视觉 QA（人工）：Playwright MCP 截图到 `qa-screenshots/parameter-admin-*.png`

---

## Task 0：扩展数据类型（mockData.ts + powerManagementConfig.ts 不动）

**目的：** 在动任何 UI 前，先把 M1 需要的所有新类型、Role 扩展字段、AuditEvent 扩展字段、PrototypeState 新字段集中写进 `mockData.ts`，并用类型级 + 运行时测试守住。后续所有 Task 都依赖这块地基。

**Files:**
- Modify: `src/mockData.ts`
- Create: `src/mockData.parameterAdmin.test.ts`

---

- [ ] **Step 1：新建类型与初始值测试**

Create `src/mockData.parameterAdmin.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { initialState, roles, users, auditEvents } from "./mockData";
import type {
  User,
  RoleCapability,
  ImportBatch,
  AuditEventKind,
  UndoEntry
} from "./mockData";

describe("参数管理后台数据契约", () => {
  it("Role 均具备 capabilities 和 description 字段", () => {
    for (const role of roles) {
      expect(Array.isArray(role.capabilities)).toBe(true);
      expect(role.capabilities.length).toBeGreaterThan(0);
      expect(typeof role.description).toBe("string");
      expect(role.description.length).toBeGreaterThan(0);
    }
    const admin = roles.find(r => r.id === "admin");
    expect(admin?.capabilities).toContain("manage-permissions");
    const hardware = roles.find(r => r.id === "hardware");
    expect(hardware?.capabilities).toEqual(["view"]);
  });

  it("users 至少有 8 条，且均绑定有效 roleId", () => {
    expect(users.length).toBeGreaterThanOrEqual(8);
    const roleIds = new Set(roles.map(r => r.id));
    for (const user of users) {
      expect(roleIds.has(user.roleId)).toBe(true);
      expect(user.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(typeof user.isActive).toBe("boolean");
      expect(typeof user.createdAt).toBe("string");
    }
    expect(users.filter(u => u.roleId === "admin").length).toBeGreaterThanOrEqual(1);
    expect(users.filter(u => u.roleId === "hardware").length).toBeGreaterThanOrEqual(2);
    expect(users.some(u => !u.isActive)).toBe(true);
  });

  it("initialState 上存在所有新字段且初始值符合 spec §13.2", () => {
    expect(initialState.users).toBe(users);
    expect(typeof initialState.currentUserId).toBe("string");
    const current = users.find(u => u.id === initialState.currentUserId);
    expect(current?.roleId).toBe("admin");
    expect(typeof initialState.lastExportedSnapshot).toBe("string");
    expect(initialState.lastExportedSnapshot.length).toBeGreaterThan(0);
    expect(initialState.lastExportedSnapshot).toBe(
      JSON.stringify(initialState.configDraft)
    );
    expect(initialState._undoStack).toBeNull();
    expect(initialState.insightDismissedIds).toEqual([]);
    expect(initialState.aiFlaggedImportIds).toEqual([]);
  });

  it("AuditEvent 支持 kind 分派和扩展 metadata", () => {
    const kinds: AuditEventKind[] = [
      "parameter-add",
      "parameter-update",
      "parameter-delete",
      "batch-import",
      "bulk-risk-change",
      "bulk-module-change",
      "bulk-delete",
      "user-add",
      "user-role-change",
      "user-toggle",
      "export",
      "rollback-undo",
      "agent-action"
    ];
    expect(kinds.length).toBe(13);
    for (const event of auditEvents) {
      expect(typeof event.kind).toBe("string");
      expect(kinds).toContain(event.kind as AuditEventKind);
    }
    expect(auditEvents.length).toBeGreaterThanOrEqual(20);
    expect(auditEvents.some(e => e.parameterId)).toBe(true);
    expect(auditEvents.some(e => e.batchId)).toBe(true);
    expect(auditEvents.some(e => e.userId)).toBe(true);
    expect(auditEvents.some(e => e.viaAgent === true)).toBe(true);
  });

  it("UndoEntry / ImportBatch 类型可运行时承载结构", () => {
    const entry: UndoEntry = {
      id: "undo-1",
      actionKind: "parameter-delete",
      message: "已删除 fast_charge_current_limit_ma",
      snapshot: { configDraft: initialState.configDraft },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
      originalAuditEventId: "audit-xxx"
    };
    expect(entry.actionKind).toBe("parameter-delete");

    const batch: ImportBatch = {
      id: "BI-000001",
      source: "demo",
      demoSourceId: "mixed-8",
      submittedAt: new Date().toISOString(),
      summary: { added: 3, updated: 5, deleted: 0 },
      affectedIds: ["p1", "p2"],
      aiFlaggedIds: ["p1"]
    };
    expect(batch.summary.added + batch.summary.updated).toBe(8);
  });

  it("RoleCapability 联合类型覆盖四档", () => {
    const caps: RoleCapability[] = ["view", "edit", "publish", "manage-permissions"];
    expect(caps.length).toBe(4);
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npm test -- mockData.parameterAdmin`
Expected: FAIL。多个 TS2339 / 未定义符号（`users`, `User`, `RoleCapability`, `AuditEventKind`, `UndoEntry`, `ImportBatch` 等均未导出）。

- [ ] **Step 3：在 `mockData.ts` 中声明新类型**

Edit `src/mockData.ts`，在 `AuditEvent` 类型上方集中新增类型声明（保持既有位置不动）：

```ts
export type RoleCapability = "view" | "edit" | "publish" | "manage-permissions";

export type User = {
  id: string;
  name: string;
  email: string;
  roleId: string;
  isActive: boolean;
  createdAt: string;
};

export type AuditEventKind =
  | "parameter-add"
  | "parameter-update"
  | "parameter-delete"
  | "batch-import"
  | "bulk-risk-change"
  | "bulk-module-change"
  | "bulk-delete"
  | "user-add"
  | "user-role-change"
  | "user-toggle"
  | "export"
  | "rollback-undo"
  | "agent-action";

export type ImportBatch = {
  id: string;
  source: "file" | "paste" | "demo";
  demoSourceId?: string;
  submittedAt: string;
  summary: { added: number; updated: number; deleted: number };
  affectedIds: string[];
  aiFlaggedIds: string[];
};

export type UndoEntry = {
  id: string;
  actionKind: AuditEventKind;
  message: string;
  snapshot: Partial<PrototypeState>;
  createdAt: string;
  expiresAt: string;
  originalAuditEventId: string;
};
```

- [ ] **Step 4：扩展 `Role` 类型与 roles 常量**

修改 `Role` 类型：

```ts
export type Role = {
  id: string;
  name: string;
  capabilities: RoleCapability[];
  description: string;
};
```

替换现有 `roles` 常量：

```ts
export const roles: Role[] = [
  {
    id: "hardware",
    name: "硬件开发",
    capabilities: ["view"],
    description: "只读参数库，用于研发阶段查阅和对比。"
  },
  {
    id: "project",
    name: "项目开发",
    capabilities: ["view", "edit"],
    description: "可编辑参数与项目取值，发起修改提交。"
  },
  {
    id: "parameter-admin",
    name: "参数管理员",
    capabilities: ["view", "edit", "publish"],
    description: "负责审阅和发布变更，管理参数库。"
  },
  {
    id: "admin",
    name: "平台管理员",
    capabilities: ["view", "edit", "publish", "manage-permissions"],
    description: "全部权限，可管理他人权限与全平台配置。"
  }
];
```

- [ ] **Step 5：扩展 `AuditEvent` 类型**

替换现有 `AuditEvent` 类型：

```ts
export type AuditEvent = {
  id: string;
  kind: AuditEventKind;
  app: PageKey;
  actor: string;
  action: string;
  time: string;
  severity: RiskLevel;
  parameterId?: string;
  batchId?: string;
  userId?: string;
  metadata?: {
    previousValue?: string;
    newValue?: string;
    previousRole?: string;
    newRole?: string;
    affectedIds?: string[];
    diffSummary?: { added: number; updated: number; deleted: number };
    snapshotName?: string;
    aiActionId?: string;
  };
  viaAgent?: boolean;
};
```

- [ ] **Step 6：扩展 `PrototypeState`**

找到 `PrototypeState` 类型，在末尾追加字段（紧接 `lastDebugSnapshot` 之后；若 debugging m1 已合并过会看到该字段，否则按现有末尾位置追加即可）：

```ts
  users: User[];
  currentUserId: string;
  lastExportedSnapshot: string;
  _undoStack: UndoEntry | null;
  insightDismissedIds: string[];
  aiFlaggedImportIds: string[];
```

- [ ] **Step 7：新增 `users` mock 常量（紧邻 `roles` 声明之后）**

```ts
export const users: User[] = [
  { id: "u-xu-yun",    name: "Xu Yun",    email: "xu@chargelab.cn",     roleId: "admin",            isActive: true,  createdAt: "2024-11-02T09:30:00.000Z" },
  { id: "u-zhao-heng", name: "Zhao Heng", email: "zhao@chargelab.cn",   roleId: "hardware",         isActive: true,  createdAt: "2025-01-14T03:12:00.000Z" },
  { id: "u-liu-min",   name: "Liu Min",   email: "liu@chargelab.cn",    roleId: "project",          isActive: true,  createdAt: "2025-02-03T08:04:00.000Z" },
  { id: "u-wang-jie",  name: "Wang Jie",  email: "wang@chargelab.cn",   roleId: "parameter-admin",  isActive: true,  createdAt: "2024-12-20T12:00:00.000Z" },
  { id: "u-chen-na",   name: "Chen Na",   email: "chen@chargelab.cn",   roleId: "project",          isActive: true,  createdAt: "2025-03-10T10:00:00.000Z" },
  { id: "u-li-peng",   name: "Li Peng",   email: "lipeng@chargelab.cn", roleId: "hardware",         isActive: true,  createdAt: "2025-03-22T11:00:00.000Z" },
  { id: "u-sun-mei",   name: "Sun Mei",   email: "sun@chargelab.cn",    roleId: "parameter-admin",  isActive: true,  createdAt: "2025-04-01T09:00:00.000Z" },
  { id: "u-tao-lin",   name: "Tao Lin",   email: "tao@chargelab.cn",    roleId: "hardware",         isActive: false, createdAt: "2025-04-15T14:00:00.000Z" }
];
```

- [ ] **Step 8：在 `createPrototypeState` 中初始化新字段**

在 `return {` 的对象字面量内追加（紧邻 `notifications` 或最后一个字段）：

```ts
    users,
    currentUserId: "u-xu-yun",
    lastExportedSnapshot: JSON.stringify(configDraft),
    _undoStack: null,
    insightDismissedIds: [],
    aiFlaggedImportIds: [],
```

- [ ] **Step 9：迁移现有 `auditEvents` mock 数据，补齐 kind 字段**

找到 mock `auditEvents` 数组（若不存在则新增）。替换为（按 spec §13.3 分布，20+ 条）：

```ts
export const auditEvents: AuditEvent[] = [
  { id: "ae-001", kind: "parameter-update", app: "parameter-admin", actor: "H. Zhao",   action: "修改 fast_charge_current_limit_ma 3800→3200", time: "2026-05-10T02:32:00.000Z", severity: "High",   parameterId: "fast-charge-current", metadata: { previousValue: "3800", newValue: "3200" } },
  { id: "ae-002", kind: "batch-import",     app: "parameter-admin", actor: "Xu Yun",    action: "导入批次 BI-0042（+3 ✎5 -0）",                 time: "2026-05-10T01:18:00.000Z", severity: "Medium", batchId: "BI-0042", metadata: { affectedIds: ["new-bms-thr","fast-charge-current","charge-voltage-limit"], diffSummary: { added: 3, updated: 5, deleted: 0 } } },
  { id: "ae-003", kind: "parameter-delete", app: "parameter-admin", actor: "Li Min",    action: "删除 legacy_param_x",                           time: "2026-05-09T10:04:00.000Z", severity: "High",   parameterId: "legacy-param-x" },
  { id: "ae-004", kind: "user-role-change", app: "parameter-admin", actor: "Xu Yun",    action: "Zhao Heng 角色改为参数管理员",                 time: "2026-05-09T06:22:00.000Z", severity: "Medium", userId: "u-zhao-heng", metadata: { previousRole: "hardware", newRole: "parameter-admin" } },
  { id: "ae-005", kind: "parameter-update", app: "parameter-admin", actor: "Wang Jie",  action: "修改 soc_estimation_smoothing 推荐值",         time: "2026-05-09T03:12:00.000Z", severity: "Medium", parameterId: "soc-estimation-smoothing", metadata: { previousValue: "0.3", newValue: "0.25" } },
  { id: "ae-006", kind: "parameter-add",    app: "parameter-admin", actor: "Wang Jie",  action: "新增 new_bms_balance_threshold_mv",            time: "2026-05-08T08:30:00.000Z", severity: "Low",    parameterId: "new-bms-balance-threshold-mv" },
  { id: "ae-007", kind: "export",           app: "parameter-admin", actor: "Xu Yun",    action: "导出 params-20260508-082400.json",            time: "2026-05-08T00:24:00.000Z", severity: "Low",    metadata: { snapshotName: "params-20260508-082400.json" } },
  { id: "ae-008", kind: "user-toggle",      app: "parameter-admin", actor: "Xu Yun",    action: "停用用户 Tao Lin",                              time: "2026-05-07T02:10:00.000Z", severity: "Medium", userId: "u-tao-lin", metadata: { previousValue: "active", newValue: "inactive" } },
  { id: "ae-009", kind: "parameter-update", app: "parameter-admin", actor: "Liu Min",   action: "修改 battery_temp_target_c 45→43",             time: "2026-05-06T09:45:00.000Z", severity: "High",   parameterId: "battery-temp-target-c", metadata: { previousValue: "45", newValue: "43" } },
  { id: "ae-010", kind: "batch-import",     app: "parameter-admin", actor: "Xu Yun",    action: "导入批次 BI-0039（+1 ✎2 -0）",                 time: "2026-05-05T03:00:00.000Z", severity: "Low",    batchId: "BI-0039", metadata: { diffSummary: { added: 1, updated: 2, deleted: 0 } } },
  { id: "ae-011", kind: "user-role-change", app: "parameter-admin", actor: "Xu Yun",    action: "Chen Na 角色改为项目开发",                     time: "2026-05-04T07:15:00.000Z", severity: "Low",    userId: "u-chen-na", metadata: { previousRole: "hardware", newRole: "project" } },
  { id: "ae-012", kind: "parameter-update", app: "parameter-admin", actor: "Sun Mei",   action: "修改 charge_voltage_limit_mv 4400→4500",       time: "2026-05-04T00:48:00.000Z", severity: "High",   parameterId: "charge-voltage-limit-mv", metadata: { previousValue: "4400", newValue: "4500" } },
  { id: "ae-013", kind: "user-add",         app: "parameter-admin", actor: "Xu Yun",    action: "添加用户 Li Peng",                              time: "2026-05-03T03:00:00.000Z", severity: "Low",    userId: "u-li-peng" },
  { id: "ae-014", kind: "agent-action",     app: "parameter-admin", actor: "Xu Yun",    action: "Agent 扫描孤儿参数",                           time: "2026-05-03T01:30:00.000Z", severity: "Low",    viaAgent: true, metadata: { aiActionId: "scan-orphans" } },
  { id: "ae-015", kind: "parameter-update", app: "parameter-admin", actor: "H. Zhao",   action: "修改 usb_pd_profile_limit_w 27→30",            time: "2026-05-02T08:00:00.000Z", severity: "Low",    parameterId: "usb-pd-profile-limit-w" },
  { id: "ae-016", kind: "parameter-delete", app: "parameter-admin", actor: "Wang Jie",  action: "删除 wireless_charge_fallback_ma",             time: "2026-05-01T09:00:00.000Z", severity: "Medium", parameterId: "wireless-charge-fallback-ma" },
  { id: "ae-017", kind: "export",           app: "parameter-admin", actor: "Wang Jie",  action: "导出 params-20260501-090500.json",            time: "2026-05-01T01:05:00.000Z", severity: "Low",    metadata: { snapshotName: "params-20260501-090500.json" } },
  { id: "ae-018", kind: "parameter-update", app: "parameter-admin", actor: "Liu Min",   action: "修改 standby_drain_limit_ma 8→6",              time: "2026-04-30T11:00:00.000Z", severity: "Low",    parameterId: "standby-drain-limit-ma" },
  { id: "ae-019", kind: "parameter-update", app: "parameter-admin", actor: "H. Zhao",   action: "修改 battery_health_reserve_pct 4→5",          time: "2026-04-29T08:30:00.000Z", severity: "Medium", parameterId: "battery-health-reserve-pct" },
  { id: "ae-020", kind: "parameter-add",    app: "parameter-admin", actor: "Wang Jie",  action: "新增 pmic_boost_voltage_mv",                   time: "2026-04-28T10:00:00.000Z", severity: "Medium", parameterId: "pmic-boost-voltage-mv" },
  { id: "ae-021", kind: "parameter-update", app: "parameter-admin", actor: "Sun Mei",   action: "修改 low_battery_shutdown_soc 3→5",            time: "2026-04-27T09:00:00.000Z", severity: "High",   parameterId: "low-battery-shutdown-soc" }
];
```

> 注：上述 parameterId 与现有 `parameterLibrary` 中的 id 对应；如果 mock 参数库里没有 `legacy-param-x` / `wireless-charge-fallback-ma` / `usb-pd-profile-limit-w` / `pmic-boost-voltage-mv` 等 id，需要在 configDraft 的 parameterLibrary 中确认；演示事件本身不必严格对齐（保留即可展示审计"已删参数"的叙事）。

- [ ] **Step 10：在 `createPrototypeState` 中把 `auditEvents` 绑定到状态**

在 `return {` 里把现有 `auditEvents: []` 或类似声明改为 `auditEvents,`，引用上一步新增的 mock 常量。

- [ ] **Step 11：运行测试，确认通过**

Run: `npm test -- mockData.parameterAdmin`
Expected: 全部 PASS（6 个用例）。

- [ ] **Step 12：运行全量测试，发现回归**

Run: `npm test`
Expected: 除本次新增测试全绿外，其它测试可能出现两类失败：
1. `mockDataFingerprint` 类指纹断言因为 JSON 结构变化失败 → 修正到形状断言 `expect(fp).toMatch(/^[0-9a-f]+$/)` 或直接更新预期值。
2. 任何对 `Role` / `AuditEvent` 形状强断言的旧测试 → 按新契约更新。

每修一处，记录到当前 Task 的"附带修复"里，确保 `npm test` 全绿后再提交。

- [ ] **Step 13：提交**

```bash
git add src/mockData.ts src/mockData.parameterAdmin.test.ts
git commit -m "feat(parameter-admin): extend data contract with users, audit kinds, undo entry"
```

---

## Task 1：新建 `parameterAdminAnalytics` 派生模块

**目的：** 集中所有参数管理后台会用到的派生函数，组件/reducer 后续都从这里读。本 Task 只落 M1 必需的 4 个：`getCoverage / selectDirtyCount / migrateParameterRange / buildAuditEvent`。`deriveParameterAdminInsights` 留到 Task 13 一并实现。

**Files:**
- Create: `src/parameterAdminAnalytics.ts`
- Create: `src/parameterAdminAnalytics.test.ts`

---

- [ ] **Step 1：新建纯函数测试**

Create `src/parameterAdminAnalytics.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  getCoverage,
  selectDirtyCount,
  migrateParameterRange,
  buildAuditEvent
} from "./parameterAdminAnalytics";
import { initialState } from "./mockData";
import type { AuditEvent } from "./mockData";

describe("getCoverage", () => {
  const projects = [
    { id: "aurora", name: "Aurora", code: "AUR" },
    { id: "nebula", name: "Nebula", code: "NEB" },
    { id: "atlas",  name: "Atlas",  code: "ATL" }
  ];

  it("完全覆盖三个项目 → full", () => {
    const param = {
      id: "p1",
      values: {
        aurora: { currentValue: "3200", updatedAt: "", recommendedValue: "" },
        nebula: { currentValue: "3400", updatedAt: "", recommendedValue: "" },
        atlas:  { currentValue: "3000", updatedAt: "", recommendedValue: "" }
      }
    } as any;
    expect(getCoverage(param, projects)).toBe("full");
  });

  it("一个项目取值为空 → partial", () => {
    const param = {
      id: "p1",
      values: {
        aurora: { currentValue: "3200", updatedAt: "", recommendedValue: "" },
        nebula: { currentValue: "",     updatedAt: "", recommendedValue: "" },
        atlas:  { currentValue: "3000", updatedAt: "", recommendedValue: "" }
      }
    } as any;
    expect(getCoverage(param, projects)).toBe("partial");
  });

  it("所有项目均为空 → orphan", () => {
    const param = {
      id: "p1",
      values: {
        aurora: { currentValue: "", updatedAt: "", recommendedValue: "" },
        nebula: { currentValue: "", updatedAt: "", recommendedValue: "" },
        atlas:  { currentValue: "", updatedAt: "", recommendedValue: "" }
      }
    } as any;
    expect(getCoverage(param, projects)).toBe("orphan");
  });

  it("缺失键（values 里没这个项目）也视为空 → partial", () => {
    const param = {
      id: "p1",
      values: {
        aurora: { currentValue: "3200", updatedAt: "", recommendedValue: "" }
      }
    } as any;
    expect(getCoverage(param, projects)).toBe("partial");
  });
});

describe("selectDirtyCount", () => {
  it("lastExportedSnapshot === JSON(configDraft) → 0", () => {
    expect(selectDirtyCount(initialState)).toBe(0);
  });

  it("lastExportedSnapshot !== JSON(configDraft) → 非 0", () => {
    const patched = {
      ...initialState,
      lastExportedSnapshot: JSON.stringify({ ...initialState.configDraft, extraField: 1 })
    } as any;
    expect(selectDirtyCount(patched)).toBeGreaterThan(0);
  });

  it("差异越多，计数越大（粗粒度 heuristics）", () => {
    const oneDiff = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        parameterLibrary: [
          { ...initialState.configDraft.parameterLibrary[0], description: "changed" },
          ...initialState.configDraft.parameterLibrary.slice(1)
        ]
      }
    } as any;
    const twoDiff = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        parameterLibrary: [
          { ...initialState.configDraft.parameterLibrary[0], description: "changed1" },
          { ...initialState.configDraft.parameterLibrary[1], description: "changed2" },
          ...initialState.configDraft.parameterLibrary.slice(2)
        ]
      }
    } as any;
    expect(selectDirtyCount(twoDiff)).toBeGreaterThanOrEqual(
      selectDirtyCount(oneDiff)
    );
  });
});

describe("migrateParameterRange", () => {
  it("'2500 - 4500' → { min: 2500, max: 4500, raw }", () => {
    const r = migrateParameterRange("2500 - 4500");
    expect(r.min).toBe(2500);
    expect(r.max).toBe(4500);
    expect(r.raw).toBe("2500 - 4500");
  });

  it("'-10 ~ 50' 负数+波浪号 → min/max", () => {
    const r = migrateParameterRange("-10 ~ 50");
    expect(r.min).toBe(-10);
    expect(r.max).toBe(50);
  });

  it("'字符 / 无法解析' → 只保留 raw", () => {
    const r = migrateParameterRange("High/Low");
    expect(r.min).toBeUndefined();
    expect(r.max).toBeUndefined();
    expect(r.raw).toBe("High/Low");
  });

  it("空字符串 → raw=''", () => {
    const r = migrateParameterRange("");
    expect(r.raw).toBe("");
    expect(r.min).toBeUndefined();
    expect(r.max).toBeUndefined();
  });
});

describe("buildAuditEvent", () => {
  it("生成的事件具备 id / time / kind / severity / app 必填字段", () => {
    const e = buildAuditEvent({
      kind: "parameter-update",
      actor: "Xu Yun",
      action: "test",
      severity: "Low",
      parameterId: "p1"
    });
    expect(e.id).toMatch(/^audit-/);
    expect(e.app).toBe("parameter-admin");
    expect(e.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(e.kind).toBe("parameter-update");
    expect(e.parameterId).toBe("p1");
  });

  it("透传 batchId / userId / metadata / viaAgent", () => {
    const e = buildAuditEvent({
      kind: "batch-import",
      actor: "Agent",
      action: "t",
      severity: "Medium",
      batchId: "BI-X",
      userId: "u-xu-yun",
      metadata: { diffSummary: { added: 1, updated: 0, deleted: 0 } },
      viaAgent: true
    });
    expect(e.batchId).toBe("BI-X");
    expect(e.userId).toBe("u-xu-yun");
    expect(e.viaAgent).toBe(true);
    expect(e.metadata?.diffSummary?.added).toBe(1);
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npm test -- parameterAdminAnalytics`
Expected: FAIL（整个模块不存在）。

- [ ] **Step 3：实现派生模块**

Create `src/parameterAdminAnalytics.ts`：

```ts
import type {
  AuditEvent,
  AuditEventKind,
  PrototypeState,
  RiskLevel
} from "./mockData";
import type { ParameterEditorDraft, ProjectConfig } from "./powerManagementConfig";

export type ParameterCoverage = "full" | "partial" | "orphan";

export function getCoverage(
  parameter: ParameterEditorDraft,
  projects: readonly ProjectConfig[]
): ParameterCoverage {
  const valued = projects.filter(p => {
    const entry = parameter.values?.[p.id];
    return entry && typeof entry.currentValue === "string" && entry.currentValue.length > 0;
  });
  if (valued.length === 0) return "orphan";
  if (valued.length < projects.length) return "partial";
  return "full";
}

/**
 * 粗粒度脏态计数：
 * - 若 JSON(configDraft) === lastExportedSnapshot → 0
 * - 否则：对 parameterLibrary 按 id 做 diff，分别统计 metadata 差异 + 项目取值差异
 *   的条目数（unique parameterId 计数）。
 */
export function selectDirtyCount(state: PrototypeState): number {
  const current = JSON.stringify(state.configDraft);
  if (current === state.lastExportedSnapshot) return 0;
  let lastDraft: { parameterLibrary: ParameterEditorDraft[] } | null = null;
  try {
    lastDraft = JSON.parse(state.lastExportedSnapshot);
  } catch {
    return state.configDraft.parameterLibrary.length; // 解析失败兜底
  }
  const dirtyIds = new Set<string>();
  const currentById = new Map(state.configDraft.parameterLibrary.map(p => [p.id, p]));
  const lastById = new Map(lastDraft.parameterLibrary.map(p => [p.id, p]));
  for (const id of new Set([...currentById.keys(), ...lastById.keys()])) {
    const a = currentById.get(id);
    const b = lastById.get(id);
    if (!a || !b) {
      dirtyIds.add(id);
      continue;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      dirtyIds.add(id);
    }
  }
  return dirtyIds.size;
}

export type ParameterRange = {
  min?: number;
  max?: number;
  raw: string;
};

export function migrateParameterRange(raw: string | undefined | null): ParameterRange {
  const safe = typeof raw === "string" ? raw : "";
  const parts = safe.split(/[-–—~]/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 2) {
    const min = Number(parts[0]);
    const max = Number(parts[1]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max, raw: safe };
    }
  }
  // 尝试带单位的去数字提取（例如 "2500mA - 4500mA"）
  if (parts.length === 2) {
    const reNum = /-?\d+(?:\.\d+)?/;
    const minMatch = parts[0].match(reNum);
    const maxMatch = parts[1].match(reNum);
    if (minMatch && maxMatch) {
      const min = Number(minMatch[0]);
      const max = Number(maxMatch[0]);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        return { min, max, raw: safe };
      }
    }
  }
  return { raw: safe };
}

let auditSeq = 0;
function makeAuditId(): string {
  auditSeq += 1;
  return `audit-${Date.now().toString(36)}-${auditSeq.toString(36)}`;
}

export type BuildAuditInput = {
  kind: AuditEventKind;
  actor: string;
  action: string;
  severity: RiskLevel;
  parameterId?: string;
  batchId?: string;
  userId?: string;
  metadata?: AuditEvent["metadata"];
  viaAgent?: boolean;
  time?: string;
};

export function buildAuditEvent(input: BuildAuditInput): AuditEvent {
  return {
    id: makeAuditId(),
    app: "parameter-admin",
    actor: input.actor,
    action: input.action,
    kind: input.kind,
    severity: input.severity,
    time: input.time ?? new Date().toISOString(),
    parameterId: input.parameterId,
    batchId: input.batchId,
    userId: input.userId,
    metadata: input.metadata,
    viaAgent: input.viaAgent
  };
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npm test -- parameterAdminAnalytics`
Expected: 所有用例 PASS。

- [ ] **Step 5：提交**

```bash
git add src/parameterAdminAnalytics.ts src/parameterAdminAnalytics.test.ts
git commit -m "feat(parameter-admin): add analytics module (coverage, dirtyCount, range migrate, audit builder)"
```

---

## Task 2：扩展 Reducer Actions（9 个新 action）

**目的：** 把 M1 范围里所有会改 state 的 action 一次性接入 `appReducer`。UI 侧暂不调用，但测试一定要先把行为契约守住，便于后续 Task 直接消费这些动作。

**Files:**
- Modify: `src/App.tsx` 里的 `AppAction` 类型和 `appReducer` 函数
- Create: `src/appReducer.parameterAdmin.test.ts`

---

- [ ] **Step 1：新建 reducer 测试**

Create `src/appReducer.parameterAdmin.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { appReducer } from "./App";
import { initialState } from "./mockData";

describe("parameter-admin reducer actions", () => {
  it("ASSIGN_USER_ROLE 更新用户角色并写审计", () => {
    const next = appReducer(initialState, {
      type: "ASSIGN_USER_ROLE",
      userId: "u-zhao-heng",
      roleId: "parameter-admin"
    });
    const zhao = next.users.find(u => u.id === "u-zhao-heng");
    expect(zhao?.roleId).toBe("parameter-admin");
    const event = next.auditEvents[0];
    expect(event.kind).toBe("user-role-change");
    expect(event.userId).toBe("u-zhao-heng");
    expect(event.metadata?.previousRole).toBe("hardware");
    expect(event.metadata?.newRole).toBe("parameter-admin");
  });

  it("ASSIGN_USER_ROLE 对 currentUser 无效（防自锁）", () => {
    const next = appReducer(initialState, {
      type: "ASSIGN_USER_ROLE",
      userId: initialState.currentUserId,
      roleId: "hardware"
    });
    const me = next.users.find(u => u.id === next.currentUserId);
    expect(me?.roleId).toBe("admin");
    expect(next).toBe(initialState);
  });

  it("TOGGLE_USER_ACTIVE 翻转 isActive 并写审计", () => {
    const next = appReducer(initialState, {
      type: "TOGGLE_USER_ACTIVE",
      userId: "u-liu-min",
      isActive: false
    });
    const liu = next.users.find(u => u.id === "u-liu-min");
    expect(liu?.isActive).toBe(false);
    expect(next.auditEvents[0].kind).toBe("user-toggle");
  });

  it("ADD_USER 追加用户并写审计", () => {
    const next = appReducer(initialState, {
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      roleId: "project"
    });
    expect(next.users.length).toBe(initialState.users.length + 1);
    const created = next.users[next.users.length - 1];
    expect(created.name).toBe("Demo Engineer");
    expect(next.auditEvents[0].kind).toBe("user-add");
    expect(next.auditEvents[0].userId).toBe(created.id);
  });

  it("ADD_USER 拒绝重复邮箱", () => {
    const next = appReducer(initialState, {
      type: "ADD_USER",
      name: "Fake",
      email: "xu@chargelab.cn",
      roleId: "hardware"
    });
    expect(next).toBe(initialState);
  });

  it("MARK_EXPORTED 更新 lastExportedSnapshot + 脏态归零 + 写审计", () => {
    const dirty = appReducer(initialState, {
      type: "UPDATE_PROJECT_PARAMETER_METADATA",
      projectId: "aurora",
      parameterId: initialState.configDraft.parameterLibrary[0].id,
      patch: { description: "dirty change" }
    });
    expect(dirty.lastExportedSnapshot).not.toBe(JSON.stringify(dirty.configDraft));
    const cleared = appReducer(dirty, {
      type: "MARK_EXPORTED",
      snapshotName: "params-demo.json",
      timestamp: "2026-05-10T22:00:00.000Z"
    });
    expect(cleared.lastExportedSnapshot).toBe(JSON.stringify(cleared.configDraft));
    expect(cleared.auditEvents[0].kind).toBe("export");
    expect(cleared.auditEvents[0].metadata?.snapshotName).toBe("params-demo.json");
  });

  it("DISMISS_INSIGHT 追加 id，重复 dismiss 幂等", () => {
    const once = appReducer(initialState, { type: "DISMISS_INSIGHT", insightId: "high-risk-orphans" });
    expect(once.insightDismissedIds).toEqual(["high-risk-orphans"]);
    const twice = appReducer(once, { type: "DISMISS_INSIGHT", insightId: "high-risk-orphans" });
    expect(twice.insightDismissedIds).toEqual(["high-risk-orphans"]);
  });

  it("SET_AI_FLAGGED_IMPORT_IDS 覆盖写入", () => {
    const next = appReducer(initialState, {
      type: "SET_AI_FLAGGED_IMPORT_IDS",
      ids: ["p1", "p2"]
    });
    expect(next.aiFlaggedImportIds).toEqual(["p1", "p2"]);
  });

  it("AGENT_ACTION_EXECUTED 写 agent-action 审计 + viaAgent", () => {
    const next = appReducer(initialState, {
      type: "AGENT_ACTION_EXECUTED",
      actionId: "scan-orphans",
      metadata: { foundOrphans: 2 }
    });
    expect(next.auditEvents[0].kind).toBe("agent-action");
    expect(next.auditEvents[0].viaAgent).toBe(true);
    expect(next.auditEvents[0].metadata?.aiActionId).toBe("scan-orphans");
  });

  it("DELETE_PROJECT_PARAMETER 产生 undo entry 且保留 10s 过期时间", () => {
    const paramId = initialState.configDraft.parameterLibrary[0].id;
    const next = appReducer(initialState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });
    expect(next.configDraft.parameterLibrary.find(p => p.id === paramId)).toBeUndefined();
    expect(next._undoStack).not.toBeNull();
    expect(next._undoStack?.actionKind).toBe("parameter-delete");
    const expiresIn = new Date(next._undoStack!.expiresAt).getTime() - new Date(next._undoStack!.createdAt).getTime();
    expect(expiresIn).toBeGreaterThanOrEqual(9_500);
    expect(expiresIn).toBeLessThanOrEqual(10_500);
    expect(next.auditEvents[0].kind).toBe("parameter-delete");
  });

  it("UNDO_LAST_DESTRUCTIVE 还原删除 + 写 rollback-undo 审计 + 清 undoStack", () => {
    const paramId = initialState.configDraft.parameterLibrary[0].id;
    const deleted = appReducer(initialState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });
    const restored = appReducer(deleted, { type: "UNDO_LAST_DESTRUCTIVE" });
    expect(restored.configDraft.parameterLibrary.find(p => p.id === paramId)).toBeTruthy();
    expect(restored._undoStack).toBeNull();
    expect(restored.auditEvents[0].kind).toBe("rollback-undo");
  });

  it("UNDO_LAST_DESTRUCTIVE 过期后 noop", () => {
    const paramId = initialState.configDraft.parameterLibrary[0].id;
    const deleted = appReducer(initialState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });
    // 手动把 expiresAt 往前挪到 1 分钟前
    const expired = {
      ...deleted,
      _undoStack: deleted._undoStack
        ? { ...deleted._undoStack, expiresAt: new Date(Date.now() - 60_000).toISOString() }
        : null
    };
    const tried = appReducer(expired, { type: "UNDO_LAST_DESTRUCTIVE" });
    expect(tried).toBe(expired);
  });

  it("CLEAR_UNDO 直接清空 _undoStack", () => {
    const paramId = initialState.configDraft.parameterLibrary[0].id;
    const deleted = appReducer(initialState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });
    const cleared = appReducer(deleted, { type: "CLEAR_UNDO" });
    expect(cleared._undoStack).toBeNull();
    expect(cleared.configDraft.parameterLibrary.find(p => p.id === paramId)).toBeUndefined();
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npm test -- appReducer.parameterAdmin`
Expected: FAIL（绝大部分 action 未识别 → reducer 返回 state 原样，断言全失败）。

- [ ] **Step 3：在 `App.tsx` 中扩展 `AppAction` 联合类型**

定位 `type AppAction =` 声明，在末尾追加（保持原有分支不动）：

```ts
  | { type: "ASSIGN_USER_ROLE"; userId: string; roleId: string }
  | { type: "TOGGLE_USER_ACTIVE"; userId: string; isActive: boolean }
  | { type: "ADD_USER"; name: string; email: string; roleId: string }
  | { type: "MARK_EXPORTED"; snapshotName: string; timestamp: string }
  | { type: "DISMISS_INSIGHT"; insightId: string }
  | { type: "SET_AI_FLAGGED_IMPORT_IDS"; ids: string[] }
  | { type: "AGENT_ACTION_EXECUTED"; actionId: string; metadata?: Record<string, unknown> }
  | { type: "UNDO_LAST_DESTRUCTIVE" }
  | { type: "CLEAR_UNDO" }
```

- [ ] **Step 4：在 `appReducer` 中实现 9 个分支**

在 `appReducer` 的 switch 块内新增分支（放在 `default:` 之前）。使用 `buildAuditEvent` from `./parameterAdminAnalytics`。示例：

```ts
    case "ASSIGN_USER_ROLE": {
      if (action.userId === state.currentUserId) return state;
      const user = state.users.find(u => u.id === action.userId);
      if (!user || user.roleId === action.roleId) return state;
      const actor = state.users.find(u => u.id === state.currentUserId)?.name ?? "system";
      const event = buildAuditEvent({
        kind: "user-role-change",
        actor,
        action: `${user.name} 角色从 ${user.roleId} 改为 ${action.roleId}`,
        severity: "Medium",
        userId: user.id,
        metadata: { previousRole: user.roleId, newRole: action.roleId }
      });
      return {
        ...state,
        users: state.users.map(u =>
          u.id === user.id ? { ...u, roleId: action.roleId } : u
        ),
        auditEvents: [event, ...state.auditEvents]
      };
    }

    case "TOGGLE_USER_ACTIVE": {
      const user = state.users.find(u => u.id === action.userId);
      if (!user || user.isActive === action.isActive) return state;
      if (user.id === state.currentUserId) return state;
      const actor = state.users.find(u => u.id === state.currentUserId)?.name ?? "system";
      const event = buildAuditEvent({
        kind: "user-toggle",
        actor,
        action: `${action.isActive ? "启用" : "停用"} 用户 ${user.name}`,
        severity: "Medium",
        userId: user.id,
        metadata: {
          previousValue: user.isActive ? "active" : "inactive",
          newValue: action.isActive ? "active" : "inactive"
        }
      });
      return {
        ...state,
        users: state.users.map(u =>
          u.id === user.id ? { ...u, isActive: action.isActive } : u
        ),
        auditEvents: [event, ...state.auditEvents]
      };
    }

    case "ADD_USER": {
      const exists = state.users.some(u => u.email.toLowerCase() === action.email.toLowerCase());
      if (exists) return state;
      const role = roles.find(r => r.id === action.roleId);
      if (!role) return state;
      const newUser: User = {
        id: `u-${Date.now().toString(36)}`,
        name: action.name,
        email: action.email,
        roleId: action.roleId,
        isActive: true,
        createdAt: new Date().toISOString()
      };
      const actor = state.users.find(u => u.id === state.currentUserId)?.name ?? "system";
      const event = buildAuditEvent({
        kind: "user-add",
        actor,
        action: `添加用户 ${newUser.name}（${role.name}）`,
        severity: "Low",
        userId: newUser.id
      });
      return {
        ...state,
        users: [...state.users, newUser],
        auditEvents: [event, ...state.auditEvents]
      };
    }

    case "MARK_EXPORTED": {
      const actor = state.users.find(u => u.id === state.currentUserId)?.name ?? "system";
      const event = buildAuditEvent({
        kind: "export",
        actor,
        action: `导出 ${action.snapshotName}`,
        severity: "Low",
        time: action.timestamp,
        metadata: { snapshotName: action.snapshotName }
      });
      return {
        ...state,
        lastExportedSnapshot: JSON.stringify(state.configDraft),
        auditEvents: [event, ...state.auditEvents]
      };
    }

    case "DISMISS_INSIGHT": {
      if (state.insightDismissedIds.includes(action.insightId)) return state;
      return {
        ...state,
        insightDismissedIds: [...state.insightDismissedIds, action.insightId]
      };
    }

    case "SET_AI_FLAGGED_IMPORT_IDS": {
      return { ...state, aiFlaggedImportIds: [...action.ids] };
    }

    case "AGENT_ACTION_EXECUTED": {
      const actor = state.users.find(u => u.id === state.currentUserId)?.name ?? "system";
      const event = buildAuditEvent({
        kind: "agent-action",
        actor,
        action: `Agent 执行 ${action.actionId}`,
        severity: "Low",
        viaAgent: true,
        metadata: { aiActionId: action.actionId, ...(action.metadata ?? {}) }
      });
      return {
        ...state,
        auditEvents: [event, ...state.auditEvents]
      };
    }

    case "UNDO_LAST_DESTRUCTIVE": {
      const entry = state._undoStack;
      if (!entry) return state;
      if (Date.now() > new Date(entry.expiresAt).getTime()) return state;
      const actor = state.users.find(u => u.id === state.currentUserId)?.name ?? "system";
      const event = buildAuditEvent({
        kind: "rollback-undo",
        actor,
        action: `撤销 ${entry.actionKind}：${entry.message}`,
        severity: "Low",
        metadata: { aiActionId: entry.originalAuditEventId }
      });
      return {
        ...state,
        ...entry.snapshot,
        _undoStack: null,
        auditEvents: [event, ...state.auditEvents]
      } as AppState;
    }

    case "CLEAR_UNDO": {
      return { ...state, _undoStack: null };
    }
```

- [ ] **Step 5：改造 `DELETE_PROJECT_PARAMETER` 以产生 undo entry**

找到现有 `DELETE_PROJECT_PARAMETER` 分支（只做 `configDraft.parameterLibrary.filter`），替换为：

```ts
    case "DELETE_PROJECT_PARAMETER": {
      const removed = state.configDraft.parameterLibrary.find(p => p.id === action.parameterId);
      if (!removed) return state;
      const actor = state.users.find(u => u.id === state.currentUserId)?.name ?? "system";
      const event = buildAuditEvent({
        kind: "parameter-delete",
        actor,
        action: `删除 ${removed.name}`,
        severity: "High",
        parameterId: removed.id
      });
      const now = new Date();
      const undo: UndoEntry = {
        id: `undo-${now.getTime()}`,
        actionKind: "parameter-delete",
        message: `已删除 ${removed.name}`,
        snapshot: {
          configDraft: state.configDraft
        },
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10_000).toISOString(),
        originalAuditEventId: event.id
      };
      return {
        ...state,
        configDraft: {
          ...state.configDraft,
          parameterLibrary: state.configDraft.parameterLibrary.filter(p => p.id !== action.parameterId)
        },
        _undoStack: undo,
        auditEvents: [event, ...state.auditEvents]
      };
    }
```

- [ ] **Step 6：运行测试，确认通过**

Run: `npm test -- appReducer.parameterAdmin`
Expected: 全部 PASS。

- [ ] **Step 7：运行全量测试，发现并修复回归**

Run: `npm test`
Expected: 发现对 `DELETE_PROJECT_PARAMETER` 的旧测试（如 `App.test.tsx` 里假设直接删除且无 undo）失败。按新契约更新断言：现在删除后 `_undoStack` 非 null、且审计里会多一条 event。

- [ ] **Step 8：提交**

```bash
git add src/App.tsx src/appReducer.parameterAdmin.test.ts
git commit -m "feat(parameter-admin): add 9 reducer actions + undo stack for destructive ops"
```

---

## Task 3：`useParamAdminSearch` 与 `useBeforeUnload` 两个通用 hook

**目的：** 把 D9 URL 同步和 D8 beforeunload 守护各抽成独立 hook，便于 `ParameterAdminPage` 纯净地消费。

**Files:**
- Create: `src/hooks/useParamAdminSearch.ts`
- Create: `src/hooks/useParamAdminSearch.test.ts`
- Create: `src/hooks/useBeforeUnload.ts`
- Create: `src/hooks/useBeforeUnload.test.ts`

---

- [ ] **Step 1：新建 useParamAdminSearch 测试**

Create `src/hooks/useParamAdminSearch.test.ts`：

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useParamAdminSearch } from "./useParamAdminSearch";

describe("useParamAdminSearch", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/parameter-admin");
  });

  it("初始读取默认值", () => {
    const { result } = renderHook(() => useParamAdminSearch());
    expect(result.current.search.q).toBe("");
    expect(result.current.search.risk).toBe("all");
    expect(result.current.search.coverage).toBe("all");
    expect(result.current.search.modules).toEqual([]);
    expect(result.current.search.sort).toBe("updatedAt-desc");
    expect(result.current.search.id).toBeUndefined();
  });

  it("从 URL 初始化", () => {
    window.history.replaceState(null, "", "/parameter-admin?q=charge&risk=high&module=charging-policy,battery-safety&coverage=orphan&sort=name-asc&id=p1");
    const { result } = renderHook(() => useParamAdminSearch());
    expect(result.current.search.q).toBe("charge");
    expect(result.current.search.risk).toBe("high");
    expect(result.current.search.modules).toEqual(["charging-policy", "battery-safety"]);
    expect(result.current.search.coverage).toBe("orphan");
    expect(result.current.search.sort).toBe("name-asc");
    expect(result.current.search.id).toBe("p1");
  });

  it("updateSearch 写入 URL 并触发 rerender", () => {
    const { result } = renderHook(() => useParamAdminSearch());
    act(() => result.current.updateSearch({ risk: "high" }));
    expect(new URL(window.location.href).searchParams.get("risk")).toBe("high");
    expect(result.current.search.risk).toBe("high");
  });

  it("updateSearch 清空字段时移除 URL key", () => {
    window.history.replaceState(null, "", "/parameter-admin?risk=high");
    const { result } = renderHook(() => useParamAdminSearch());
    act(() => result.current.updateSearch({ risk: "all" }));
    expect(new URL(window.location.href).searchParams.has("risk")).toBe(false);
  });

  it("modules 数组以逗号分隔写入", () => {
    const { result } = renderHook(() => useParamAdminSearch());
    act(() => result.current.updateSearch({ modules: ["a", "b"] }));
    expect(new URL(window.location.href).searchParams.get("module")).toBe("a,b");
  });
});
```

- [ ] **Step 2：运行测试（确认失败）**

Run: `npm test -- useParamAdminSearch`
Expected: FAIL（hook 不存在）。

- [ ] **Step 3：实现 `useParamAdminSearch`**

Create `src/hooks/useParamAdminSearch.ts`：

```ts
import { useCallback, useEffect, useState } from "react";

export type ParamAdminSearch = {
  q: string;
  risk: "all" | "high" | "medium" | "low";
  modules: string[];
  coverage: "all" | "full" | "partial" | "orphan";
  sort: string;
  id?: string;
  audit?: "open";
  import?: "step1" | "step2" | "step3";
  permissions?: "open";
};

function parseFromLocation(): ParamAdminSearch {
  const params = new URL(window.location.href).searchParams;
  const modules = params.get("module");
  const id = params.get("id") ?? undefined;
  const risk = (params.get("risk") ?? "all") as ParamAdminSearch["risk"];
  const coverage = (params.get("coverage") ?? "all") as ParamAdminSearch["coverage"];
  return {
    q: params.get("q") ?? "",
    risk,
    modules: modules ? modules.split(",").filter(Boolean) : [],
    coverage,
    sort: params.get("sort") ?? "updatedAt-desc",
    id,
    audit: params.get("audit") === "open" ? "open" : undefined,
    import: (params.get("import") as ParamAdminSearch["import"]) ?? undefined,
    permissions: params.get("permissions") === "open" ? "open" : undefined
  };
}

function applyToLocation(search: ParamAdminSearch): void {
  const url = new URL(window.location.href);
  const p = url.searchParams;
  const setOrDel = (k: string, v: string | undefined | null) => {
    if (v === undefined || v === null || v === "" || v === "all") p.delete(k);
    else p.set(k, v);
  };
  setOrDel("q", search.q);
  setOrDel("risk", search.risk);
  p.delete("module");
  if (search.modules.length) p.set("module", search.modules.join(","));
  setOrDel("coverage", search.coverage);
  if (search.sort === "updatedAt-desc") p.delete("sort"); else p.set("sort", search.sort);
  if (search.id) p.set("id", search.id); else p.delete("id");
  if (search.audit === "open") p.set("audit", "open"); else p.delete("audit");
  if (search.import) p.set("import", search.import); else p.delete("import");
  if (search.permissions === "open") p.set("permissions", "open"); else p.delete("permissions");
  const next = `${url.pathname}${p.toString() ? `?${p.toString()}` : ""}${url.hash}`;
  window.history.pushState(null, "", next);
}

export function useParamAdminSearch() {
  const [search, setSearch] = useState<ParamAdminSearch>(() => parseFromLocation());

  useEffect(() => {
    const onPop = () => setSearch(parseFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const updateSearch = useCallback(
    (patch: Partial<ParamAdminSearch>) => {
      setSearch(prev => {
        const next = { ...prev, ...patch };
        applyToLocation(next);
        return next;
      });
    },
    []
  );

  const clearFilters = useCallback(() => {
    updateSearch({ q: "", risk: "all", modules: [], coverage: "all", sort: "updatedAt-desc" });
  }, [updateSearch]);

  return { search, updateSearch, clearFilters };
}
```

- [ ] **Step 4：新建 useBeforeUnload 测试**

Create `src/hooks/useBeforeUnload.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBeforeUnload } from "./useBeforeUnload";

describe("useBeforeUnload", () => {
  it("when 为 true 时阻止默认并设置 returnValue", () => {
    const { unmount } = renderHook(() => useBeforeUnload(true, "有未导出变更"));
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { writable: true, value: "" });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it("when 为 false 时不阻止", () => {
    renderHook(() => useBeforeUnload(false, "x"));
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { writable: true, value: "" });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("卸载后移除监听", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useBeforeUnload(true, "x"));
    unmount();
    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    add.mockRestore();
    remove.mockRestore();
  });
});
```

- [ ] **Step 5：运行测试（确认失败）**

Run: `npm test -- useBeforeUnload`
Expected: FAIL（文件不存在）。

- [ ] **Step 6：实现 `useBeforeUnload`**

Create `src/hooks/useBeforeUnload.ts`：

```ts
import { useEffect } from "react";

export function useBeforeUnload(when: boolean, message: string): void {
  useEffect(() => {
    if (!when) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [when, message]);
}
```

- [ ] **Step 7：运行两个 hook 的测试，确认通过**

Run: `npm test -- useParamAdminSearch useBeforeUnload`
Expected: 全部 PASS。

- [ ] **Step 8：提交**

```bash
git add src/hooks/useParamAdminSearch.ts src/hooks/useParamAdminSearch.test.ts src/hooks/useBeforeUnload.ts src/hooks/useBeforeUnload.test.ts
git commit -m "feat(parameter-admin): add URL search hook and beforeunload guard hook"
```

---

## Task 4：抽出 `ParameterAdminPage` 到独立文件（空壳）

**目的：** 把现有 `ParameterAdminPage` 从 `App.tsx` 中拆到 `src/ParameterAdminPage.tsx`，保持完全等价的渲染行为。这一步是纯重构，不引入任何新 UI 和新交互，为后续 Task 提供干净的工作面。

**Files:**
- Create: `src/ParameterAdminPage.tsx`
- Create: `src/ParameterAdminPage.test.tsx`
- Modify: `src/App.tsx`

---

- [ ] **Step 1：新建页面渲染骨架测试**

Create `src/ParameterAdminPage.test.tsx`：

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParameterAdminPage } from "./ParameterAdminPage";
import { initialState } from "./mockData";

function renderPage() {
  const dispatch = vi.fn();
  return render(
    <ParameterAdminPage
      state={initialState}
      dispatch={dispatch}
      onNavigate={vi.fn()}
      search={new URLSearchParams()}
    />
  );
}

describe("ParameterAdminPage （抽出后的骨架等价性）", () => {
  it("页面渲染标题", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: /项目参数管理后台/ })).toBeInTheDocument();
  });

  it("至少渲染一个参数 list item", () => {
    renderPage();
    expect(screen.getAllByRole("button", { name: /fast_charge|charge_voltage|battery/ }).length).toBeGreaterThan(0);
  });
});
```

> 测试导入 `vi` 从 `vitest` —— 如果测试文件暂未导入，需在开头补 `import { vi } from "vitest";`。

- [ ] **Step 2：运行测试（确认失败：模块不存在）**

Run: `npm test -- ParameterAdminPage`
Expected: FAIL（import error）。

- [ ] **Step 3：从 `App.tsx` 复制现有 `ParameterAdminPage` 到新文件**

Create `src/ParameterAdminPage.tsx`，把 `App.tsx` L2028–L2200 附近的 `function ParameterAdminPage(...)` 整体复制过来。同时补齐所有 import：

```tsx
import { useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { serializePowerManagementConfig } from "./powerManagementConfig";
import type { PageProps, ParameterEditorDraft, ParameterValueDraft } from "./App";
import {
  AdminPageScaffold,
  PanelHeader,
  RiskBadge,
  EmptyState,
  ConfigExportPanel
} from "./App";

export function ParameterAdminPage({ state, dispatch }: PageProps) {
  // ... 现有实现照抄
}
```

> 由于 `AdminPageScaffold`、`PanelHeader`、`RiskBadge`、`EmptyState`、`ConfigExportPanel` 这些内部组件在 `App.tsx` 里并未 export，需要从 `App.tsx` 将这些组件 `export` 出去。把它们的 `function X(...)` 前面加上 `export`。
> 如果不方便逐个 export，可以暂时把 `ConfigExportPanel` 等 helper 一并内联拷贝到 `ParameterAdminPage.tsx`；或者新建 `src/components/AdminPageScaffold.tsx` 汇集它们。本 Task 采取第二条：一并拷贝这些 helper 到 `ParameterAdminPage.tsx`，尾随一个 `// TODO(m2-refactor): 把 helper 归入 src/components` 注释。

- [ ] **Step 4：在 `App.tsx` 中删除内联 `ParameterAdminPage` 定义，改为 import**

- 删掉 `App.tsx` 中 `function ParameterAdminPage(...)` 的整个实现块。
- 在 `App.tsx` 顶部 import 区新增 `import { ParameterAdminPage } from "./ParameterAdminPage";`。
- `renderPage` 函数里 `case "parameter-admin":` 分支继续用 `<ParameterAdminPage ... />`，无需改动。

- [ ] **Step 5：导出 `PageProps` / `ParameterEditorDraft` / `ParameterValueDraft` 类型**

如果这些类型目前未 `export`，在 `App.tsx` 相应 `type` 声明前加 `export`：

```ts
export type PageProps = { ... };
```

- [ ] **Step 6：运行测试，确认通过**

Run: `npm test -- ParameterAdminPage App`
Expected: 新测试 PASS；`App.test.tsx` 里原本针对参数管理后台的测试继续 PASS（因为渲染结果等价）。

- [ ] **Step 7：运行全量测试与构建**

Run: `npm test`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 无 TS 错误。

- [ ] **Step 8：提交**

```bash
git add src/App.tsx src/ParameterAdminPage.tsx src/ParameterAdminPage.test.tsx
git commit -m "refactor(parameter-admin): extract ParameterAdminPage into its own module"
```

---


## Task 5：PageHeader 精简（消除标题重复 + 动作区占位）

**目的：** 把 Topbar 和内容区重复的标题/副标题合并到 PageHeader 一处；在动作区铺好 5 个按钮位（脏态徽章 / 批量导入 / 导出 ▾ / 权限 / 审计），其中 `批量导入` / `权限` / `审计` 本 m1 作为占位（点击仅 console.info）。脏态徽章与导出 ▾ 的真实行为在后续 Task 落地。

**Files:**
- Modify: `src/ParameterAdminPage.tsx`
- Modify: `src/App.tsx`（条件抑制 Topbar 重复标题）
- Modify: `src/styles.css`（新增 `.param-admin-header` 一组样式）

---

- [ ] **Step 1：先写 PageHeader 的集成测试**

在 `src/ParameterAdminPage.test.tsx` 追加用例：

```tsx
it("只有一个 H1，不在 Topbar 重复", () => {
  renderPage();
  const headings = screen.getAllByRole("heading", { name: /项目参数管理后台/ });
  expect(headings.length).toBe(1);
});

it("头部渲染 5 个动作按钮占位", () => {
  renderPage();
  expect(screen.getByRole("button", { name: /批量导入/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /导出/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /权限/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /审计/ })).toBeInTheDocument();
});
```

- [ ] **Step 2：运行测试（确认失败）**

Run: `npm test -- ParameterAdminPage`
Expected: FAIL（当前重复 H1 + 缺少按钮占位）。

- [ ] **Step 3：实现 PageHeader**

在 `ParameterAdminPage.tsx` 用下面的 JSX 替换 `AdminPageScaffold` 的调用（若仍沿用 scaffold 则在其内用 `title="__NONE__"` 抑制；实际建议**不再用 AdminPageScaffold**，因为它会额外渲染一层 title）：

```tsx
import { History, ShieldCheck, Upload } from "lucide-react";

// 放在组件返回的最外层
return (
  <div className="param-admin-shell" data-audit={search.audit === "open" ? "open" : "closed"}>
    <header className="param-admin-header">
      <div className="param-admin-header-text">
        <nav className="breadcrumb" aria-label="面包屑">
          <span>参数管理</span>
          <span aria-hidden>›</span>
          <span aria-current="page">项目参数管理后台</span>
        </nav>
        <h1>项目参数管理后台</h1>
        <p className="subtitle">电池与充电参数数据库 · 批量导入 · 权限和审计管理</p>
      </div>
      <div className="param-admin-header-actions" role="toolbar" aria-label="管理后台动作">
        {/* Task 14 会替换为 <DirtyIndicator /> */}
        <button type="button" className="button primary" onClick={() => console.info("m2: open import wizard")}>
          <Upload size={16} />
          批量导入
        </button>
        <button type="button" className="button subtle" onClick={() => console.info("m2: export menu")}>
          导出 JSON
        </button>
        <button type="button" className="button subtle" onClick={() => console.info("m2: open permissions")}>
          <ShieldCheck size={16} />
          权限
        </button>
        <button
          type="button"
          className="button ghost"
          aria-pressed={search.audit === "open"}
          onClick={() => updateSearch({ audit: search.audit === "open" ? undefined : "open" })}
        >
          <History size={16} />
          审计
        </button>
      </div>
    </header>

    {/* 其余主体下面几个 Task 会填充：KPI Strip → Insight Bar → 列表 + 详情 */}
    <main className="param-admin-body">
      {/* 临时保留现有 AdminPageScaffold children 的参数库 + 详情区 JSX */}
    </main>
  </div>
);
```

- [ ] **Step 4：在 `App.tsx` 里抑制 Topbar 重复标题**

`App.tsx` 的 Topbar 渲染路径（搜索 `topbar-title` 或 `.topbar h1` 对应片段）增加条件：

```tsx
// 假设现有: <div className="topbar-title"><span>{page.title}</span><small>{page.subtitle}</small></div>
// 改为：
const suppressTopbarTitle = page.key === "parameter-admin"; // m2 之后如有其它页同样处理可共用
if (!suppressTopbarTitle) {
  <div className="topbar-title">...</div>
}
```

若 Topbar 的标题渲染位置不是上述结构，改为等价条件即可。

- [ ] **Step 5：新增 CSS**

在 `src/styles.css` 末尾追加：

```css
.param-admin-shell {
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  gap: 18px;
  padding: 24px 28px 32px;
}

.param-admin-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.param-admin-header-text { flex: 1 1 480px; min-width: 0; }
.param-admin-header-text .breadcrumb {
  display: flex;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: 6px;
}
.param-admin-header-text h1 {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 4px;
}
.param-admin-header-text .subtitle {
  color: var(--text-muted);
  font-size: 13px;
  margin: 0;
}

.param-admin-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.param-admin-body {
  display: contents; /* 由后续 Task 替换为 grid */
}
```

- [ ] **Step 6：运行测试，确认通过**

Run: `npm test -- ParameterAdminPage`
Expected: 新增两个用例 PASS；原有骨架等价性用例仍 PASS。

- [ ] **Step 7：目视（可选）**

Run: `npm run dev` → 打开 `/parameter-admin` → 确认 Topbar 不再有标题，内容区 H1 只有一处，头部右上 4 个按钮可见且可点击（console 显示信息）。

- [ ] **Step 8：提交**

```bash
git add src/ParameterAdminPage.tsx src/ParameterAdminPage.test.tsx src/App.tsx src/styles.css
git commit -m "feat(parameter-admin): slim page header and wire audit toggle to url"
```

---

## Task 6：KPI Strip 组件（紧凑单行 + 可点击跳转筛选）

**目的：** 把现有 4 张大 KPI 卡（含装饰进度条）压缩成一行 ~64px 的 `<KpiStrip>`，且每一项可 click 跳转到对应的列表筛选视角。

**Files:**
- Create: `src/components/KpiStrip.tsx`
- Create: `src/components/KpiStrip.test.tsx`
- Modify: `src/ParameterAdminPage.tsx`
- Modify: `src/styles.css`

---

- [ ] **Step 1：写组件测试**

Create `src/components/KpiStrip.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KpiStrip, type KpiItem } from "./KpiStrip";

function sampleItems(): KpiItem[] {
  return [
    { id: "shared",      label: "共享参数", value: 10 },
    { id: "high-risk",   label: "高风险",   value: 4, interactive: true, onClick: vi.fn(), tone: "warning" },
    { id: "today",       label: "今日变更", value: 3, interactive: true, onClick: vi.fn() },
    { id: "orphan",      label: "孤儿参数", value: 2, interactive: true, onClick: vi.fn(), tone: "warning" },
    { id: "last-import", label: "最近导入", value: "2h 前", interactive: true, onClick: vi.fn() }
  ];
}

describe("KpiStrip", () => {
  it("渲染五项 + 数值和标签", () => {
    render(<KpiStrip items={sampleItems()} />);
    expect(screen.getByText("共享参数")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("高风险")).toBeInTheDocument();
    expect(screen.getByText("孤儿参数")).toBeInTheDocument();
    expect(screen.getByText("2h 前")).toBeInTheDocument();
  });

  it("interactive 项渲染为 button 并可 click 触发 onClick", () => {
    const items = sampleItems();
    render(<KpiStrip items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /高风险 4/ }));
    expect((items[1].onClick as any)).toHaveBeenCalledTimes(1);
  });

  it("非 interactive 项渲染为非按钮（span）", () => {
    render(<KpiStrip items={sampleItems()} />);
    const shared = screen.getByText("共享参数").closest(".kpi-item");
    expect(shared?.tagName).toBe("DIV");
  });

  it("tone=warning 打上 data-tone 属性", () => {
    render(<KpiStrip items={sampleItems()} />);
    const orphan = screen.getByRole("button", { name: /孤儿参数/ });
    expect(orphan.getAttribute("data-tone")).toBe("warning");
  });
});
```

- [ ] **Step 2：运行（确认失败）**

Run: `npm test -- KpiStrip`
Expected: FAIL（组件不存在）。

- [ ] **Step 3：实现组件**

Create `src/components/KpiStrip.tsx`：

```tsx
import { type ReactNode } from "react";

export type KpiItem = {
  id: string;
  label: string;
  value: string | number | ReactNode;
  hint?: string;
  interactive?: boolean;
  onClick?: () => void;
  tone?: "neutral" | "warning" | "danger";
};

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <section className="kpi-strip" aria-label="参数管理后台指标">
      {items.map(item => {
        const content = (
          <>
            <span className="kpi-label">{item.label}</span>
            <span className="kpi-value">{item.value}</span>
            {item.interactive ? <span className="kpi-arrow" aria-hidden>↗</span> : null}
          </>
        );
        if (item.interactive) {
          return (
            <button
              type="button"
              key={item.id}
              className="kpi-item interactive"
              data-tone={item.tone ?? "neutral"}
              onClick={item.onClick}
              title={item.hint}
              aria-label={`${item.label} ${typeof item.value === "string" || typeof item.value === "number" ? item.value : ""}`.trim()}
            >
              {content}
            </button>
          );
        }
        return (
          <div className="kpi-item" key={item.id} data-tone={item.tone ?? "neutral"} title={item.hint}>
            {content}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 4：运行（确认通过）**

Run: `npm test -- KpiStrip`
Expected: 全部 PASS。

- [ ] **Step 5：接入 ParameterAdminPage**

在 `ParameterAdminPage.tsx` 里 PageHeader 下方插入 KpiStrip。先派生五个项：

```tsx
import { KpiStrip, type KpiItem } from "./components/KpiStrip";
import { getCoverage } from "./parameterAdminAnalytics";

// 在组件内部
const projects = state.configDraft.projects;
const library = state.configDraft.parameterLibrary;
const highRiskCount = library.filter(p => p.risk === "High").length;
const orphanCount = library.filter(p => getCoverage(p, projects) === "orphan").length;
const todayChanges = state.auditEvents.filter(e => isWithinHours(e.time, 24)).length;
const lastImport = state.auditEvents.find(e => e.kind === "batch-import");

const kpiItems: KpiItem[] = [
  { id: "shared", label: "共享参数", value: library.length },
  { id: "high",   label: "高风险",   value: highRiskCount, interactive: highRiskCount > 0, tone: "warning",
    onClick: () => updateSearch({ risk: "high" }) },
  { id: "today",  label: "今日变更", value: todayChanges,  interactive: todayChanges > 0,
    onClick: () => updateSearch({ audit: "open" }) },
  { id: "orphan", label: "孤儿参数", value: orphanCount,   interactive: orphanCount > 0, tone: "warning",
    onClick: () => updateSearch({ coverage: "orphan" }) },
  { id: "last-import",
    label: "最近导入",
    value: lastImport ? formatRelativeTime(lastImport.time) : "—",
    interactive: Boolean(lastImport),
    onClick: () => updateSearch({ audit: "open" }) }
];
```

`isWithinHours` / `formatRelativeTime` 作为本文件顶部 helper（或 `parameterAdminAnalytics.ts` 里补加）：

```ts
function isWithinHours(iso: string, hours: number): boolean {
  return Date.now() - new Date(iso).getTime() <= hours * 3600 * 1000;
}
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.round(hrs / 24);
  return `${days} 天前`;
}
```

然后 render：

```tsx
<KpiStrip items={kpiItems} />
```

同时**删除原有**的 AdminPageScaffold 的 `metrics={[...]}` 数组调用（大 KPI 卡）。

- [ ] **Step 6：新增 CSS**

在 `src/styles.css` 追加：

```css
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card-bg);
  overflow: hidden;
}

.kpi-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 12px 16px;
  min-height: 64px;
  border-right: 1px solid var(--border);
  color: inherit;
  text-align: left;
  background: transparent;
}
.kpi-strip .kpi-item:last-child { border-right: 0; }

.kpi-item.interactive {
  cursor: pointer;
  transition: background 120ms;
}
.kpi-item.interactive:hover { background: rgba(16, 28, 45, 0.04); }
.kpi-item.interactive:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: -2px;
}

.kpi-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.kpi-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}
.kpi-arrow {
  position: absolute;
  right: 14px;
  top: 14px;
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.6;
}

.kpi-item { position: relative; }

.kpi-item[data-tone="warning"] .kpi-value { color: #d97706; }
.kpi-item[data-tone="danger"]  .kpi-value { color: var(--status-risk-high, #ba1a1a); }

@media (max-width: 1024px) {
  .kpi-strip { grid-template-columns: repeat(3, 1fr); }
  .kpi-item:nth-child(4), .kpi-item:nth-child(5) { border-top: 1px solid var(--border); }
  .kpi-item:nth-child(3) { border-right: 0; }
}
@media (max-width: 640px) {
  .kpi-strip { grid-auto-flow: column; grid-auto-columns: minmax(140px, 1fr); grid-template-columns: none; overflow-x: auto; }
}
```

- [ ] **Step 7：更新页面测试与 App 测试**

在 `ParameterAdminPage.test.tsx` 追加：

```tsx
it("渲染五项 KPI，孤儿数量正确", () => {
  renderPage();
  expect(screen.getByText("共享参数")).toBeInTheDocument();
  expect(screen.getByText("孤儿参数")).toBeInTheDocument();
  expect(screen.getByText("最近导入")).toBeInTheDocument();
});
```

`App.test.tsx` 内如对旧 4 卡 KPI 有硬断言（如"共享参数 10"的 `strong` 标签），改为对新 `.kpi-value` 文本断言或直接删除该测试（旧验收点已被新测试覆盖）。

- [ ] **Step 8：运行测试，确认通过**

Run: `npm test`
Expected: 全部 PASS（含 KpiStrip、ParameterAdminPage、App）。

- [ ] **Step 9：提交**

```bash
git add src/components/KpiStrip.tsx src/components/KpiStrip.test.tsx src/ParameterAdminPage.tsx src/ParameterAdminPage.test.tsx src/styles.css src/App.test.tsx
git commit -m "feat(parameter-admin): replace 4 big KPI cards with clickable KpiStrip"
```

---

## Task 7：主 Grid 骨架 + AgentInsightBar 占位

**目的：** 把原来的 `.config-admin-grid` 三段布局替换为 `.param-admin-shell` 响应式 grid（≥1440 列表 340 + 详情 1fr + 审计 0；抽屉展开 audit=open 时压缩为 280/1fr/400）。本 Task 只铺 grid 和空容器；列表和详情的 JSX 在后续 Task 逐步填充。同时接入 `<AgentInsightBar>`（只渲染主 Insight 那条：高风险孤儿）。

**Files:**
- Modify: `src/ParameterAdminPage.tsx`
- Modify: `src/styles.css`
- Create / Modify: `src/components/AgentInsightBar.tsx`（如果 debugging m1 已合入，复用并仅调用；否则本 Task 创建最简版）
- Create / Modify: `src/components/AgentInsightBar.test.tsx`

---

- [ ] **Step 1：检查现有 AgentInsightBar 是否存在**

Run: `ls src/components/AgentInsightBar.tsx`
如果存在：跳到 Step 3。
如果不存在：继续 Step 2。

- [ ] **Step 2：创建最简版 AgentInsightBar**

Create `src/components/AgentInsightBar.tsx`：

```tsx
import { useState, useEffect } from "react";

export type InsightAction = {
  id: string;
  label: string;
  onClick: () => void;
};

export type Insight = {
  id: string;
  tone: "neutral" | "warning" | "danger";
  headline: string;
  meta?: string;
  actions: InsightAction[];
};

export function AgentInsightBar({
  items,
  persistKey,
  dismissedIds,
  onDismiss
}: {
  items: Insight[];
  persistKey?: string;
  dismissedIds?: string[];
  onDismiss?: (id: string) => void;
}) {
  const [sessionDismissed, setSessionDismissed] = useState<Set<string>>(() => {
    if (!persistKey) return new Set();
    const raw = sessionStorage.getItem(persistKey);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  });

  useEffect(() => {
    if (!persistKey) return;
    sessionStorage.setItem(persistKey, JSON.stringify(Array.from(sessionDismissed)));
  }, [sessionDismissed, persistKey]);

  const effective = items.filter(i =>
    !sessionDismissed.has(i.id) &&
    !(dismissedIds ?? []).includes(i.id)
  );
  if (effective.length === 0) return null;

  return (
    <section className="insight-bar" role="status" aria-live="polite">
      {effective.map(insight => (
        <div key={insight.id} className="insight-item" data-tone={insight.tone}>
          <div className="insight-content">
            <strong>💡 {insight.headline}</strong>
            {insight.meta ? <span className="insight-meta">{insight.meta}</span> : null}
          </div>
          <div className="insight-actions">
            {insight.actions.map(action => (
              <button key={action.id} type="button" className="button subtle" onClick={action.onClick}>
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className="insight-dismiss"
              aria-label="今天先不看"
              onClick={() => {
                setSessionDismissed(prev => new Set(prev).add(insight.id));
                onDismiss?.(insight.id);
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
```

Create `src/components/AgentInsightBar.test.tsx`：

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentInsightBar } from "./AgentInsightBar";

beforeEach(() => sessionStorage.clear());

describe("AgentInsightBar", () => {
  it("空列表时不渲染", () => {
    const { container } = render(<AgentInsightBar items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("渲染 headline + actions + dismiss", () => {
    const onAction = vi.fn();
    render(
      <AgentInsightBar
        items={[{ id: "x", tone: "warning", headline: "测试", actions: [{ id: "a", label: "点我", onClick: onAction }] }]}
      />
    );
    expect(screen.getByText(/测试/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "点我" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("dismiss 后该条从视图移除", () => {
    render(
      <AgentInsightBar
        persistKey="test-dismiss"
        items={[{ id: "x", tone: "warning", headline: "关我", actions: [] }]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "今天先不看" }));
    expect(screen.queryByText(/关我/)).not.toBeInTheDocument();
  });
});
```

Run: `npm test -- AgentInsightBar`
Expected: PASS。

- [ ] **Step 3：写 grid 布局测试**

在 `ParameterAdminPage.test.tsx` 追加：

```tsx
it("带 data-audit 属性反映审计抽屉状态", () => {
  window.history.pushState(null, "", "/parameter-admin?audit=open");
  renderPage();
  expect(document.querySelector(".param-admin-shell")?.getAttribute("data-audit")).toBe("open");
  window.history.replaceState(null, "", "/parameter-admin");
});
```

Run: `npm test -- ParameterAdminPage`
Expected: 新测试 PASS（如果依赖上一 Task 的 audit toggle 已接入）。

- [ ] **Step 4：在 `ParameterAdminPage.tsx` 中插入 AgentInsightBar 和主 grid 容器**

```tsx
import { AgentInsightBar, type Insight } from "./components/AgentInsightBar";

// 派生主 Insight：高风险孤儿
const highRiskOrphans = library.filter(
  p => p.risk === "High" && getCoverage(p, projects) === "orphan"
);
const insights: Insight[] = [];
if (highRiskOrphans.length > 0) {
  insights.push({
    id: "high-risk-orphans",
    tone: "warning",
    headline: `参数库里有 ${highRiskOrphans.length} 个高风险孤儿参数，建议复核`,
    meta: `孤儿合计 ${library.filter(p => getCoverage(p, projects) === "orphan").length} · 其中高风险 ${highRiskOrphans.length}`,
    actions: [
      { id: "view-orphans", label: "查看孤儿参数", onClick: () => updateSearch({ coverage: "orphan" }) },
      { id: "draft-cleanup", label: "生成清理建议", onClick: () => dispatch({ type: "AGENT_ACTION_EXECUTED", actionId: "draft-cleanup", metadata: { orphanIds: highRiskOrphans.map(p => p.id) } }) }
    ]
  });
}
```

在 JSX 中，`KpiStrip` 下方插入：

```tsx
<AgentInsightBar
  items={insights}
  persistKey="parameter-admin.insight"
  dismissedIds={state.insightDismissedIds}
  onDismiss={(id) => dispatch({ type: "DISMISS_INSIGHT", insightId: id })}
/>
<div className="param-admin-grid">
  <aside className="library-column">{/* Task 8-11 填充 */}</aside>
  <section className="detail-column">{/* Task 12-16 填充 */}</section>
  <aside className="audit-column" hidden={search.audit !== "open"}>
    {/* m2 填充；本 m1 留空 */}
  </aside>
</div>
```

- [ ] **Step 5：CSS**

在 `src/styles.css` 追加：

```css
.param-admin-grid {
  display: grid;
  grid-template-columns: 340px minmax(520px, 1fr) 0;
  gap: 18px;
  transition: grid-template-columns 240ms cubic-bezier(0.2, 0, 0, 1);
}
.param-admin-shell[data-audit="open"] .param-admin-grid {
  grid-template-columns: 280px minmax(440px, 1fr) 400px;
}

.library-column,
.detail-column,
.audit-column {
  min-width: 0;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.audit-column[hidden] { display: none; }

.insight-bar { display: flex; flex-direction: column; gap: 8px; }
.insight-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fffbeb;
}
.insight-item[data-tone="warning"] { border-color: #fbbf24; background: #fef3c7; }
.insight-item[data-tone="danger"]  { border-color: #f87171; background: #fef2f2; }
.insight-content { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.insight-meta { font-size: 12px; color: var(--text-muted); }
.insight-actions { display: flex; align-items: center; gap: 8px; }
.insight-dismiss {
  background: transparent; border: 0; cursor: pointer;
  color: var(--text-muted); font-size: 14px;
}

@media (max-width: 1280px) {
  .param-admin-shell[data-audit="open"] .param-admin-grid {
    grid-template-columns: 240px minmax(380px, 1fr) 380px;
  }
}
@media (max-width: 1024px) {
  .param-admin-grid { grid-template-columns: 1fr !important; }
  .audit-column { order: 3; }
}
```

- [ ] **Step 6：运行测试**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 7：目视（可选）**

Run: `npm run dev` → 打开 `/parameter-admin` → 看到 KPI Strip + Insight（若你的 mock 里高风险孤儿 > 0）+ 空的 grid 容器。点 `审计` 按钮：URL 带上 `?audit=open`，主区右侧腾出 400px 空间。

- [ ] **Step 8：提交**

```bash
git add src/ParameterAdminPage.tsx src/components/AgentInsightBar.tsx src/components/AgentInsightBar.test.tsx src/styles.css
git commit -m "feat(parameter-admin): add responsive grid shell and agent insight bar"
```

---

## Task 8：参数库列表 · 搜索框 + 风险 chip（URL 驱动）

**目的：** 实现列表容器的 header：搜索输入 + 风险四档 chip。两者都从 URL 读写；本 Task 结束时已可按 `q` 和 `risk` 过滤；分组折叠、覆盖过滤、排序、多选留给下面的 Task。

**Files:**
- Create: `src/components/ParameterLibraryList.tsx`
- Create: `src/components/ParameterLibraryList.test.tsx`
- Create: `src/components/FilterChipGroup.tsx`
- Create: `src/components/FilterChipGroup.test.tsx`
- Modify: `src/ParameterAdminPage.tsx`

---

- [ ] **Step 1：写 FilterChipGroup 测试**

Create `src/components/FilterChipGroup.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterChipGroup } from "./FilterChipGroup";

describe("FilterChipGroup", () => {
  it("渲染选项 + active 态", () => {
    render(
      <FilterChipGroup
        ariaLabel="风险等级"
        value="high"
        options={[
          { value: "all",  label: "全部" },
          { value: "high", label: "高" },
          { value: "mid",  label: "中" },
          { value: "low",  label: "低" }
        ]}
        onChange={vi.fn()}
      />
    );
    const active = screen.getByRole("button", { name: "高", pressed: true });
    expect(active).toBeInTheDocument();
  });

  it("click 非活跃 chip 触发 onChange", () => {
    const onChange = vi.fn();
    render(
      <FilterChipGroup
        ariaLabel="R"
        value="all"
        options={[{ value: "all", label: "全部" }, { value: "high", label: "高" }]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "高" }));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("再次 click 已活跃 chip 重置为 all", () => {
    const onChange = vi.fn();
    render(
      <FilterChipGroup
        ariaLabel="R"
        value="high"
        options={[{ value: "all", label: "全部" }, { value: "high", label: "高" }]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "高" }));
    expect(onChange).toHaveBeenCalledWith("all");
  });
});
```

- [ ] **Step 2：运行（确认失败）**

Run: `npm test -- FilterChipGroup`
Expected: FAIL。

- [ ] **Step 3：实现 FilterChipGroup**

Create `src/components/FilterChipGroup.tsx`：

```tsx
export type ChipOption = { value: string; label: string };

export function FilterChipGroup({
  ariaLabel,
  value,
  options,
  onChange
}: {
  ariaLabel: string;
  value: string;
  options: ChipOption[];
  onChange: (next: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="filter-chips">
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="button"
            aria-pressed={active}
            className={`chip${active ? " chip-active" : ""}`}
            onClick={() => onChange(active && opt.value !== "all" ? "all" : opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4：写 ParameterLibraryList 最小渲染测试（搜索 + 风险过滤）**

Create `src/components/ParameterLibraryList.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ParameterLibraryList } from "./ParameterLibraryList";
import { initialState } from "../mockData";

function defaultProps(overrides: Partial<Parameters<typeof ParameterLibraryList>[0]> = {}) {
  return {
    parameters: initialState.configDraft.parameterLibrary,
    projects: initialState.configDraft.projects,
    selectedId: undefined,
    onSelect: vi.fn(),
    search: { q: "", risk: "all", modules: [], coverage: "all", sort: "updatedAt-desc" },
    onUpdateSearch: vi.fn(),
    ...overrides
  } as any;
}

describe("ParameterLibraryList · 搜索 / 风险", () => {
  it("渲染所有参数", () => {
    render(<ParameterLibraryList {...defaultProps()} />);
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBe(initialState.configDraft.parameterLibrary.length);
  });

  it("search.q 过滤结果", () => {
    render(<ParameterLibraryList {...defaultProps({ search: { q: "fast", risk: "all", modules: [], coverage: "all", sort: "updatedAt-desc" } })} />);
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(r => expect(r.textContent?.toLowerCase()).toContain("fast"));
  });

  it("search.risk = high 只保留高风险", () => {
    render(<ParameterLibraryList {...defaultProps({ search: { q: "", risk: "high", modules: [], coverage: "all", sort: "updatedAt-desc" } })} />);
    const rows = screen.getAllByRole("option");
    const expectedCount = initialState.configDraft.parameterLibrary.filter(p => p.risk === "High").length;
    expect(rows.length).toBe(expectedCount);
  });

  it("搜索输入触发 onUpdateSearch({ q })", () => {
    const props = defaultProps();
    render(<ParameterLibraryList {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "charge" } });
    expect(props.onUpdateSearch).toHaveBeenCalledWith({ q: "charge" });
  });

  it("风险 chip click 触发 onUpdateSearch({ risk })", () => {
    const props = defaultProps();
    render(<ParameterLibraryList {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "高" }));
    expect(props.onUpdateSearch).toHaveBeenCalledWith({ risk: "high" });
  });

  it("搜索无结果展示空态", () => {
    render(<ParameterLibraryList {...defaultProps({ search: { q: "zzz-no-match", risk: "all", modules: [], coverage: "all", sort: "updatedAt-desc" } })} />);
    expect(screen.getByText(/没有匹配/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5：运行（确认失败）**

Run: `npm test -- ParameterLibraryList`
Expected: FAIL。

- [ ] **Step 6：实现 ParameterLibraryList（MVP：搜索 + 风险，后续 Task 迭代）**

Create `src/components/ParameterLibraryList.tsx`：

```tsx
import { Search } from "lucide-react";
import { FilterChipGroup } from "./FilterChipGroup";
import type { ParamAdminSearch } from "../hooks/useParamAdminSearch";
import type { ParameterEditorDraft, ProjectConfig } from "../powerManagementConfig";

type RiskLabel = "高" | "中" | "低";
const RISK_TO_VAL: Record<string, "high" | "medium" | "low"> = { High: "high", Medium: "medium", Low: "low" };

export function ParameterLibraryList({
  parameters,
  projects,
  selectedId,
  onSelect,
  search,
  onUpdateSearch
}: {
  parameters: ParameterEditorDraft[];
  projects: readonly ProjectConfig[];
  selectedId?: string;
  onSelect: (id: string) => void;
  search: ParamAdminSearch;
  onUpdateSearch: (patch: Partial<ParamAdminSearch>) => void;
}) {
  const filtered = parameters.filter(p => {
    if (search.q) {
      const needle = search.q.toLowerCase();
      const hay = `${p.name} ${p.module} ${p.description ?? ""} ${p.explanation ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (search.risk !== "all") {
      const wanted = search.risk;
      if (RISK_TO_VAL[p.risk] !== wanted) return false;
    }
    return true;
  });

  return (
    <div className="library-inner">
      <header className="library-header">
        <div className="library-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            placeholder="搜索 name / module / 描述"
            aria-label="搜索参数"
            value={search.q}
            onChange={(e) => onUpdateSearch({ q: e.target.value })}
          />
        </div>
        <FilterChipGroup
          ariaLabel="风险等级"
          value={search.risk}
          options={[
            { value: "all", label: "全部" },
            { value: "high", label: "高" },
            { value: "medium", label: "中" },
            { value: "low", label: "低" }
          ]}
          onChange={(v) => onUpdateSearch({ risk: v as ParamAdminSearch["risk"] })}
        />
      </header>
      {filtered.length === 0 ? (
        <div className="library-empty">
          <p>{search.q ? `没有匹配 "${search.q}" 的参数` : "当前筛选下没有参数"}</p>
          <button type="button" className="button subtle" onClick={() => onUpdateSearch({ q: "", risk: "all", modules: [], coverage: "all" })}>
            清除筛选
          </button>
        </div>
      ) : (
        <ul className="library-list" role="listbox" aria-label="项目共享参数库">
          {filtered.map(p => (
            <li
              key={p.id}
              role="option"
              aria-selected={selectedId === p.id}
              tabIndex={selectedId === p.id ? 0 : -1}
              className={`library-row${selectedId === p.id ? " selected" : ""}`}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.id); } }}
            >
              <span className="library-row-main">
                <strong>{p.name}</strong>
                <small>{p.module}</small>
              </span>
              <span className={`risk-badge risk-${RISK_TO_VAL[p.risk]}`} aria-label={`重要性 ${p.risk}`}>
                {p.risk === "High" ? "🔴 高" : p.risk === "Medium" ? "🟡 中" : "🟢 低"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7：接入 ParameterAdminPage**

```tsx
import { ParameterLibraryList } from "./components/ParameterLibraryList";

// 在 library-column 内
<ParameterLibraryList
  parameters={library}
  projects={projects}
  selectedId={search.id}
  onSelect={(id) => updateSearch({ id })}
  search={search}
  onUpdateSearch={updateSearch}
/>
```

- [ ] **Step 8：补 CSS**

在 `src/styles.css` 追加：

```css
.library-inner { display: flex; flex-direction: column; height: 100%; }

.library-header {
  position: sticky;
  top: 0;
  padding: 12px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.library-search {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}
.library-search input {
  flex: 1; border: 0; outline: 0; font-size: 13px;
  background: transparent;
}

.filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
}
.chip-active { background: var(--app-primary); color: #fff; border-color: var(--app-primary); }

.library-list { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1; }
.library-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  outline: none;
}
.library-row:hover { background: rgba(16, 28, 45, 0.035); }
.library-row.selected {
  background: var(--selected-row-bg, rgba(0, 64, 162, 0.08));
  box-shadow: inset 3px 0 0 var(--app-primary);
}
.library-row:focus-visible { outline: 2px solid var(--app-primary); outline-offset: -2px; }
.library-row-main { display: flex; flex-direction: column; min-width: 0; }
.library-row-main strong {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.library-row-main small { color: var(--text-muted); font-size: 11px; }

.risk-badge { font-size: 11px; white-space: nowrap; }
.risk-high   { color: var(--status-risk-high, #ba1a1a); }
.risk-medium { color: #d97706; }
.risk-low    { color: #047857; }

.library-empty { padding: 24px; text-align: center; color: var(--text-muted); }
```

- [ ] **Step 9：运行测试**

Run: `npm test -- ParameterLibraryList FilterChipGroup ParameterAdminPage`
Expected: 全部 PASS。

- [ ] **Step 10：提交**

```bash
git add src/components/ParameterLibraryList.tsx src/components/ParameterLibraryList.test.tsx src/components/FilterChipGroup.tsx src/components/FilterChipGroup.test.tsx src/ParameterAdminPage.tsx src/styles.css
git commit -m "feat(parameter-admin): add library search and risk chip filter"
```

---

## Task 9：列表 · 模块多选下拉 + 覆盖下拉（含"孤儿参数"）

**目的：** 在列表 header 追加两组 dropdown 过滤：模块多选、覆盖单选（全部 / 3 项目都有 / 缺某个项目 / 孤儿参数）。

**Files:**
- Create: `src/components/MultiSelectDropdown.tsx`
- Create: `src/components/MultiSelectDropdown.test.tsx`
- Modify: `src/components/ParameterLibraryList.tsx`
- Modify: `src/components/ParameterLibraryList.test.tsx`

---

- [ ] **Step 1：测试先行 —— MultiSelectDropdown**

Create `src/components/MultiSelectDropdown.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MultiSelectDropdown } from "./MultiSelectDropdown";

describe("MultiSelectDropdown", () => {
  it("按钮显示已选数量", () => {
    render(
      <MultiSelectDropdown
        label="模块"
        value={["a", "b"]}
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /模块 \(2\)/ })).toBeInTheDocument();
  });

  it("click 打开菜单并可勾选", () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown
        label="模块"
        value={[]}
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });

  it("再次 click 已勾选项取消", () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown
        label="模块"
        value={["a"]}
        options={[{ value: "a", label: "A" }]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2：运行（确认失败）**

Run: `npm test -- MultiSelectDropdown`
Expected: FAIL。

- [ ] **Step 3：实现 MultiSelectDropdown**

Create `src/components/MultiSelectDropdown.tsx`：

```tsx
import { useState, useRef, useEffect } from "react";

export type DropdownOption = { value: string; label: string };

export function MultiSelectDropdown({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string[];
  options: DropdownOption[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handle);
    return () => window.removeEventListener("mousedown", handle);
  }, [open]);

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter(x => x !== v));
    else onChange([...value, v]);
  };

  return (
    <div className="dropdown-root" ref={rootRef}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {label}{value.length ? ` (${value.length})` : ""} ▾
      </button>
      {open ? (
        <div className="dropdown-menu" role="listbox" aria-multiselectable>
          {options.map(opt => (
            <label key={opt.value} className="dropdown-item">
              <input
                type="checkbox"
                aria-label={opt.label}
                checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

CSS in `styles.css`:

```css
.dropdown-root { position: relative; }
.dropdown-trigger {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
}
.dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  min-width: 200px;
  max-height: 280px;
  overflow-y: auto;
  z-index: 10;
  padding: 6px;
}
.dropdown-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
}
.dropdown-item:hover { background: rgba(16, 28, 45, 0.04); }
```

- [ ] **Step 4：在 ParameterLibraryList 接入两组下拉**

在 header 内补：

```tsx
import { MultiSelectDropdown } from "./MultiSelectDropdown";
import { getCoverage } from "../parameterAdminAnalytics";

// 派生模块选项
const moduleOptions = Array.from(new Set(parameters.map(p => p.module))).map(m => ({ value: m, label: m }));

// 在 header JSX 中追加：
<MultiSelectDropdown
  label="模块"
  value={search.modules}
  options={moduleOptions}
  onChange={(next) => onUpdateSearch({ modules: next })}
/>
<div className="dropdown-root">
  <button type="button" className="dropdown-trigger" onClick={() => setCovOpen(o => !o)}>
    覆盖 {search.coverage !== "all" ? `· ${COVERAGE_LABEL[search.coverage]}` : ""} ▾
  </button>
  {covOpen ? (
    <div className="dropdown-menu" role="listbox">
      {COVERAGE_OPTIONS.map(opt => (
        <label key={opt.value} className="dropdown-item">
          <input type="radio" name="coverage" aria-label={opt.label} checked={search.coverage === opt.value} onChange={() => { onUpdateSearch({ coverage: opt.value as any }); setCovOpen(false); }} />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  ) : null}
</div>
```

在顶部定义常量：

```tsx
const COVERAGE_OPTIONS = [
  { value: "all",     label: "全部" },
  { value: "full",    label: "3 个项目都有" },
  { value: "partial", label: "缺某个项目" },
  { value: "orphan",  label: "孤儿参数" }
];
const COVERAGE_LABEL: Record<string, string> = Object.fromEntries(COVERAGE_OPTIONS.map(o => [o.value, o.label]));
```

扩展过滤函数：

```tsx
const filtered = parameters.filter(p => {
  if (search.q) { /* ...原逻辑不变 */ }
  if (search.risk !== "all") { /* ... */ }
  if (search.modules.length && !search.modules.includes(p.module)) return false;
  if (search.coverage !== "all" && getCoverage(p, projects) !== search.coverage) return false;
  return true;
});
```

需要 `useState` for `covOpen`：

```tsx
import { useState } from "react";
const [covOpen, setCovOpen] = useState(false);
```

- [ ] **Step 5：在 ParameterLibraryList 测试补覆盖**

```tsx
it("search.coverage = orphan 只保留孤儿", () => {
  // 为让至少一个孤儿出现：构造 parameters 里某条 values 全为空
  const arranged = initialState.configDraft.parameterLibrary.map((p, i) =>
    i === 0 ? { ...p, values: Object.fromEntries(initialState.configDraft.projects.map(pj => [pj.id, { ...p.values[pj.id], currentValue: "" }])) } : p
  );
  render(
    <ParameterLibraryList
      {...defaultProps({
        parameters: arranged,
        search: { q: "", risk: "all", modules: [], coverage: "orphan", sort: "updatedAt-desc" }
      })}
    />
  );
  const rows = screen.getAllByRole("option");
  expect(rows.length).toBe(1);
});
```

- [ ] **Step 6：运行测试**

Run: `npm test -- ParameterLibraryList MultiSelectDropdown`
Expected: 全部 PASS。

- [ ] **Step 7：提交**

```bash
git add src/components/MultiSelectDropdown.tsx src/components/MultiSelectDropdown.test.tsx src/components/ParameterLibraryList.tsx src/components/ParameterLibraryList.test.tsx src/styles.css
git commit -m "feat(parameter-admin): add module multiselect and coverage (incl. orphan) filter"
```

---

## Task 10：列表 · 模块分组折叠 + 排序下拉 + 清除筛选按钮

**目的：** 把扁平列表改为按模块分组渲染；每组可折叠（sessionStorage 持久化）；顶部提供排序下拉；筛选活跃时提供"清除筛选"图标按钮。

**Files:**
- Modify: `src/components/ParameterLibraryList.tsx`
- Modify: `src/components/ParameterLibraryList.test.tsx`
- Modify: `src/styles.css`

---

- [ ] **Step 1：追加分组 / 排序 / 清除测试**

```tsx
it("按模块分组，每组有标题和计数", () => {
  render(<ParameterLibraryList {...defaultProps()} />);
  expect(screen.getByRole("button", { name: /Charging Policy/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Battery Safety/ })).toBeInTheDocument();
});

it("click 分组标题折叠该组", () => {
  render(<ParameterLibraryList {...defaultProps()} />);
  const group = screen.getByRole("button", { name: /Charging Policy/ });
  fireEvent.click(group);
  const charging = screen.queryAllByRole("option").filter(o => o.textContent?.includes("fast_charge"));
  expect(charging.length).toBe(0);
});

it("活跃筛选时展示清除按钮", () => {
  render(<ParameterLibraryList {...defaultProps({ search: { q: "", risk: "high", modules: [], coverage: "all", sort: "updatedAt-desc" } })} />);
  expect(screen.getByRole("button", { name: /清除筛选/ })).toBeInTheDocument();
});

it("click 清除筛选触发批量 onUpdateSearch 重置", () => {
  const props = defaultProps({ search: { q: "xx", risk: "high", modules: ["Charging Policy"], coverage: "orphan", sort: "updatedAt-desc" } });
  render(<ParameterLibraryList {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /清除筛选/ }));
  expect(props.onUpdateSearch).toHaveBeenCalledWith(expect.objectContaining({ q: "", risk: "all", modules: [], coverage: "all" }));
});

it("排序按名称升序", () => {
  render(<ParameterLibraryList {...defaultProps({ search: { q: "", risk: "all", modules: [], coverage: "all", sort: "name-asc" } })} />);
  const rows = screen.getAllByRole("option");
  const names = rows.map(r => r.textContent?.match(/[a-z_]+/)?.[0] ?? "");
  const sorted = [...names].sort();
  expect(names).toEqual(sorted);
});
```

- [ ] **Step 2：运行（确认失败）**

Run: `npm test -- ParameterLibraryList`

- [ ] **Step 3：改造 ParameterLibraryList —— 分组 + 排序 + 清除**

在组件内：

```tsx
function sortParameters(list: ParameterEditorDraft[], sort: string): ParameterEditorDraft[] {
  const arr = [...list];
  switch (sort) {
    case "name-asc":    arr.sort((a, b) => a.name.localeCompare(b.name)); break;
    case "risk-desc":   arr.sort((a, b) => riskWeight(b.risk) - riskWeight(a.risk)); break;
    case "coverage-asc":// 依赖外部 projects；在 filtered 之后再外部补排
      break;
    case "updatedAt-desc":
    default:
      // 用 values 中最晚的 updatedAt
      arr.sort((a, b) => latestUpdatedAt(b) - latestUpdatedAt(a));
  }
  return arr;
}
function riskWeight(r: string) { return r === "High" ? 3 : r === "Medium" ? 2 : 1; }
function latestUpdatedAt(p: ParameterEditorDraft): number {
  const times = Object.values(p.values ?? {}).map(v => {
    const t = new Date(v.updatedAt).getTime();
    return Number.isFinite(t) ? t : 0;
  });
  return times.length ? Math.max(...times) : 0;
}

// 分组
const grouped = new Map<string, ParameterEditorDraft[]>();
for (const p of sortParameters(filtered, search.sort)) {
  const arr = grouped.get(p.module) ?? [];
  arr.push(p);
  grouped.set(p.module, arr);
}

// sessionStorage 折叠
const COLLAPSED_KEY = "parameter-admin.collapsed-groups";
const [collapsed, setCollapsed] = useState<Set<string>>(() => {
  try {
    const raw = sessionStorage.getItem(COLLAPSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
});
useEffect(() => {
  sessionStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(collapsed)));
}, [collapsed]);

// 搜索有值时强制全部展开
const forceExpand = Boolean(search.q);

const filtersActive = search.q.length > 0 || search.risk !== "all" || search.modules.length > 0 || search.coverage !== "all";
```

Header 区追加排序下拉（简单 `<select>`）：

```tsx
<select
  className="library-sort"
  aria-label="排序"
  value={search.sort}
  onChange={(e) => onUpdateSearch({ sort: e.target.value })}
>
  <option value="updatedAt-desc">更新时间 ↓</option>
  <option value="name-asc">名称 A-Z</option>
  <option value="risk-desc">风险 ↓</option>
</select>
{filtersActive ? (
  <button
    type="button"
    className="clear-filters"
    aria-label="清除筛选"
    onClick={() => onUpdateSearch({ q: "", risk: "all", modules: [], coverage: "all" })}
  >
    ✕ 清除筛选
  </button>
) : null}
```

替换原 `<ul className="library-list">` 为分组结构：

```tsx
<div className="library-list" role="listbox" aria-label="项目共享参数库">
  {Array.from(grouped.entries()).map(([moduleName, items]) => {
    const isCollapsed = !forceExpand && collapsed.has(moduleName);
    return (
      <section key={moduleName} className="param-group">
        <button
          type="button"
          className="param-group-header"
          aria-expanded={!isCollapsed}
          onClick={() => {
            setCollapsed(prev => {
              const next = new Set(prev);
              if (next.has(moduleName)) next.delete(moduleName); else next.add(moduleName);
              return next;
            });
          }}
        >
          <span>{isCollapsed ? "▸" : "▾"}</span>
          <strong>{moduleName}</strong>
          <span className="param-group-count">({items.length})</span>
        </button>
        {!isCollapsed ? (
          <ul className="param-group-list">
            {items.map(p => (
              <li
                key={p.id}
                role="option"
                aria-selected={selectedId === p.id}
                tabIndex={selectedId === p.id ? 0 : -1}
                className={`library-row${selectedId === p.id ? " selected" : ""}`}
                onClick={() => onSelect(p.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.id); } }}
              >
                {/* 行内容同 Task 8 */}
                <span className="library-row-main">
                  <strong>{p.name}</strong>
                  <small>{p.module}</small>
                </span>
                <span className={`risk-badge risk-${RISK_TO_VAL[p.risk]}`} aria-label={`重要性 ${p.risk}`}>
                  {p.risk === "High" ? "🔴 高" : p.risk === "Medium" ? "🟡 中" : "🟢 低"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  })}
</div>
```

- [ ] **Step 4：CSS 补充**

```css
.library-sort { font-size: 12px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border); }
.clear-filters { font-size: 12px; color: var(--text-muted); background: none; border: 0; cursor: pointer; }

.param-group { }
.param-group-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 0;
  border-top: 1px solid var(--border);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  cursor: pointer;
}
.param-group-header strong { font-weight: 600; color: var(--text); letter-spacing: 0; text-transform: none; }
.param-group-count { margin-left: auto; color: var(--text-muted); }
.param-group-list { list-style: none; margin: 0; padding: 0; }
```

- [ ] **Step 5：运行测试，确认通过**

Run: `npm test -- ParameterLibraryList`
Expected: 全部 PASS（若某些断言因分组结构微调 DOM 层级不命中，重写断言）。

- [ ] **Step 6：提交**

```bash
git add src/components/ParameterLibraryList.tsx src/components/ParameterLibraryList.test.tsx src/styles.css
git commit -m "feat(parameter-admin): group library by module, sort dropdown, clear filters"
```

---


## Task 11：详情区 · RiskPicker + 推荐值 ⓘ + 参数名校验

**目的：** 把共享定义表单的"重要性 select"替换为色标 RiskPicker；为"推荐值"加 `ⓘ 对所有项目生效` 提示；在参数名输入上做 snake_case 正则和重名校验。展示描述 / 参数解释 / 配置格式字段保持不变（后续 m2 再做 monospace）。

**Files:**
- Create: `src/components/RiskPicker.tsx`
- Create: `src/components/RiskPicker.test.tsx`
- Create: `src/components/ParameterDefinitionForm.tsx`
- Create: `src/components/ParameterDefinitionForm.test.tsx`
- Modify: `src/ParameterAdminPage.tsx`

---

- [ ] **Step 1：RiskPicker 测试**

Create `src/components/RiskPicker.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RiskPicker } from "./RiskPicker";

describe("RiskPicker", () => {
  it("三档按钮可见 + 当前值高亮", () => {
    render(<RiskPicker value="High" onChange={vi.fn()} />);
    const high = screen.getByRole("radio", { name: /高/ });
    expect(high).toHaveAttribute("aria-checked", "true");
    const mid = screen.getByRole("radio", { name: /中/ });
    expect(mid).toHaveAttribute("aria-checked", "false");
  });

  it("click 中触发 onChange Medium", () => {
    const onChange = vi.fn();
    render(<RiskPicker value="High" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /中/ }));
    expect(onChange).toHaveBeenCalledWith("Medium");
  });

  it("键盘方向键切换", () => {
    const onChange = vi.fn();
    render(<RiskPicker value="High" onChange={onChange} />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("Medium");
  });
});
```

- [ ] **Step 2：运行（失败）**

Run: `npm test -- RiskPicker`
Expected: FAIL。

- [ ] **Step 3：实现 RiskPicker**

Create `src/components/RiskPicker.tsx`：

```tsx
import type { RiskLevel } from "../mockData";

const ORDER: RiskLevel[] = ["High", "Medium", "Low"];
const LABEL: Record<RiskLevel, string> = { High: "高", Medium: "中", Low: "低" };
const CLASS: Record<RiskLevel, string> = { High: "high", Medium: "medium", Low: "low" };

export function RiskPicker({
  value,
  onChange
}: {
  value: RiskLevel;
  onChange: (next: RiskLevel) => void;
}) {
  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = ORDER.indexOf(value);
    if (idx < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      const next = ORDER[(idx + 1) % ORDER.length];
      onChange(next);
      e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      const next = ORDER[(idx - 1 + ORDER.length) % ORDER.length];
      onChange(next);
      e.preventDefault();
    }
  };

  return (
    <div className="risk-picker" role="radiogroup" aria-label="重要性" tabIndex={0} onKeyDown={handleKey}>
      {ORDER.map(level => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          className={`risk-picker-option risk-${CLASS[level]}${value === level ? " active" : ""}`}
          onClick={() => onChange(level)}
        >
          ● {LABEL[level]}
        </button>
      ))}
    </div>
  );
}
```

CSS:

```css
.risk-picker {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
}
.risk-picker:focus-visible { box-shadow: 0 0 0 2px var(--app-primary); }
.risk-picker-option {
  border: 0;
  background: transparent;
  padding: 4px 10px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
}
.risk-picker-option.risk-high   { color: var(--status-risk-high, #ba1a1a); }
.risk-picker-option.risk-medium { color: #d97706; }
.risk-picker-option.risk-low    { color: #047857; }
.risk-picker-option.active {
  background: rgba(16, 28, 45, 0.06);
  font-weight: 600;
}
```

- [ ] **Step 4：ParameterDefinitionForm 测试**

Create `src/components/ParameterDefinitionForm.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ParameterDefinitionForm } from "./ParameterDefinitionForm";
import { initialState } from "../mockData";

function build(overrides: Partial<Parameters<typeof ParameterDefinitionForm>[0]> = {}) {
  const parameter = initialState.configDraft.parameterLibrary[0];
  const projects = initialState.configDraft.projects;
  return {
    parameter,
    projects,
    allParameters: initialState.configDraft.parameterLibrary,
    onMetadataChange: vi.fn(),
    onRecommendedValueChange: vi.fn(),
    ...overrides
  };
}

describe("ParameterDefinitionForm", () => {
  it("渲染参数名 + 模块 + 推荐值 + 单位 + 风险 + 文本区", () => {
    render(<ParameterDefinitionForm {...build()} />);
    expect(screen.getByLabelText("参数名")).toBeInTheDocument();
    expect(screen.getByLabelText("模块")).toBeInTheDocument();
    expect(screen.getByLabelText(/推荐值/)).toBeInTheDocument();
    expect(screen.getByLabelText("单位")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "重要性" })).toBeInTheDocument();
  });

  it("推荐值标签显示 ⓘ 提示含"对所有项目生效"", async () => {
    render(<ParameterDefinitionForm {...build()} />);
    expect(screen.getByText(/对所有项目生效/)).toBeInTheDocument();
  });

  it("修改推荐值触发 onRecommendedValueChange（全局写）", () => {
    const props = build();
    render(<ParameterDefinitionForm {...props} />);
    fireEvent.change(screen.getByLabelText(/推荐值/), { target: { value: "9999" } });
    expect(props.onRecommendedValueChange).toHaveBeenCalledWith("9999");
  });

  it("参数名 snake_case 违规时显示错误", () => {
    render(<ParameterDefinitionForm {...build()} />);
    fireEvent.change(screen.getByLabelText("参数名"), { target: { value: "BadName" } });
    expect(screen.getByText(/只允许小写字母、数字、下划线/)).toBeInTheDocument();
  });

  it("参数名重名时显示错误", () => {
    const params = initialState.configDraft.parameterLibrary;
    render(<ParameterDefinitionForm {...build({ parameter: { ...params[0] }, allParameters: params })} />);
    fireEvent.change(screen.getByLabelText("参数名"), { target: { value: params[1].name } });
    expect(screen.getByText(/已存在同名参数/)).toBeInTheDocument();
  });

  it("范围 min/max 两个数值输入", () => {
    render(<ParameterDefinitionForm {...build()} />);
    expect(screen.getByLabelText("范围最小值")).toBeInTheDocument();
    expect(screen.getByLabelText("范围最大值")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5：运行（失败）**

Run: `npm test -- ParameterDefinitionForm`

- [ ] **Step 6：实现 ParameterDefinitionForm**

Create `src/components/ParameterDefinitionForm.tsx`：

```tsx
import type { ParameterEditorDraft, ProjectConfig, ParameterValueDraft } from "../powerManagementConfig";
import type { RiskLevel } from "../mockData";
import { RiskPicker } from "./RiskPicker";
import { migrateParameterRange } from "../parameterAdminAnalytics";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function ParameterDefinitionForm({
  parameter,
  projects,
  allParameters,
  onMetadataChange,
  onRecommendedValueChange
}: {
  parameter: ParameterEditorDraft;
  projects: readonly ProjectConfig[];
  allParameters: readonly ParameterEditorDraft[];
  onMetadataChange: (patch: Partial<ParameterEditorDraft>) => void;
  onRecommendedValueChange: (value: string) => void;
}) {
  const nameInvalidReason = (() => {
    if (!parameter.name) return "参数名不能为空";
    if (!NAME_RE.test(parameter.name)) return "只允许小写字母、数字、下划线，且首字符为字母";
    if (allParameters.some(p => p.id !== parameter.id && p.name === parameter.name)) return "已存在同名参数";
    return null;
  })();

  const range = migrateParameterRange(parameter.range);
  const firstProjectId = projects[0]?.id;
  const recommendedValue = firstProjectId
    ? parameter.values?.[firstProjectId]?.recommendedValue ?? ""
    : "";

  return (
    <form className="param-def-form" onSubmit={(e) => e.preventDefault()}>
      <label>
        参数名
        <input
          aria-label="参数名"
          value={parameter.name}
          aria-invalid={!!nameInvalidReason}
          onChange={(e) => onMetadataChange({ name: e.target.value })}
        />
        {nameInvalidReason ? <span className="field-error">{nameInvalidReason}</span> : null}
      </label>
      <label>
        模块
        <input
          aria-label="模块"
          value={parameter.module}
          onChange={(e) => onMetadataChange({ module: e.target.value })}
        />
      </label>
      <label className="field-with-hint">
        推荐值 <span className="field-hint" title="对所有项目生效。要编辑单个项目的实际值，请到下方"项目值矩阵"。">ⓘ 对所有项目生效</span>
        <input
          aria-label="推荐值"
          value={recommendedValue}
          onChange={(e) => onRecommendedValueChange(e.target.value)}
        />
      </label>
      <div className="range-group">
        <label>
          范围最小值
          <input
            aria-label="范围最小值"
            type="number"
            value={range.min ?? ""}
            onChange={(e) => {
              const maxStr = range.max !== undefined ? range.max : "";
              const next = `${e.target.value}${maxStr !== "" ? ` - ${maxStr}` : ""}`;
              onMetadataChange({ range: next });
            }}
          />
        </label>
        <label>
          范围最大值
          <input
            aria-label="范围最大值"
            type="number"
            value={range.max ?? ""}
            onChange={(e) => {
              const minStr = range.min !== undefined ? range.min : "";
              const next = `${minStr !== "" ? `${minStr} - ` : ""}${e.target.value}`;
              onMetadataChange({ range: next });
            }}
          />
        </label>
      </div>
      <label>
        单位
        <input
          aria-label="单位"
          value={parameter.unit}
          onChange={(e) => onMetadataChange({ unit: e.target.value })}
        />
      </label>
      <div className="risk-row">
        <span id="risk-label">重要性</span>
        <RiskPicker
          value={parameter.risk as RiskLevel}
          onChange={(next) => onMetadataChange({ risk: next })}
        />
      </div>
      <label className="wide">
        展示描述
        <textarea
          value={parameter.description}
          onChange={(e) => onMetadataChange({ description: e.target.value })}
          rows={2}
        />
      </label>
      <label className="wide">
        参数解释
        <textarea
          value={parameter.explanation}
          onChange={(e) => onMetadataChange({ explanation: e.target.value })}
          rows={3}
        />
      </label>
      <label className="wide">
        配置格式
        <textarea
          value={parameter.configFormat}
          onChange={(e) => onMetadataChange({ configFormat: e.target.value })}
          rows={3}
          style={{ fontFamily: "var(--font-mono, monospace)" }}
        />
      </label>
    </form>
  );
}
```

CSS:

```css
.param-def-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  padding: 16px;
}
.param-def-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
.param-def-form input,
.param-def-form textarea {
  font-size: 13px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
}
.param-def-form input[aria-invalid="true"] { border-color: var(--status-risk-high, #ba1a1a); }
.param-def-form .field-error {
  font-size: 11px;
  color: var(--status-risk-high, #ba1a1a);
}
.field-with-hint { position: relative; }
.field-hint { color: var(--text-muted); font-size: 11px; }
.range-group { display: flex; gap: 10px; }
.range-group label { flex: 1; }
.risk-row { display: flex; flex-direction: column; gap: 4px; }
.param-def-form label.wide { grid-column: 1 / -1; }
```

- [ ] **Step 7：接入 ParameterAdminPage**

在 `ParameterAdminPage.tsx` 的 detail-column 内：

```tsx
import { ParameterDefinitionForm } from "./components/ParameterDefinitionForm";

// 替换原 AdminPageScaffold 的 config-form-grid 整块
const selectedParameter = library.find(p => p.id === search.id) ?? library[0];

{selectedParameter ? (
  <section className="detail-inner">
    <header className="detail-header">
      <strong>{selectedParameter.name}</strong>
      <span className={`risk-badge risk-${selectedParameter.risk === "High" ? "high" : selectedParameter.risk === "Medium" ? "medium" : "low"}`}>
        {selectedParameter.risk === "High" ? "🔴 高" : selectedParameter.risk === "Medium" ? "🟡 中" : "🟢 低"}
      </span>
    </header>
    <ParameterDefinitionForm
      parameter={selectedParameter}
      projects={projects}
      allParameters={library}
      onMetadataChange={(patch) => dispatch({
        type: "UPDATE_PROJECT_PARAMETER_METADATA",
        projectId: projects[0]?.id ?? state.activeProjectId,
        parameterId: selectedParameter.id,
        patch
      })}
      onRecommendedValueChange={(value) => {
        projects.forEach(project => dispatch({
          type: "UPDATE_PROJECT_PARAMETER_VALUE",
          projectId: project.id,
          parameterId: selectedParameter.id,
          patch: { recommendedValue: value }
        }));
      }}
    />
    {/* Task 12 填充项目值矩阵 */}
  </section>
) : (
  <div className="detail-empty">选择一个参数查看定义与项目值</div>
)}
```

CSS:

```css
.detail-inner { display: flex; flex-direction: column; }
.detail-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 12px 16px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 12px;
  align-items: center;
}
.detail-header strong { font-family: var(--font-mono, monospace); font-size: 14px; }
.detail-empty { padding: 48px; text-align: center; color: var(--text-muted); }
```

- [ ] **Step 8：运行测试**

Run: `npm test -- RiskPicker ParameterDefinitionForm ParameterAdminPage`
Expected: 全部 PASS。

- [ ] **Step 9：提交**

```bash
git add src/components/RiskPicker.tsx src/components/RiskPicker.test.tsx src/components/ParameterDefinitionForm.tsx src/components/ParameterDefinitionForm.test.tsx src/ParameterAdminPage.tsx src/styles.css
git commit -m "feat(parameter-admin): definition form with RiskPicker, recommended ⓘ hint, name validation"
```

---

## Task 12：详情区 · 项目值矩阵改造

**目的：** 实现新项目值矩阵：单位 suffix、越界色标、偏差百分比 + 色标、**只读** `updatedAt`（改值自动更新时间戳）。

**Files:**
- Create: `src/components/ProjectValueMatrix.tsx`
- Create: `src/components/ProjectValueMatrix.test.tsx`
- Modify: `src/ParameterAdminPage.tsx`

---

- [ ] **Step 1：矩阵测试**

Create `src/components/ProjectValueMatrix.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectValueMatrix } from "./ProjectValueMatrix";
import { initialState } from "../mockData";

function build(overrides: any = {}) {
  const projects = initialState.configDraft.projects;
  const parameter = initialState.configDraft.parameterLibrary[0];
  return {
    parameter,
    projects,
    onValueChange: vi.fn(),
    ...overrides
  };
}

describe("ProjectValueMatrix", () => {
  it("每个项目一行，含当前值输入 + 单位 + 偏差 + 更新时间（只读）", () => {
    render(<ProjectValueMatrix {...build()} />);
    for (const project of initialState.configDraft.projects) {
      expect(screen.getByLabelText(`${project.code} 当前值`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/更新时间(?!显示)/)).toBeNull(); // 更新时间不再有 input
  });

  it("单位显示在当前值右侧", () => {
    const parameter = { ...initialState.configDraft.parameterLibrary[0], unit: "mA" };
    render(<ProjectValueMatrix {...build({ parameter })} />);
    expect(screen.getAllByText("mA").length).toBe(initialState.configDraft.projects.length);
  });

  it("值越界高亮 + aria-invalid=true", () => {
    const parameter = {
      ...initialState.configDraft.parameterLibrary[0],
      range: "2500 - 4500",
      values: Object.fromEntries(
        initialState.configDraft.projects.map((pj, i) => [pj.id, {
          currentValue: i === 0 ? "4800" : "3000",
          recommendedValue: "3200",
          updatedAt: "2026-05-10T00:00:00.000Z"
        }])
      )
    };
    render(<ProjectValueMatrix {...build({ parameter })} />);
    const outOfRange = screen.getByDisplayValue("4800");
    expect(outOfRange.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/超过上限 4500|越界/)).toBeInTheDocument();
  });

  it("修改当前值触发 onValueChange 同时写入 updatedAt", () => {
    const props = build();
    render(<ProjectValueMatrix {...props} />);
    const firstInput = screen.getByLabelText(`${initialState.configDraft.projects[0].code} 当前值`);
    fireEvent.change(firstInput, { target: { value: "3100" } });
    expect(props.onValueChange).toHaveBeenCalledWith(
      initialState.configDraft.projects[0].id,
      expect.objectContaining({ currentValue: "3100", updatedAt: expect.any(String) })
    );
  });

  it("偏差色标：偏差 <=10% → 绿；10-25 → 黄；>25 → 红", () => {
    const parameter = {
      ...initialState.configDraft.parameterLibrary[0],
      values: Object.fromEntries(
        initialState.configDraft.projects.map((pj, i) => [pj.id, {
          currentValue: String([3400, 4100, 5000][i]), // 推荐 3200 → 偏差 ~6%, ~28%, ~56%
          recommendedValue: "3200",
          updatedAt: "2026-05-10T00:00:00.000Z"
        }])
      ),
      range: "0 - 10000"
    };
    render(<ProjectValueMatrix {...build({ parameter })} />);
    expect(screen.getByText(/\+6\.3%/)).toHaveClass("deviation-ok");
    expect(screen.getByText(/\+28\.1%/)).toHaveClass("deviation-danger");
  });
});
```

- [ ] **Step 2：运行（失败）**

Run: `npm test -- ProjectValueMatrix`

- [ ] **Step 3：实现 ProjectValueMatrix**

Create `src/components/ProjectValueMatrix.tsx`：

```tsx
import type { ParameterEditorDraft, ProjectConfig, ParameterValueDraft } from "../powerManagementConfig";
import { migrateParameterRange } from "../parameterAdminAnalytics";

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso ?? "";
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.round(hrs / 24);
  return `${days} 天前`;
}

export function ProjectValueMatrix({
  parameter,
  projects,
  onValueChange
}: {
  parameter: ParameterEditorDraft;
  projects: readonly ProjectConfig[];
  onValueChange: (projectId: string, patch: Partial<ParameterValueDraft>) => void;
}) {
  const range = migrateParameterRange(parameter.range);
  const recommended = Number(projects[0] ? parameter.values?.[projects[0].id]?.recommendedValue : NaN);

  return (
    <section className="project-value-matrix" aria-label="项目值矩阵">
      <header className="pvm-header">
        <span>项目</span>
        <span>当前值</span>
        <span>偏差</span>
        <span>更新时间</span>
      </header>
      {projects.map(project => {
        const v = parameter.values?.[project.id] ?? { currentValue: "", recommendedValue: "", updatedAt: "" };
        const numeric = Number(v.currentValue);
        const hasNumeric = Number.isFinite(numeric);
        const belowMin = range.min !== undefined && hasNumeric && numeric < range.min;
        const aboveMax = range.max !== undefined && hasNumeric && numeric > range.max;
        const outOfRange = belowMin || aboveMax;

        let devPct: number | null = null;
        if (hasNumeric && Number.isFinite(recommended) && recommended !== 0) {
          devPct = ((numeric - recommended) / recommended) * 100;
        }
        const devClass = devPct === null ? "deviation-na"
          : Math.abs(devPct) <= 10 ? "deviation-ok"
          : Math.abs(devPct) <= 25 ? "deviation-warn"
          : "deviation-danger";

        return (
          <div className={`pvm-row${outOfRange ? " out-of-range" : ""}`} key={project.id}>
            <div className="pvm-project">
              <strong>{project.code}</strong>
              <small>{project.name}</small>
            </div>
            <div className="pvm-value">
              <input
                type="number"
                inputMode="decimal"
                aria-label={`${project.code} 当前值`}
                aria-invalid={outOfRange ? "true" : "false"}
                value={v.currentValue}
                onChange={(e) => onValueChange(project.id, {
                  currentValue: e.target.value,
                  updatedAt: new Date().toISOString()
                })}
              />
              <span className="pvm-unit">{parameter.unit}</span>
              {outOfRange ? (
                <span className="pvm-error">
                  {belowMin ? `低于下限 ${range.min}` : `超过上限 ${range.max}`} · 越界
                </span>
              ) : (
                <span className="pvm-hint">推荐 {recommended || "—"}</span>
              )}
            </div>
            <div className={`pvm-deviation ${devClass}`}>
              {devPct === null ? "—" : `${devPct >= 0 ? "+" : ""}${devPct.toFixed(1)}%`}
            </div>
            <div className="pvm-updated" title={v.updatedAt}>
              <time dateTime={v.updatedAt}>{v.updatedAt ? formatRelative(v.updatedAt) : "—"}</time>
            </div>
          </div>
        );
      })}
    </section>
  );
}
```

CSS:

```css
.project-value-matrix {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-top: 1px solid var(--border);
}
.pvm-header,
.pvm-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(200px, 2fr) minmax(80px, 0.8fr) minmax(120px, 1fr);
  gap: 12px;
  align-items: center;
}
.pvm-header {
  padding: 10px 8px;
  font-size: 12px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.pvm-row {
  padding: 12px 8px;
  border-bottom: 1px solid var(--border);
}
.pvm-row.out-of-range { background: rgba(186, 26, 26, 0.06); }
.pvm-project strong { font-family: var(--font-mono, monospace); font-size: 13px; }
.pvm-project small { color: var(--text-muted); font-size: 11px; display: block; }
.pvm-value { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pvm-value input {
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  max-width: 120px;
}
.pvm-value input[aria-invalid="true"] {
  border-color: var(--status-risk-high, #ba1a1a);
  border-width: 2px;
}
.pvm-unit { color: var(--text-muted); font-size: 12px; }
.pvm-error { color: var(--status-risk-high, #ba1a1a); font-size: 11px; flex-basis: 100%; }
.pvm-hint { color: var(--text-muted); font-size: 11px; flex-basis: 100%; }
.pvm-deviation { font-weight: 600; font-size: 12px; }
.deviation-ok     { color: #047857; }
.deviation-warn   { color: #d97706; }
.deviation-danger { color: var(--status-risk-high, #ba1a1a); }
.deviation-na     { color: var(--text-muted); }
.pvm-updated time { font-size: 12px; color: var(--text-muted); }
```

- [ ] **Step 4：接入 ParameterAdminPage**

```tsx
import { ProjectValueMatrix } from "./components/ProjectValueMatrix";

// 在 detail-inner 内，ParameterDefinitionForm 之后
<ProjectValueMatrix
  parameter={selectedParameter}
  projects={projects}
  onValueChange={(projectId, patch) => dispatch({
    type: "UPDATE_PROJECT_PARAMETER_VALUE",
    projectId,
    parameterId: selectedParameter.id,
    patch
  })}
/>
```

- [ ] **Step 5：运行测试**

Run: `npm test -- ProjectValueMatrix ParameterAdminPage`
Expected: 全部 PASS。

- [ ] **Step 6：提交**

```bash
git add src/components/ProjectValueMatrix.tsx src/components/ProjectValueMatrix.test.tsx src/ParameterAdminPage.tsx src/styles.css
git commit -m "feat(parameter-admin): project value matrix with unit, deviation, range validation, read-only updatedAt"
```

---

## Task 13：DirtyIndicator + 导出 ▾ 菜单 + ExportDiffDialog + beforeunload

**目的：** 把脏态徽章、导出菜单、diff 摘要对话框和 beforeunload 守护一次性落地，形成 D8 的完整闭环。

**Files:**
- Create: `src/components/DirtyIndicator.tsx`
- Create: `src/components/DirtyIndicator.test.tsx`
- Create: `src/components/ExportDiffDialog.tsx`
- Create: `src/components/ExportDiffDialog.test.tsx`
- Create: `src/components/ExportMenu.tsx`
- Create: `src/components/ExportMenu.test.tsx`
- Modify: `src/ParameterAdminPage.tsx`
- Modify: `src/styles.css`

---

- [ ] **Step 1：DirtyIndicator 测试**

Create `src/components/DirtyIndicator.test.tsx`：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DirtyIndicator } from "./DirtyIndicator";

describe("DirtyIndicator", () => {
  it("count=0 不渲染", () => {
    const { container } = render(<DirtyIndicator count={0} onInspect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("count>0 渲染带 N 处未导出的按钮", () => {
    render(<DirtyIndicator count={3} onInspect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /3 处未导出/ })).toBeInTheDocument();
  });

  it("click 触发 onInspect", () => {
    const onInspect = vi.fn();
    render(<DirtyIndicator count={2} onInspect={onInspect} />);
    fireEvent.click(screen.getByRole("button", { name: /2 处未导出/ }));
    expect(onInspect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2：运行 + 实现**

Run: `npm test -- DirtyIndicator`

Create `src/components/DirtyIndicator.tsx`:

```tsx
export function DirtyIndicator({ count, onInspect }: { count: number; onInspect: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      className="dirty-indicator"
      onClick={onInspect}
      aria-label={`${count} 处未导出，点击查看变更摘要`}
      title={`自上次导出以来已修改 ${count} 处参数`}
    >
      <span className="dirty-dot" aria-hidden>●</span>
      <span>{count} 处未导出</span>
    </button>
  );
}
```

CSS:

```css
.dirty-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
  cursor: pointer;
}
.dirty-dot {
  color: #d97706;
  animation: dirty-pulse 1.6s ease-in-out infinite;
}
@keyframes dirty-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
@media (prefers-reduced-motion: reduce) {
  .dirty-dot { animation: none; }
}
```

Run: `npm test -- DirtyIndicator`
Expected: PASS.

- [ ] **Step 3：ExportDiffDialog 测试 + 实现**

Create `src/components/ExportDiffDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExportDiffDialog } from "./ExportDiffDialog";

const defaultDiff = {
  added: 1,
  updated: 2,
  deleted: 0,
  affectedParameters: [{ name: "new-p", kind: "added" as const }, { name: "fast_charge", kind: "updated" as const }, { name: "charge_voltage", kind: "updated" as const }]
};

describe("ExportDiffDialog", () => {
  it("展示 added/updated/deleted 计数", () => {
    render(<ExportDiffDialog open diff={defaultDiff} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/新增参数：1/)).toBeInTheDocument();
    expect(screen.getByText(/更新.*2/)).toBeInTheDocument();
    expect(screen.getByText(/删除.*0/)).toBeInTheDocument();
  });

  it("confirm 和 cancel 触发正确回调", () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    render(<ExportDiffDialog open diff={defaultDiff} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /确认导出/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Esc 关闭", () => {
    const onCancel = vi.fn();
    render(<ExportDiffDialog open diff={defaultDiff} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("open=false 不渲染", () => {
    const { container } = render(<ExportDiffDialog open={false} diff={defaultDiff} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
```

Run: `npm test -- ExportDiffDialog`.

Create `src/components/ExportDiffDialog.tsx`:

```tsx
import { useEffect } from "react";

export type ExportDiff = {
  added: number;
  updated: number;
  deleted: number;
  affectedParameters: { name: string; kind: "added" | "updated" | "deleted" }[];
};

export function ExportDiffDialog({
  open,
  diff,
  onConfirm,
  onCancel
}: {
  open: boolean;
  diff: ExportDiff;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-diff-title">
      <div className="modal export-diff-dialog">
        <header className="modal-header">
          <h2 id="export-diff-title">导出 JSON 快照</h2>
        </header>
        <div className="modal-body">
          <p>将导出的快照包含以下变更（相对上次导出）：</p>
          <ul>
            <li>＋ 新增参数：{diff.added} 项</li>
            <li>✎ 更新（元数据 / 取值）：{diff.updated} 项</li>
            <li>− 删除：{diff.deleted} 项</li>
          </ul>
          {diff.affectedParameters.length > 0 ? (
            <div className="export-diff-scroll">
              {diff.affectedParameters.map(p => (
                <div key={p.name} className={`export-diff-row kind-${p.kind}`}>
                  <span className="kind-mark">
                    {p.kind === "added" ? "＋" : p.kind === "updated" ? "✎" : "−"}
                  </span>
                  <code>{p.name}</code>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button" onClick={onCancel}>取消</button>
          <button type="button" className="button primary" onClick={onConfirm}>确认导出</button>
        </footer>
      </div>
    </div>
  );
}
```

CSS:

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: #fff;
  border-radius: 12px;
  width: min(92vw, 520px);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
}
.modal-header { padding: 16px 20px; border-bottom: 1px solid var(--border); }
.modal-header h2 { font-size: 16px; margin: 0; }
.modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.modal-footer { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; gap: 10px; justify-content: flex-end; }

.export-diff-scroll {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  margin-top: 12px;
}
.export-diff-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
.export-diff-row.kind-added    .kind-mark { color: #047857; }
.export-diff-row.kind-updated  .kind-mark { color: #d97706; }
.export-diff-row.kind-deleted  .kind-mark { color: var(--status-risk-high, #ba1a1a); }
```

Run: `npm test -- ExportDiffDialog`
Expected: PASS.

- [ ] **Step 4：ExportMenu 组件**

Create `src/components/ExportMenu.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExportMenu } from "./ExportMenu";

describe("ExportMenu", () => {
  it("click 展开三个菜单项", () => {
    render(<ExportMenu onDownload={vi.fn()} onCopy={vi.fn()} onViewDiff={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));
    expect(screen.getByRole("menuitem", { name: /下载/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /复制到剪贴板/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /查看导出/ })).toBeInTheDocument();
  });

  it("click 菜单项触发对应回调", () => {
    const onDownload = vi.fn(), onCopy = vi.fn(), onViewDiff = vi.fn();
    render(<ExportMenu onDownload={onDownload} onCopy={onCopy} onViewDiff={onViewDiff} />);
    fireEvent.click(screen.getByRole("button", { name: /导出/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /下载/ }));
    expect(onDownload).toHaveBeenCalled();
  });
});
```

Create `src/components/ExportMenu.tsx`:

```tsx
import { useState, useRef, useEffect } from "react";
import { Download } from "lucide-react";

export function ExportMenu({
  onDownload,
  onCopy,
  onViewDiff
}: {
  onDownload: () => void;
  onCopy: () => void;
  onViewDiff: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handle);
    return () => window.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div className="dropdown-root" ref={rootRef}>
      <button type="button" className="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Download size={14} aria-hidden /> 导出 JSON ▾
      </button>
      {open ? (
        <div className="dropdown-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { onDownload(); setOpen(false); }} className="dropdown-item">📥 下载 JSON 文件</button>
          <button type="button" role="menuitem" onClick={() => { onCopy(); setOpen(false); }} className="dropdown-item">📋 复制到剪贴板</button>
          <button type="button" role="menuitem" onClick={() => { onViewDiff(); setOpen(false); }} className="dropdown-item">👁 查看导出 diff</button>
        </div>
      ) : null}
    </div>
  );
}
```

Run: `npm test -- ExportMenu`
Expected: PASS.

- [ ] **Step 5：在 ParameterAdminPage 串联脏态 + 导出菜单 + diff dialog + beforeunload**

在 `ParameterAdminPage.tsx`：

```tsx
import { DirtyIndicator } from "./components/DirtyIndicator";
import { ExportMenu } from "./components/ExportMenu";
import { ExportDiffDialog, type ExportDiff } from "./components/ExportDiffDialog";
import { useBeforeUnload } from "./hooks/useBeforeUnload";
import { selectDirtyCount } from "./parameterAdminAnalytics";

const dirtyCount = selectDirtyCount(state);

useBeforeUnload(dirtyCount > 0, "有未导出的参数变更，确定离开吗？");

const [exportDialogOpen, setExportDialogOpen] = useState(false);
const [pendingExportMode, setPendingExportMode] = useState<"download" | "copy" | "preview" | null>(null);

const computeDiff = (): ExportDiff => {
  let lastDraft: any = null;
  try { lastDraft = JSON.parse(state.lastExportedSnapshot); } catch {}
  const currentIds = new Map(library.map(p => [p.id, p]));
  const lastIds = new Map<string, any>((lastDraft?.parameterLibrary ?? []).map((p: any) => [p.id, p]));
  const added: string[] = [], updated: string[] = [], deleted: string[] = [];
  for (const id of new Set([...currentIds.keys(), ...lastIds.keys()])) {
    const c = currentIds.get(id), l = lastIds.get(id);
    if (c && !l) added.push(c.name);
    else if (!c && l) deleted.push(l.name);
    else if (c && l && JSON.stringify(c) !== JSON.stringify(l)) updated.push(c.name);
  }
  return {
    added: added.length,
    updated: updated.length,
    deleted: deleted.length,
    affectedParameters: [
      ...added.map(name => ({ name, kind: "added" as const })),
      ...updated.map(name => ({ name, kind: "updated" as const })),
      ...deleted.map(name => ({ name, kind: "deleted" as const }))
    ]
  };
};

const triggerExport = (mode: "download" | "copy") => {
  const snapshotName = `params-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.json`;
  const body = JSON.stringify(state.configDraft, null, 2);
  if (mode === "download") {
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = snapshotName;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    navigator.clipboard?.writeText(body);
  }
  dispatch({ type: "MARK_EXPORTED", snapshotName, timestamp: new Date().toISOString() });
};

const onExportClick = (mode: "download" | "copy" | "preview") => {
  if (mode === "preview" || dirtyCount > 0) {
    setPendingExportMode(mode);
    setExportDialogOpen(true);
  } else {
    triggerExport(mode);
  }
};
```

在 PageHeader 动作区中替换：

```tsx
<DirtyIndicator count={dirtyCount} onInspect={() => onExportClick("preview")} />
{/* 批量导入按钮保留占位 */}
<ExportMenu
  onDownload={() => onExportClick("download")}
  onCopy={() => onExportClick("copy")}
  onViewDiff={() => onExportClick("preview")}
/>
```

在组件 return 的最外层添加 Dialog 实例：

```tsx
<ExportDiffDialog
  open={exportDialogOpen}
  diff={computeDiff()}
  onCancel={() => { setExportDialogOpen(false); setPendingExportMode(null); }}
  onConfirm={() => {
    const mode = pendingExportMode;
    setExportDialogOpen(false);
    setPendingExportMode(null);
    if (mode === "download" || mode === "copy") triggerExport(mode);
  }}
/>
```

- [ ] **Step 6：ParameterAdminPage 集成测试**

```tsx
it("编辑参数后脏态徽章出现", () => {
  const { rerender } = render(
    <ParameterAdminPage state={initialState} dispatch={vi.fn()} onNavigate={vi.fn()} search={new URLSearchParams()} />
  );
  // 初始无脏态
  expect(screen.queryByText(/未导出/)).toBeNull();

  // 构造一个 diverged state
  const dirtyState = {
    ...initialState,
    configDraft: {
      ...initialState.configDraft,
      parameterLibrary: [
        { ...initialState.configDraft.parameterLibrary[0], description: "changed" },
        ...initialState.configDraft.parameterLibrary.slice(1)
      ]
    }
  };
  rerender(<ParameterAdminPage state={dirtyState as any} dispatch={vi.fn()} onNavigate={vi.fn()} search={new URLSearchParams()} />);
  expect(screen.getByText(/1 处未导出/)).toBeInTheDocument();
});

it("导出按钮 → diff dialog → 确认执行", () => {
  const dispatch = vi.fn();
  const dirtyState = { /* 同上 dirtyState */ } as any;
  render(<ParameterAdminPage state={dirtyState} dispatch={dispatch} onNavigate={vi.fn()} search={new URLSearchParams()} />);
  fireEvent.click(screen.getByRole("button", { name: /导出 JSON/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /下载/ }));
  // Dialog 应弹出
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /确认导出/ }));
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "MARK_EXPORTED" }));
});
```

- [ ] **Step 7：运行测试**

Run: `npm test -- ParameterAdminPage DirtyIndicator ExportDiffDialog ExportMenu useBeforeUnload`
Expected: 全部 PASS。

- [ ] **Step 8：提交**

```bash
git add src/components/DirtyIndicator.tsx src/components/DirtyIndicator.test.tsx src/components/ExportDiffDialog.tsx src/components/ExportDiffDialog.test.tsx src/components/ExportMenu.tsx src/components/ExportMenu.test.tsx src/ParameterAdminPage.tsx src/ParameterAdminPage.test.tsx src/styles.css
git commit -m "feat(parameter-admin): dirty indicator, export menu, diff dialog, beforeunload guard"
```

---

## Task 14：UndoableToast 统一组件 + DeleteParameterDialog + 删除走 Confirm + Undo

**目的：** 搭起 D6 的统一破坏性动作链路。本 Task 只把"删除单个参数"的入口接通：列表行支持右键菜单删除（或详情区增加删除按钮）→ 弹 DeleteParameterDialog → 确认后执行删除 → UndoableToast 显示 10s → 可撤销。

**Files:**
- Create: `src/components/UndoableToast.tsx`
- Create: `src/components/UndoableToast.test.tsx`
- Create: `src/components/DeleteParameterDialog.tsx`
- Create: `src/components/DeleteParameterDialog.test.tsx`
- Modify: `src/ParameterAdminPage.tsx`
- Modify: `src/styles.css`

---

- [ ] **Step 1：UndoableToast 测试**

Create `src/components/UndoableToast.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UndoableToast } from "./UndoableToast";

describe("UndoableToast", () => {
  it("渲染 message + 倒计时条 + undo 按钮", () => {
    render(<UndoableToast message="已删除 X" timeout={5000} onUndo={vi.fn()} onExpire={vi.fn()} />);
    expect(screen.getByText("已删除 X")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /撤销/ })).toBeInTheDocument();
  });

  it("timeout 过后触发 onExpire", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<UndoableToast message="x" timeout={300} onUndo={vi.fn()} onExpire={onExpire} />);
    act(() => { vi.advanceTimersByTime(350); });
    expect(onExpire).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("click 撤销触发 onUndo", () => {
    const onUndo = vi.fn();
    render(<UndoableToast message="x" timeout={5000} onUndo={onUndo} onExpire={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /撤销/ }));
    expect(onUndo).toHaveBeenCalled();
  });
});
```

Create `src/components/UndoableToast.tsx`:

```tsx
import { useEffect } from "react";

export function UndoableToast({
  message,
  timeout,
  onUndo,
  onExpire
}: {
  message: string;
  timeout: number;
  onUndo: () => void;
  onExpire: () => void;
}) {
  useEffect(() => {
    const id = window.setTimeout(onExpire, timeout);
    return () => window.clearTimeout(id);
  }, [timeout, onExpire]);

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <div className="undo-toast-body">
        <span>{message}</span>
        <button type="button" className="undo-toast-action" onClick={onUndo}>撤销</button>
      </div>
      <div className="undo-toast-progress" style={{ animationDuration: `${timeout}ms` }} />
    </div>
  );
}
```

CSS:

```css
.undo-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  min-width: 280px;
  background: #111827;
  color: #f9fafb;
  border-radius: 10px;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  z-index: 200;
}
.undo-toast-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  font-size: 13px;
}
.undo-toast-action {
  background: transparent;
  color: #fbbf24;
  border: 0;
  font-weight: 600;
  cursor: pointer;
}
.undo-toast-progress {
  height: 3px;
  background: #d97706;
  width: 100%;
  animation: undo-shrink linear forwards;
  transform-origin: left;
}
@keyframes undo-shrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}
```

Run: `npm test -- UndoableToast`.

- [ ] **Step 2：DeleteParameterDialog 测试**

Create `src/components/DeleteParameterDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteParameterDialog } from "./DeleteParameterDialog";

describe("DeleteParameterDialog", () => {
  it("展示参数名 + 项目引用清单", () => {
    render(
      <DeleteParameterDialog
        open
        parameterName="fast_charge_current_limit_ma"
        usedByProjects={["AUR-Prod", "NEB-RD", "ATL-Intl"]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/fast_charge_current_limit_ma/)).toBeInTheDocument();
    expect(screen.getByText(/AUR-Prod/)).toBeInTheDocument();
    expect(screen.getByText(/NEB-RD/)).toBeInTheDocument();
  });

  it("孤儿参数显示对应文案", () => {
    render(
      <DeleteParameterDialog
        open
        parameterName="orphan_p"
        usedByProjects={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/孤儿/)).toBeInTheDocument();
  });
});
```

Create `src/components/DeleteParameterDialog.tsx`:

```tsx
import { useEffect } from "react";

export function DeleteParameterDialog({
  open,
  parameterName,
  usedByProjects,
  onConfirm,
  onCancel
}: {
  open: boolean;
  parameterName: string;
  usedByProjects: readonly string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="del-dlg-title">
      <div className="modal delete-parameter-dialog">
        <header className="modal-header">
          <h2 id="del-dlg-title">⚠ 删除参数 <code>{parameterName}</code></h2>
        </header>
        <div className="modal-body">
          {usedByProjects.length > 0 ? (
            <>
              <p>该参数被以下项目使用：</p>
              <ul className="del-projects">
                {usedByProjects.map(p => <li key={p}>{p}</li>)}
              </ul>
            </>
          ) : (
            <p>此参数目前没有任何项目使用（孤儿参数）。</p>
          )}
          <ul className="del-consequences">
            <li>所有项目的当前值与历史将丢失</li>
            <li>10 秒内可通过 Toast 撤销</li>
          </ul>
        </div>
        <footer className="modal-footer">
          <button type="button" className="button" onClick={onCancel}>取消</button>
          <button type="button" className="button danger" onClick={onConfirm}>确认删除</button>
        </footer>
      </div>
    </div>
  );
}
```

CSS（追加）：

```css
.button.danger {
  background: var(--status-risk-high, #ba1a1a);
  color: #fff;
  border-color: var(--status-risk-high, #ba1a1a);
}
.delete-parameter-dialog .del-projects { margin: 0 0 12px 16px; }
.delete-parameter-dialog .del-consequences { margin: 0 0 0 16px; color: var(--text-muted); font-size: 12px; }
```

Run: `npm test -- DeleteParameterDialog`.

- [ ] **Step 3：在 ParameterAdminPage 接入删除 + Undo 链路**

在组件内：

```tsx
import { UndoableToast } from "./components/UndoableToast";
import { DeleteParameterDialog } from "./components/DeleteParameterDialog";

const [deleteOpen, setDeleteOpen] = useState(false);
const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

const openDelete = (parameterId: string) => {
  setDeleteTargetId(parameterId);
  setDeleteOpen(true);
};

const confirmDelete = () => {
  if (!deleteTargetId) return;
  dispatch({ type: "DELETE_PROJECT_PARAMETER", parameterId: deleteTargetId });
  setDeleteOpen(false);
  setDeleteTargetId(null);
};

const projectCoverage = (parameterId: string): string[] => {
  const p = library.find(x => x.id === parameterId);
  if (!p) return [];
  return projects.filter(proj => p.values?.[proj.id]?.currentValue).map(proj => proj.code);
};

// 在详情 header 追加 [删除此参数] icon 按钮：
<button
  type="button"
  className="button ghost danger-text"
  onClick={() => openDelete(selectedParameter.id)}
  aria-label={`删除 ${selectedParameter.name}`}
>
  删除此参数
</button>
```

在组件底部：

```tsx
<DeleteParameterDialog
  open={deleteOpen}
  parameterName={library.find(p => p.id === deleteTargetId)?.name ?? ""}
  usedByProjects={deleteTargetId ? projectCoverage(deleteTargetId) : []}
  onCancel={() => { setDeleteOpen(false); setDeleteTargetId(null); }}
  onConfirm={confirmDelete}
/>

{state._undoStack ? (
  <UndoableToast
    message={state._undoStack.message}
    timeout={Math.max(
      0,
      new Date(state._undoStack.expiresAt).getTime() - Date.now()
    )}
    onUndo={() => dispatch({ type: "UNDO_LAST_DESTRUCTIVE" })}
    onExpire={() => dispatch({ type: "CLEAR_UNDO" })}
  />
) : null}
```

- [ ] **Step 4：ParameterAdminPage 集成测试**

```tsx
it("点删除按钮弹 Dialog → 确认后 dispatch DELETE + 显示 UndoToast", () => {
  const dispatch = vi.fn();
  // 先渲染列表，选中一个参数
  const state = { ...initialState };
  window.history.replaceState(null, "", `/parameter-admin?id=${state.configDraft.parameterLibrary[0].id}`);
  render(<ParameterAdminPage state={state} dispatch={dispatch} onNavigate={vi.fn()} search={new URLSearchParams(window.location.search)} />);
  fireEvent.click(screen.getByRole("button", { name: /删除 .+/ }));
  // Dialog 出现
  expect(screen.getByRole("dialog", { name: /删除参数/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "DELETE_PROJECT_PARAMETER" }));
});

it("存在 _undoStack 时显示 UndoableToast", () => {
  const undoState = {
    ...initialState,
    _undoStack: {
      id: "u1",
      actionKind: "parameter-delete",
      message: "已删除 x",
      snapshot: {},
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
      originalAuditEventId: "ae-x"
    }
  };
  render(<ParameterAdminPage state={undoState as any} dispatch={vi.fn()} onNavigate={vi.fn()} search={new URLSearchParams()} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText("已删除 x")).toBeInTheDocument();
});
```

- [ ] **Step 5：运行测试**

Run: `npm test -- UndoableToast DeleteParameterDialog ParameterAdminPage`
Expected: 全部 PASS。

- [ ] **Step 6：提交**

```bash
git add src/components/UndoableToast.tsx src/components/UndoableToast.test.tsx src/components/DeleteParameterDialog.tsx src/components/DeleteParameterDialog.test.tsx src/ParameterAdminPage.tsx src/ParameterAdminPage.test.tsx src/styles.css
git commit -m "feat(parameter-admin): delete confirmation dialog and undoable toast"
```

---

## Task 15：Agent 浮窗 prompts/actions 更新 + `scan-orphans` / `draft-cleanup` 落地

**目的：** 把 `createAgentPlan("/parameter-admin")` 分支升级到 spec §11.1；为本 m1 实现 `scan-orphans` 与 `draft-cleanup` 两个动作（`preview-import` / `summarize-audit` 因依赖 m2 的 UI 暂留 handler 占位）。

**Files:**
- Modify: `src/appConfig.ts`
- Modify: `src/appConfig.test.ts`
- Modify: `src/App.tsx`（UnifiedAgent 的 action handler 分派）
- Modify: `src/ParameterAdminPage.tsx`

---

- [ ] **Step 1：测试 `appConfig.createAgentPlan`**

在 `src/appConfig.test.ts` 追加：

```ts
describe("parameter-admin agent plan", () => {
  it("prompts 和 actions 包含四个新 id", () => {
    const plan = createAgentPlan("/parameter-admin");
    expect(plan.contextTitle).toBe("参数治理 Agent");
    const ids = plan.actions.map(a => a.id);
    expect(ids).toEqual([
      "scan-orphans",
      "preview-import",
      "summarize-audit",
      "draft-cleanup"
    ]);
    expect(plan.prompts.length).toBe(4);
  });

  it("draft-cleanup requiresConfirm", () => {
    const plan = createAgentPlan("/parameter-admin");
    expect(plan.actions.find(a => a.id === "draft-cleanup")?.requiresConfirm).toBe(true);
  });
});
```

- [ ] **Step 2：修改 `appConfig.ts`**

在 `createAgentPlan` 的 `case "parameter-admin":` 分支完整替换为：

```ts
case "parameter-admin":
  return {
    ...shared,
    contextTitle: "参数治理 Agent",
    contextSummary: "正在关注参数库健康、孤儿参数、权限异常和导入风险。",
    prompts: [
      "扫描孤儿参数",
      "预审下次导入风险",
      "汇总本周审计",
      "生成孤儿清理建议"
    ],
    actions: [
      { id: "scan-orphans",    label: "扫描孤儿参数",  requiresConfirm: false },
      { id: "preview-import",  label: "预审导入风险",  requiresConfirm: false },
      { id: "summarize-audit", label: "汇总本周审计",  requiresConfirm: false },
      { id: "draft-cleanup",   label: "生成清理建议",  requiresConfirm: true }
    ]
  };
```

- [ ] **Step 3：在 `App.tsx` 的 UnifiedAgent 动作路由中分派新动作**

找到 UnifiedAgent 里处理 `action.id` 的 switch / if 链，为 `/parameter-admin` 新增分支。推荐方式：通过一个 page-scoped `onAgentAction(actionId)` prop 传进去，`ParameterAdminPage` 内实现。

在 `App.tsx` 相关片段加：

```tsx
onAction={(actionId) => {
  // 调用当前页提供的 handler（若有）
  if (pageRefs.current?.handleAgentAction) {
    pageRefs.current.handleAgentAction(actionId);
    return;
  }
  // 回退到原有 handler
  // ... existing code
}}
```

（若现有架构不便接入，可在 Agent 组件内硬编码判断 `currentPath === "/parameter-admin"` 后直接 dispatch 系统级 action，例如 dispatch AGENT_ACTION_EXECUTED，再由页面侧 useEffect 监听 aiFlaggedImportIds / 等字段来反应）

更简单的做法：不动 UnifiedAgent，而是在 `ParameterAdminPage` 内用 `useEffect` 监听全局事件。但架构上最干净仍是通过 props 传入 handler。建议本 Task 采用 **"让 UnifiedAgent 暴露一个当前页可注册的 handler"**：使用 `useRef` + `useImperativeHandle` 或简单的 context provider（`AgentActionContext`）。

实现参考：

Create `src/AgentActionContext.ts`：

```ts
import { createContext, useContext } from "react";

export type AgentActionHandler = (actionId: string) => void;
export const AgentActionContext = createContext<AgentActionHandler | null>(null);
export const useAgentAction = () => useContext(AgentActionContext);
```

在 `App.tsx`：

```tsx
const [agentHandler, setAgentHandler] = useState<AgentActionHandler | null>(null);
// 在 main 包裹 context provider：
<AgentActionContext.Provider value={agentHandler}>
  {renderPage({ state, dispatch, onNavigate, search, setAgentHandler })}
</AgentActionContext.Provider>
// UnifiedAgent 读 context 调用 handler；fallback 到原逻辑
```

- [ ] **Step 4：ParameterAdminPage 注册 handler**

```tsx
import { useLayoutEffect } from "react";

useLayoutEffect(() => {
  props.setAgentHandler?.((actionId: string) => {
    switch (actionId) {
      case "scan-orphans": {
        updateSearch({ coverage: "orphan" });
        dispatch({ type: "AGENT_ACTION_EXECUTED", actionId, metadata: { orphanCount: orphanCount } });
        break;
      }
      case "draft-cleanup": {
        updateSearch({ coverage: "orphan" });
        dispatch({ type: "AGENT_ACTION_EXECUTED", actionId, metadata: { orphanIds: library.filter(p => getCoverage(p, projects) === "orphan").map(p => p.id) } });
        // m2 里这里会自动勾选这些行 + 浮出 BulkActionBar
        break;
      }
      case "preview-import":
      case "summarize-audit":
      default: {
        console.info(`[Agent m2 pending] ${actionId}`);
        dispatch({ type: "AGENT_ACTION_EXECUTED", actionId });
      }
    }
  });
  return () => props.setAgentHandler?.(null);
}, [orphanCount]);
```

- [ ] **Step 5：运行测试**

Run: `npm test -- appConfig`
Expected: PASS。

Run: `npm test`
Expected: 全部 PASS（若 App 层 handler 注入测试需要配合 mock context，按需小范围改 App.test.tsx）。

- [ ] **Step 6：提交**

```bash
git add src/appConfig.ts src/appConfig.test.ts src/App.tsx src/ParameterAdminPage.tsx src/AgentActionContext.ts
git commit -m "feat(parameter-admin): upgrade agent plan and wire scan-orphans / draft-cleanup"
```

---


## Task 16：空态、错误态与 Tab 键盘基线

**目的：** 把 spec §22-§23 里本 m1 覆盖的空态/错误态一次性补齐；验证主链路上 Tab 键盘流顺畅 + `Esc` 关所有 Dialog。本 m1 不做全量快捷键，只守 Tab 可达和 Esc 关闭。

**Files:**
- Modify: `src/components/ParameterLibraryList.tsx`
- Modify: `src/ParameterAdminPage.tsx`
- Create: `src/ParameterAdminPage.a11y.test.tsx`
- Modify: `src/styles.css`

---

- [ ] **Step 1：空态补齐**

在 `ParameterAdminPage.tsx` detail-column 部分，当 `library.length === 0`：

```tsx
{library.length === 0 ? (
  <div className="detail-empty">
    <p>还没有任何参数。从下方开始 →</p>
    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
      <button type="button" className="button primary" onClick={() => dispatch({ type: "ADD_PROJECT_PARAMETER" })}>
        新增参数
      </button>
      <button type="button" className="button" onClick={() => console.info("m2: import")}>批量导入</button>
    </div>
  </div>
) : /* …existing rendering… */}
```

孤儿视角无结果：在 `ParameterLibraryList` 内 `filtered.length === 0` 且 `search.coverage === "orphan"` 时文案改为：

```tsx
<p>🎉 所有参数都被项目使用中 · 没有孤儿</p>
```

未选中参数的详情区文案已在 Task 11 实现（"选择一个参数查看定义与项目值"）。

- [ ] **Step 2：Tab 键盘流测试**

Create `src/ParameterAdminPage.a11y.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParameterAdminPage } from "./ParameterAdminPage";
import { initialState } from "./mockData";
import userEvent from "@testing-library/user-event";

describe("ParameterAdminPage · a11y", () => {
  it("Tab 从搜索 → 风险 chip → 模块下拉 → 覆盖下拉 → 排序 按序可达", async () => {
    const user = userEvent.setup();
    render(<ParameterAdminPage state={initialState} dispatch={() => {}} onNavigate={() => {}} search={new URLSearchParams()} />);
    const search = screen.getByRole("searchbox");
    await user.click(search);
    await user.tab();
    // 下一个焦点应为风险全部 chip 或模块下拉（取决于具体 DOM 顺序）
    const focused = document.activeElement;
    expect(focused).not.toBeNull();
    expect(focused?.tagName).toBeOneOf(["BUTTON", "SELECT", "INPUT"]);
  });

  it("风险 chip 激活状态可通过 aria-pressed 反向读取", () => {
    window.history.replaceState(null, "", "/parameter-admin?risk=high");
    render(<ParameterAdminPage state={initialState} dispatch={() => {}} onNavigate={() => {}} search={new URLSearchParams("risk=high")} />);
    const highChip = screen.getByRole("button", { name: "高", pressed: true });
    expect(highChip).toBeInTheDocument();
    window.history.replaceState(null, "", "/parameter-admin");
  });
});
```

> `toBeOneOf` 如不存在，改为 `expect(["BUTTON","SELECT","INPUT"]).toContain(focused?.tagName)`。

- [ ] **Step 3：运行 a11y 测试**

Run: `npm test -- ParameterAdminPage.a11y`
Expected: PASS（若焦点顺序断言不命中，按实际 DOM 顺序调整断言，但 Tab 必须能从搜索向后走到 chips）。

- [ ] **Step 4：焦点可见样式守护**

在 `src/styles.css` 追加或确认：

```css
.param-admin-shell :focus-visible,
.param-admin-shell button:focus-visible,
.param-admin-shell input:focus-visible,
.param-admin-shell select:focus-visible,
.param-admin-shell [role="option"]:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}
```

- [ ] **Step 5：提交**

```bash
git add src/ParameterAdminPage.tsx src/components/ParameterLibraryList.tsx src/ParameterAdminPage.a11y.test.tsx src/styles.css
git commit -m "feat(parameter-admin): empty states and keyboard focus baseline"
```

---

## Task 17：视觉 QA 截图 + 文档段落 + 最终回归

**目的：** 把 spec §26 列出的关键视觉截图生成到 `qa-screenshots/`；README 补一段"参数管理后台（redesigned）"说明；最终 `npm test` + `npm run build` 全绿。

**Files:**
- Modify: `README.md`
- 新增：`qa-screenshots/parameter-admin-*.png` 5-6 张

---

- [ ] **Step 1：启动 dev 服务并截图**

Run: `npm run dev`
手动或用 Playwright MCP 生成以下截图（如果 MCP 可用）：

- `qa-screenshots/parameter-admin-1440-default.png` — 桌面默认（列表 + 详情 + 抽屉收起）
- `qa-screenshots/parameter-admin-1440-audit-open.png` — 审计按钮点开（抽屉占位空）
- `qa-screenshots/parameter-admin-1280.png` — 1280 下自适应
- `qa-screenshots/parameter-admin-orphan-filter.png` — 孤儿视角
- `qa-screenshots/parameter-admin-delete-confirm.png` — DeleteParameterDialog
- `qa-screenshots/parameter-admin-export-diff.png` — ExportDiffDialog
- `qa-screenshots/parameter-admin-undo-toast.png` — Undo Toast

如果 Playwright MCP 不在当前环境可用，手动用浏览器开发者工具截图即可（命名一致）。

- [ ] **Step 2：更新 README**

在 `README.md` 的"项目结构"部分追加段落：

```markdown
### 项目参数管理后台（/parameter-admin）

管理员专用工作台：

- **参数库治理**：搜索、风险 / 模块 / 覆盖多维过滤、按模块分组折叠、URL 可分享。
- **"孤儿参数"视角**：列出未被任何项目使用的参数，便于清理。
- **共享定义表单**：`RiskPicker` 色标、`推荐值 ⓘ 对所有项目生效` 提示、范围 min/max 拆分、参数名 snake_case + 重名校验。
- **项目值矩阵**：单位就近 suffix、越界红边、偏差百分比色标、**只读 `updatedAt`** 自动更新。
- **脏态徽章 + 导出 ▾**：`[● N 处未导出]` 按需出现；导出时弹 diff 摘要对话框；`beforeunload` 守护意外关标签页。
- **删除二次确认 + 10s Undo Toast**：统一 `UndoableToast` 通道。
- **Agent 联动**：`扫描孤儿参数` / `生成清理建议` 已接通；`预审导入风险` / `汇总本周审计` 占位（等 m2 审计抽屉与导入向导）。
- **数据契约新增**：`User[]` 8 人、`AuditEvent.kind` 13 档、`UndoEntry` 单条栈、`Role.capabilities` 四档能力。
```

- [ ] **Step 3：全量回归**

Run: `npm test`
Expected: 全部 PASS。

Run: `npm run build`
Expected: 无 TS 错误。

- [ ] **Step 4：走一遍 spec §27 演示脚本（前 6 步）**

在浏览器里手动确认：

1. 进入 `/parameter-admin` → KPI Strip + Insight 显示正常
2. 点 Insight `[查看孤儿参数]` → 列表切到孤儿视角
3. （m1 略过权限 Modal 部分，演示到参数编辑）
4. 清除筛选 → 选中一条参数
5. 改推荐值 → 顶部出现 `[● 1 处未导出]`
6. 点 `[导出 JSON ▾]` → 选下载 → diff 预览对话框 → 确认 → 脏态清零 + 浏览器下载
7. 刷新前看到 beforeunload 警告（若此时仍有脏态；上一步导出后脏态已清则跳过）

- [ ] **Step 5：提交**

```bash
git add README.md qa-screenshots/parameter-admin-*.png
git commit -m "docs(parameter-admin): README section and QA screenshots"
```

---

## M1 验收清单（与 Goal 对齐）

完成全部 Task 后，确认：

- [ ] `npm test` 全绿（含新增所有 `*.test.ts(x)`）
- [ ] `npm run build` 通过，无 TS 错误
- [ ] `/parameter-admin` 首屏 Topbar 不重复标题；内容区 H1 只有 1 个
- [ ] KPI Strip 5 项紧凑单行，无黑色装饰进度条；其中 4 项可点，点击跳转正确的 URL 参数
- [ ] 编辑任一字段后，脏态徽章 `[● N 处未导出]` 出现；N 随变更数变化；`beforeunload` 拦截关闭
- [ ] `导出 ▾` 菜单有 3 项；导出有脏态时先弹 diff 摘要 dialog；确认后下载 + 脏态清零 + 审计 +1 条
- [ ] 列表搜索 / 风险 chip / 模块多选 / 覆盖下拉（含孤儿）全部可用；URL 同步；分组折叠可用且 sessionStorage 持久
- [ ] 列表至少 4 种排序（更新时间 ↓ / 名称 A-Z / 风险 ↓）
- [ ] 筛选活跃时有 `清除筛选` 按钮
- [ ] 共享定义表单 RiskPicker 三档色标可键盘切换；推荐值标签含 `ⓘ 对所有项目生效` 文案
- [ ] 参数名 snake_case 违规时有 inline 错误；重名检测生效
- [ ] 范围被拆成 min/max 两个数值输入
- [ ] 项目值矩阵：输入框右侧显示单位；越界红边 + `aria-invalid`；偏差列按 ≤10/≤25/>25 三档色标；更新时间只读自动刷新
- [ ] 删除参数：有 `删除此参数` 按钮 → 弹 Dialog → 确认后 dispatch + `UndoableToast` 10s 内可撤销
- [ ] Undo 后审计追加 `rollback-undo` 事件
- [ ] `useParamAdminSearch` 支持 `?q=&risk=&module=&coverage=&sort=&id=&audit=open` 完整解析 + 写回
- [ ] Agent 浮窗 prompts/actions 升级；`扫描孤儿参数` / `生成清理建议` 按钮点击即刻生效；另外两个占位 log
- [ ] 至少 6 张 QA 截图入 `qa-screenshots/`
- [ ] `README.md` 有新段落说明 `/parameter-admin` 能力

---

## 风险与兜底

| 风险 | 影响 Task | 兜底 |
|---|---|---|
| 从 `App.tsx` 抽出 `ParameterAdminPage` 时，因内部 helper 未 export 导致复制代码量膨胀 | Task 4 | Step 3 说明：临时把 helper 一并拷贝到新文件并标 `// TODO(m2-refactor)`；m2 专门做一次 Admin scaffolding 抽取 |
| `DELETE_PROJECT_PARAMETER` 改为产生 undo entry 后，既有 `App.test.tsx` 删除断言失败 | Task 2 | 按新契约更新旧测试：断言 `_undoStack` 非 null + 多一条 parameter-delete 审计；必要时把旧断言拆成两条 |
| `mockDataFingerprint` 因 JSON 结构变化失败 | Task 0 | 把断言从硬编码字符串改为正则形状匹配 |
| `useParamAdminSearch` 多实例时，pushState 过于频繁可能触发 React 警告 | Task 3 | useRef 保护 + 仅在真实 diff 时 pushState；必要时加 debounce |
| shadcn 相关 UI（`Dialog` / `DropdownMenu` / `Sonner`）未引入 | 所有 Dialog Task | 本 m1 使用原生 `<div role="dialog">` + 自制 `.modal-backdrop`；m2 再统一替换 |
| `AgentInsightBar` 与 debugging m1 版本差异 | Task 7 | 本 m1 里创建最简 `AgentInsightBar` 复用路径；debugging m1 合入时做 shared 抽取（放到 `src/components/AgentInsightBar.tsx`），两边共用 |
| `beforeunload` 在测试环境触发浏览器 alert 可能导致 jsdom 警告 | Task 13 | 测试里用 `vi.spyOn(window, "addEventListener")` 仅断言监听注册，不真正触发 |
| 列表 URL 同步和 reducer 共存可能产生双真相源 | Task 3 + 所有列表 Task | 原则：UI 状态走 URL；业务数据走 reducer；组件读 URL 写 URL，不把 UI 状态存到 reducer |
| mock `parameterLibrary` 中没有 `legacy-param-x` 等旧 id 导致演示审计事件引用无效 id | Task 0 Step 9 | 接受"审计里引用的参数已被删"叙事；在 Audit UI 中（m2）对无效 id 禁用反向跳转按钮 |
| `migrateParameterRange` 对 "2500mA - 4500mA" 之类带单位的字符串解析失败 | Task 1 | 派生函数里已有带单位的兜底（extractNumeric）；若仍失败，UI 显示 `⚠ 范围格式需迁移`（raw 字段保留） |

---

## 下一步（m2 计划）

M1 完成后，顺势进入 m2 plan（同 worktree，同分支），覆盖：

- 审计抽屉完整 UI（视角 chip / 反向跳转 / 批次展开 / Modal 转换）
- 权限 Modal + AddUserDialog + 审计联动
- 批量导入向导（Step 1-3 + diff 预览 + batchId）
- 多选模式 + BulkActionBar + `BULK_* / BATCH_IMPORT_*` reducer
- 键盘快捷键齐全 + `?` 帮助
- ≤1280 审计抽屉变 Modal / ≤1024 列表变抽屉 / <768 子路由
- AgentInsightBar 次级 Insight（权限异常）
- Agent `preview-import` / `summarize-audit` 接入
- shadcn `Dialog` / `DropdownMenu` / `Sonner` 统一替换自制组件

m2 plan 文件：`docs/superpowers/plans/2026-05-10-parameter-admin-redesign-m2.md`（M1 合入 main 之后再起草）。

---

## 参考

- Spec: `docs/superpowers/specs/2026-05-10-parameter-admin-redesign-design.md`
- 评测记录：对话上文对 `/parameter-admin` 的 17 条问题
- 姊妹 m1 plan: `docs/superpowers/plans/2026-05-10-debugging-workbench-redesign-m1.md`、`docs/superpowers/plans/2026-05-10-parameter-review-workbench-redesign-m1.md`
- PRD: `PRD.md` §5.3
