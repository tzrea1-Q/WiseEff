# DTS 解析止血（P0）Implementation Plan

> **For agentic workers:** 逐任务执行，每任务遵循「写失败测试 → 运行(FAIL) → 实现 → 运行(PASS) → 提交」。仅在特性分支提交，不开/合 PR。
>
> 隶属主计划：[DTS 参数管理结构化重构 · 主计划](2026-07-14-dts-management-program.md)。问题背景见[现状评估](../../design-docs/2026-07-14-dts-parameter-management-assessment.md)。

**Goal:** 让现有 DTS 解析与回写「诚实」：(1) 剥离注释，杜绝注释文本被当成参数（真修）；(2) 对当前解析器无法忠实表达的构造**检测并拦截/告警**，不再静默产出错误数据；(3) 回写遇到多行值/多 `<>` 组/带地址节点等无法安全定位的场景时**安全失败**（抛错）而非损坏文件；(4) `/include/` 文件**显式拒绝**。

**Architecture:** 不改数据库 schema。新增两个纯函数模块（注释剥离、不支持构造检测）到 `server/modules/parameter-files/`，在 `buildDtsParsedIndex` 前置剥注释，在 `uploadProjectParameterFile` 检测构造并据此拒绝/跳过同步，在 `patchDtsProperty` 增加安全护栏。前端 `parseDtsFragment` 同步剥注释。

**Tech Stack:** Node/tsx, Vitest, 现有 `server/modules/parameter-files/`，前端 `src/application/parameters/import/`。

**Scope:** **仅止血**，不引入真解析器/结构化模型（那是 P1）。不新增数据库表。

**Branch:** `feat/dts-parser-safety`（从最新 `main` 拉出）。

---

## File Map

| File | Responsibility |
| --- | --- |
| `server/modules/parameter-files/preprocess.ts` | `stripDtsComments(source)`：剥离 `/* */` 与 `//`，保留字符串字面量内内容 |
| `server/modules/parameter-files/preprocess.test.ts` | 注释剥离单测 |
| `server/modules/parameter-files/unsupported.ts` | `detectUnsupportedDtsConstructs(source)`：返回结构化告警列表 |
| `server/modules/parameter-files/unsupported.test.ts` | 检测单测 |
| `server/modules/parameter-files/parseIndex.ts` | `buildDtsParsedIndex` 前置剥注释 |
| `server/modules/parameter-files/service.ts` | 上传时检测构造：`/include/` 硬拒绝；其他不支持构造 → 跳过 sync + 返回 warnings |
| `server/modules/parameter-files/types.ts` | `UploadResult` 增加 `unsupportedConstructs?` |
| `server/modules/parameter-files/schemas.ts` | 上传响应含 warnings（若路由输出经 schema） |
| `server/modules/parameter-files/routes.ts` | 上传响应回传 warnings |
| `server/modules/parameter-files/writebackService.ts` | `patchDtsProperty` 增加安全护栏（多行/多组/带地址节点 → 抛错） |
| `server/modules/parameter-files/writebackService.test.ts` | 护栏单测 |
| `server/modules/parameter-files/parserSafety.integration.test.ts` | 用教学范例 fixture 端到端断言 |
| `server/modules/parameter-files/__fixtures__/dts-teaching-sample.dts` | 31 类格式教学范例（作为共享 fixture/spec） |
| `src/application/parameters/import/parseDtsFragment.ts` | 前置剥注释，避免导入向导产幻影行 |
| `src/application/parameters/import/parseDtsFragment.test.ts` | 注释不产行的断言 |

---

## Git & PR Workflow

- Branch: `feat/dts-parser-safety` from latest `main`。
- 开发智能体：仅在特性分支提交；**不**开/合 PR。
- 架构师：评审、验证（`npm run test:server`、targeted `npm test`、`npm run build`、`npm run docs:check`）、开 PR、合并、同步 `main`。

---

## Task 0: 落地共享 fixture（教学范例）

