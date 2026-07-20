# DTS 参数工作台模块化纠偏 — 执行计划

> 日期：2026-07-20  
> 设计：[`docs/superpowers/specs/2026-07-20-dts-workbench-module-refocus-design.md`](../../superpowers/specs/2026-07-20-dts-workbench-module-refocus-design.md)  
> 状态：阶段一 review 修复完成（方案 B 已落地）；阶段二语义下沉已提交（Task 1–7），Task 8 文档/验证收口

## Documentation Impact Matrix

| 文档 | 影响 | 状态 |
|------|------|------|
| `docs/FRONTEND.md` | 模块优先 IA、注册表、导出 | 已更新 |
| `docs/zh-CN/frontend.md` | 同上（中文） | 已更新 |
| `docs/superpowers/specs/2026-07-20-dts-workbench-module-refocus-design.md` | 设计文档 | 已写 |
| `docs/zh-CN/superpowers/specs/2026-07-20-dts-workbench-module-refocus-design.md` | 中文设计摘要 | 已有 |
| `docs/superpowers/specs/2026-07-20-dts-workbench-module-phase2-design.md` | 阶段二设计 | 已写 |
| `docs/zh-CN/superpowers/specs/2026-07-20-dts-workbench-module-phase2-design.md` | 阶段二中文摘要 | 已写 |
| OpenAPI / contract | `/api/v2/parameter-modules`（registry + mappings）；模块 CRUD 仍走 v1；阶段二新增 binding history/compare/recompute | 已更新（OpenAPI 已含 history/compare；`api-contract.md` 补 v2 binding 段） |

## Documentation Update Gate

阻断项（计划移入 `completed/` 前）：Documentation Impact Matrix 中每个 Update/Review 行都已更新或记录为“未变更 + 证据”，并执行 `npm run docs:check`。

- [x] `docs/FRONTEND.md` / `docs/zh-CN/frontend.md`：新增阶段二「绑定模块身份、历史与跨项目对比」段（moduleId 真相源、history/compare/recompute 路由）
- [x] `docs/design-docs/api-contract.md`：补 `/api/v2` binding history/compare 与 `parameter-modules/recompute-bindings`
- [x] OpenAPI：`docs/generated/openapi.json` 已含 binding history/compare 路由（由 Task 6/7 生成，`contract:check` 通过）
- [x] 本执行计划阶段二 checkbox 勾选
- [x] `npm run docs:check` 通过

## 阶段一进度

- [x] M1 additive 模块注册表（迁移 `0066` + mappings 面 + port/HTTP；模块 CRUD 复用 v1）
- [x] M2 `moduleId/moduleName/importance/moduleSortOrder` 派生 + `buildModuleTree`
- [x] M3 模块优先导航 + 技术视图开关
- [x] M4 精简列 + 排序
- [x] M5 重要性筛选 + 草稿多选（已接入选择性提交）
- [x] M6 语义导出；详情历史/跨项目对比占位
- [x] M7 管理后台 `ParameterModuleMappingPanel`
- [x] 窄测 + `npm run build`

## 方案决策（架构选型，2026-07-20）

**结论：采用方案 B —— 复用 v1 `parameter_modules` 作为唯一"业务模块"概念，仅 additive 增量。放弃方案 A（独立新表）。**

### 落地步骤（已执行）

1. [x] 回退错误迁移：删除 `0064` / `0065`
2. [x] 单支 additive 迁移 `0066_parameter_module_mappings.sql`（`importance` + `parameter_module_mappings`，priority 0–999）
3. [x] 后端收敛：v2 = registry 读 + mappings CRUD；模块 CRUD 复用 v1（含 `importance`）
4. [x] 端口/客户端：模块 CRUD → v1；mappings/registry → v2
5. [x] 派生：mapping(instance>compatible>driver) → 可选 `declaredModuleId` → driver 兜底；rank 元组比较
6. [x] `buildModuleTree` 尊重 `moduleSortOrder`
7. [x] F7/F10/F11 随 v1 复用消解