**Files:** `server/modules/parameter-files/__fixtures__/dts-teaching-sample.dts`（**架构师已创建，存在于工作区**）

- [x] **Step 1:** 确认该 fixture 文件已存在（覆盖 `/include/`、`@address`、`&label`、内联 `label:name`、布尔属性、多 `<>` 组、多行矩阵、`/bits/`、注释等 31 类构造）。**不要修改其内容**——它是 P0/P1 全期的正确性基准。若不存在则停止并上报架构师。
- [x] **Step 2:** 在你的特性分支首个提交中把它纳入版本控制。

```bash
git add server/modules/parameter-files/__fixtures__/dts-teaching-sample.dts
git commit -m "test(parameters): add DTS 31-format teaching sample fixture"
```

---

## Task 1: DTS 注释剥离

**Files:** Create `preprocess.ts` + `preprocess.test.ts`；Modify `parseIndex.ts`

- [x] **Step 1: 写失败测试**

```typescript
// preprocess.test.ts
import { describe, expect, it } from "vitest";
import { stripDtsComments } from "./preprocess";

describe("stripDtsComments", () => {
  it("removes block and line comments", () => {
    const src = `a = <1>; /* b = <2>; */ c = <3>; // d = <4>;\n e = <5>;`;
    const out = stripDtsComments(src);
    expect(out).toContain("a = <1>;");
    expect(out).toContain("c = <3>;");
    expect(out).toContain("e = <5>;");
    expect(out).not.toContain("b = <2>");
    expect(out).not.toContain("d = <4>");
  });

  it("keeps comment-like text inside string literals", () => {
    const src = `path = "a/*not-comment*/b"; note = "http://x"; end = <1>;`;
    const out = stripDtsComments(src);
    expect(out).toContain(`"a/*not-comment*/b"`);
    expect(out).toContain(`"http://x"`);
  });
});
```

- [x] **Step 2: 运行 — FAIL**

`npm run test:server -- server/modules/parameter-files/preprocess.test.ts --run`

- [x] **Step 3: 实现 `stripDtsComments`**

契约：单趟字符扫描；跟踪是否在 `"` 字符串内（尊重 `\` 转义）；在字符串外遇 `/*` 跳到 `*/`，遇 `//` 跳到行尾；用等长空格或换行替换被删区（保持后续行号大致稳定，便于未来 `line` 元数据）。不处理 `/dts-v1/`、`/plugin/`、`/include/`、`/bits/` 这类以 `/` 开头但非注释的 token（只有 `/*` 和 `//` 才是注释）。

- [x] **Step 4: 接入 `buildDtsParsedIndex`**

在 `parseIndex.ts` 的 `buildDtsParsedIndex` 开头对 source 先 `stripDtsComments` 再解析。

- [x] **Step 5: 运行 — PASS**，提交

```bash
git commit -m "fix(parameters): strip DTS comments before parsing"
```

---

## Task 2: 不支持构造检测

**Files:** Create `unsupported.ts` + `unsupported.test.ts`

- [x] **Step 1: 写失败测试**（对 `__fixtures__/dts-teaching-sample.dts` 断言）

```typescript
// unsupported.test.ts —— 断言至少检出以下 code：
//   "include"            (/include/)
//   "unit-address-node"  (name@addr {)
//   "overlay-ref"        (&label {)
//   "inline-label"       (label:name {)
//   "boolean-property"   (identifier ;  无 =)
//   "multi-cell-group"   (<..>,<..>)
```

每条告警形如 `{ code, message, sample }`（sample 为命中片段，便于 UI 展示）。

- [x] **Step 2: 运行 — FAIL**

- [x] **Step 3: 实现 `detectUnsupportedDtsConstructs(source: string)`**

先 `stripDtsComments`，再用行/词法扫描检出上述 6 类构造。返回去重后的告警数组（同 code 合并、保留首个 sample）。**只做检测，不修复**。

- [x] **Step 4: 运行 — PASS**，提交