## 阶段一 Review 待办

### 阻断级

- [x] **B0** 表名冲突 — 按方案 B 收敛

### 需要修复

- [x] **F1** 多选草稿接入选择性提交
- [x] **F2** 未映射队列接线（规格 `driverModule` → `observedDrivers`）
- [x] **F3** `canAdmin` 真实权限（`admin.access`）
- [x] **F4** 模块树尊重 `sortOrder`
- [x] **F9** 导航切换清选中态

### 建议修复

- [x] **F5** 迁移按方案 B 重做（`0066`）
- [x] **F6** rank 不可越级
- [x] **F7** 唯一冲突 — 随 v1 消解
- [x] **F8** CSV 公式注入防护
- [x] **F10** 环路守卫 — 随 v1 消解
- [x] **F11** 删除校验 — 随 v1 消解

### 占位 / 观察

- [x] **P1** history/compare 占位文案保留
- [x] **P2** 映射按钮回显目标模块名
- [x] **P3** `0066` 迁移不变量测试

### 收口验证

- [x] `npm run test:server`（parameter-modules / migrationInvariant / parameterModuleRepository / routes）
- [x] 前端窄测（moduleRegistry / buildModuleTree / export / draft tray / workbench / detail）
- [x] `npm run build`
- [x] 浏览器验证（1440×900 / 768×1024 / 390×844）
  - URL：`http://127.0.0.1:5173/parameters`、`/parameter-admin`
  - 交互：模块导航 ↔ 技术视图切换；管理后台「模块映射管理」可见（v1 模块列表 + 未映射队列文案）
  - 截图：`work/ui-checks/review-fix-desktop.png` / `review-fix-tablet.png` / `review-fix-mobile.png` / `review-fix-admin.png`
  - console error：无（仅既有 warnings）
  - registry API：`GET /api/v2/parameter-modules` → 200

## 阶段二（语义下沉 — 设计已批准）

> 设计：[英文](../../superpowers/specs/2026-07-20-dts-workbench-module-phase2-design.md) · [中文](../../zh-CN/superpowers/specs/2026-07-20-dts-workbench-module-phase2-design.md)  
> 实施计划：[英文](../../superpowers/plans/2026-07-20-dts-workbench-module-phase2.md) · [中文](../../zh-CN/superpowers/plans/2026-07-20-dts-workbench-module-phase2.md)  
> 原则：**干净切换、无兼容层**；分段切片交付。

- [x] Slice 1：binding 物化 `module_id` + 新唯一键 `(project, logical_node, parameter_spec, module_id)` + 重写种子（Task 1/2/4，迁移 `0067`）
- [x] Slice 2：映射变更显式重算；DB `moduleId` 为工作台真相源（Task 3/5，`POST /api/v2/parameter-modules/recompute-bindings`）
- [x] Slice 3：binding history 真实 API → 详情接线（Task 6，`GET /api/v2/projects/:projectId/bindings/:bindingId/history`）
- [x] Slice 4：跨项目 compare 真实 API → 详情接线（Task 7，`GET /api/v2/projects/:projectId/bindings/:bindingId/compare`）
- [x] 文档 / 窄测 / build / 浏览器验证（Task 8；详见任务报告与 `work/ui-checks/phase2-*.png`）

> **工作树说明（Task 8）：** 阶段一模块优先导航（`业务模块树` / `技术视图` / `所属模块` 列）仍为未提交改动；HEAD 上不存在该 UI。阶段二能力（moduleId、history、compare、recompute）已提交并可在 HEAD 独立验证。e2e 断言（详情历史区非占位）已在工作树补齐，但因与未提交的阶段一导航耦合，单独提交会使验收套件在 HEAD 变红，故与阶段一改动一并保留待提交，不随本任务的文档提交。