```bash
git commit -m "feat(parameters): detect unsupported DTS constructs"
```

---

## Task 3: 上传护栏（拒绝 include / 不支持构造跳过同步）

**Files:** Modify `service.ts`, `types.ts`, `routes.ts`, `schemas.ts`；Test 复用 `service.test.ts`

- [x] **Step 1: 写失败测试**

- 上传含 `/include/` 的 `.dts` → 抛 `VALIDATION_FAILED`（code 含 `dts-include-unsupported`），不落库、不建版本。
- 上传含 `@address`/`&label` 等不支持构造（但无 include）的 `.dts` → **正常落库建版本**，但 **不触发 `syncFileVersion`**，返回结果含非空 `unsupportedConstructs`。
- 上传「干净」的简单 `.dts`/JSON → 行为不变（照常 sync）。

- [x] **Step 2: 运行 — FAIL**

- [x] **Step 3: 实现**

在 `uploadProjectParameterFile`（`service.ts`）中，`format === "dts"` 时：
1. `const findings = detectUnsupportedDtsConstructs(source)`。
2. 若 findings 含 `code === "include"` → 抛 `new ApiError("VALIDATION_FAILED", "DTS /include/ 暂不支持，请提供展开后的文件。", 400, { code: "dts-include-unsupported" })`（在落库前）。
3. 若 findings 非空（无 include）：**跳过** `syncFileVersion` 调用（`if (version.origin === "upload" && findings.length === 0) await syncFileVersion(...)`），并在返回值加入 `unsupportedConstructs: findings`。
4. findings 为空：维持现有 sync 行为。

`types.ts` 的上传结果类型增加 `unsupportedConstructs?: UnsupportedConstruct[]`；`routes.ts` 上传响应回传该字段（若响应经 zod schema，`schemas.ts` 增补可选字段）。

- [x] **Step 4: 运行 — PASS**，提交

```bash
git commit -m "feat(parameters): reject DTS include and skip sync on unsupported constructs"
```

---

## Task 4: 回写安全护栏

**Files:** Modify `writebackService.ts`；Create/extend `writebackService.test.ts`

- [x] **Step 1: 写失败测试**

- 现有属性值为多行（含换行，如多行矩阵）→ `patchDtsProperty` 抛 `CONFLICT`（code `dts-writeback-unsafe`），不返回被截断/损坏的 buffer。
- 新值或旧值为多 `<>` 组（`<..>,<..>`）→ 抛 `CONFLICT`。
- `nodePath` 含带地址段（如 `chip@6E/reg`，段内含 `@`）→ 抛 `CONFLICT`（当前无法安全定位）。
- 单行、单值、可定位的属性 → 行为不变（回写成功）。

- [x] **Step 2: 运行 — FAIL**

- [x] **Step 3: 实现护栏**

在 `patchDtsProperty` 定位到 `blockContent` / 目标属性后、执行替换前：
- 若 `nodePath` 任一段含 `@` → 抛 `CONFLICT`（"带地址节点回写需 P1 结构化支持"）。
- 若匹配到的旧值跨行，或旧值/新值匹配 `>\s*,\s*<`（多组）→ 抛 `CONFLICT`。
- 其余维持现有正则替换。

保证：**永不写出可能损坏的部分替换**。

- [x] **Step 4: 运行 — PASS**，提交

```bash
git commit -m "fix(parameters): guard DTS writeback against multiline/multi-group/addressed nodes"
```

---

## Task 5: 前端导入解析剥注释

**Files:** Modify `src/application/parameters/import/parseDtsFragment.ts` + test

- [x] **Step 1: 写失败测试** — 含注释的 DTS 片段（注释内有 `x = <9>;`）解析后**不产生** `x` 行。
- [x] **Step 2: 实现** — 复用等价的剥注释逻辑（可在前端 import 目录新增 `stripDtsComments`，或提取共享；P0 允许各自一份小实现，P1 统一）。
- [x] **Step 3: 运行 — PASS**：`npm test -- src/application/parameters/import/parseDtsFragment.test.ts --run`，提交。

---

## Task 6: 端到端 fixture 断言 + 文档

**Files:** Create `parserSafety.integration.test.ts`；Modify docs

- [x] **Step 1: 集成测试**（对 `dts-teaching-sample.dts`）

- `buildDtsParsedIndex(sample)` 结果中**不含**来自注释/速查表的幻影键（如不出现仅在注释中出现的属性名）。
- `detectUnsupportedDtsConstructs(sample)` 检出 include / unit-address / overlay-ref / inline-label / boolean / multi-cell-group。

- [x] **Step 2: 运行 — PASS**

`npm run test:server -- server/modules/parameter-files --run`

- [x] **Step 3: 文档更新**

- `docs/design-docs/domain-model.md`：在 §Project Parameter Files / File Sync 补一句「P0：注释剥离；`/include/` 拒绝；不支持构造跳过同步；不安全回写抛错」。
- `docs/exec-plans/tech-debt-tracker.md`：TD-039 备注 P0 止血已落地，完整结构化解析仍在 P1。

- [x] **Step 4:** `npm run build` + `npm run docs:check`，提交。

---

## Verification Matrix

| Check | Command |
| --- | --- |
| 注释剥离 | `npm run test:server -- server/modules/parameter-files/preprocess.test.ts --run` |
| 不支持构造检测 | `npm run test:server -- server/modules/parameter-files/unsupported.test.ts --run` |
| 上传护栏 | `npm run test:server -- server/modules/parameter-files/service.test.ts --run` |
| 回写护栏 | `npm run test:server -- server/modules/parameter-files/writebackService.test.ts --run` |
| 集成 fixture | `npm run test:server -- server/modules/parameter-files/parserSafety.integration.test.ts --run` |
| 前端导入 | `npm test -- src/application/parameters/import/parseDtsFragment.test.ts --run` |
| Build | `npm run build` |
| Docs | `npm run docs:check` |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| 主计划 | `docs/exec-plans/active/2026-07-14-dts-management-program.md` | Review（P0 状态） |
| 领域模型 | `docs/design-docs/domain-model.md` | **Update**（P0 止血说明） |
| 技术债 | `docs/exec-plans/tech-debt-tracker.md` | **Update**（TD-039 P0 备注） |
| 计划登记 | `docs/PLANS.md` / `docs/zh-CN/PLANS.md` | **Update**（活跃列表） |
| API 契约 | `docs/design-docs/api-contract.md` | Review（上传响应新增 `unsupportedConstructs`） |
| 前端 | `docs/FRONTEND.md` | No change（P0 无可见 UI 变更；warnings 展示留 P3） |
| 安全 | `docs/SECURITY.md` | No change |

## Documentation Update Gate

移入 `completed/` 前：
- [x] domain-model 与 tech-debt-tracker 已更新
- [x] `docs/PLANS.md` 与 `docs/zh-CN/PLANS.md` 一致
- [x] `npm run docs:check` 通过
- [x] 未尽项（warnings 前端展示、布尔属性/多组值的真正支持）已确认归入 P1/P3

> **UI 交互自动化规则：** P0 不改变用户可见交互行为（上传响应新增字段不驱动新 UI）。因此无需新增 `e2e/acceptance/` 覆盖；warnings 的可见展示留待 P3，届时补 operation/requirement ID。

---

## Spec Coverage Self-Review

| 目标 | Task |
| --- | --- |
| 剥注释（真修） | Task 1, 5 |
| 不支持构造检测 | Task 2 |
| include 拒绝 | Task 3 |
| 不支持构造跳过同步 | Task 3 |
| 回写安全失败 | Task 4 |
| 共享 fixture/基准 | Task 0, 6 |

真正支持这些构造（布尔属性、`@address`、`&label`、多组值、类型化值）在 **P1** 结构化核心中实现。
