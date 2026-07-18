# 本地 non-HDC Readiness Gate 兼容修复实施计划

> **供开发智能体使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按 checkbox 逐项实施。

**目标：** 修复 pilot-readiness API 从 `agentProvider` 改为 `xiaozeLlm` 后的本地标准验收阻断，同时保持 target/full-pilot 门禁不变。

**架构：** 以 API 契约为事实来源，只修改 preflight consumer 的本地精确 allowlist。未知 blocker、禁止自动启动 runtime 及 `--require-pilot-ready` 继续失败关闭；随后在不使用 `--skip-preflight` 的情况下运行标准浏览器验收。

**技术栈：** TypeScript、Vitest、npm acceptance runner、Playwright、中英文 Markdown。

**设计规格：** [`docs/zh-CN/superpowers/specs/2026-07-19-local-non-hdc-readiness-gate-compatibility-design.md`](../specs/2026-07-19-local-non-hdc-readiness-gate-compatibility-design.md)

### Task 1：测试先行修正规范 gate 名

**文件：**
- 修改：`scripts/run-acceptance-preflight.test.ts:227-283`
- 修改：`scripts/run-acceptance-preflight.ts:207-237`

- [ ] **Step 1：先写失败测试**

将两个正向组合改成 `deviceGateway + xiaozeLlm` 与 `deviceGateway + xiaozeLlm + backups`，期望结果分别为：

```ts
{
  accepted: true,
  outcome: "non_hdc_local",
  detail: "Accepted for local non-HDC preflight; deviceGateway and xiaozeLlm remain blocked."
}
```

```ts
{
  accepted: true,
  outcome: "non_hdc_local",
  detail: "Accepted for local non-HDC preflight; deviceGateway, xiaozeLlm, and backups remain blocked."
}
```

增加旧名称负向用例：

```ts
expect(
  evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway", "agentProvider"] })
).toMatchObject({ accepted: false, outcome: "blocked" });
```

并将 no-start 负向用例输入改为 `deviceGateway + xiaozeLlm`。

- [ ] **Step 2：验证 RED**

```bash
npx vitest run scripts/run-acceptance-preflight.test.ts
```

预期：新规范组合被旧实现拒绝，旧名称仍被接受，因此测试失败。

- [ ] **Step 3：最小实现**

在 `evaluatePilotReadiness` 的两个本地分支中使用：

```ts
blockerSet.has("xiaozeLlm")
```

同步 Step 1 的精确 detail 文本；禁止增加别名、通配匹配或修改 `pilot_ready` 分支。

- [ ] **Step 4：验证 GREEN 并提交**

```bash
npx vitest run scripts/run-acceptance-preflight.test.ts scripts/run-browser-acceptance.test.ts
git add scripts/run-acceptance-preflight.ts scripts/run-acceptance-preflight.test.ts
git commit -m "fix: align local readiness with xiaoze gate"
```

预期：两个测试文件全部通过后才提交。

### Task 2：更新中英文运维契约

**文件：**
- 修改：`docs/runbooks/manual-acceptance.md:80,275`
- 修改：`docs/zh-CN/runbooks/manual-acceptance.md` 对应段落
- 修改：Round6 中英文 active plan

- [ ] 将本地确定性依赖名称统一为 `xiaozeLlm`，明确只产生 `non_hdc_local`。
- [ ] 记录 API 返回 `xiaozeLlm`、preflight 仍检查 `agentProvider` 的已复现契约漂移，不改变 TD-042。
- [ ] 执行并提交：

```bash
npm run docs:check
git diff --check
git add docs/runbooks/manual-acceptance.md docs/zh-CN/runbooks/manual-acceptance.md docs/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md docs/zh-CN/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md
git commit -m "docs: align local readiness gate terminology"
```

### Task 3：运行干净 source 的标准验收

**文件：**
- 生成更新：`docs/generated/acceptance-browser-evidence.md`
- 生成更新：`docs/generated/acceptance-operation-evidence.md`
- 生成更新：`docs/generated/acceptance-operation-evidence/index.json`
- 修改：Round6 中英文 active plan

- [ ] **Step 1：完整门禁**

```bash
npm run contract:check
npm run docs:check
npm run test:all
npm run build
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run selfhost:check
git diff --check main...HEAD
git status --porcelain
```

预期：全部退出 0，生成 evidence 前工作区为空。

- [ ] **Step 2：禁止 bypass 的标准 preflight**

```bash
npm run acceptance:preflight
```

预期：退出 0，结果为 `non_hdc_local`，并明确列出仍被阻断的本地 gate。禁止使用 `--skip-gates`、`--skip-preflight` 或 `--require-pilot-ready`。

- [ ] **Step 3：标准浏览器矩阵**

```bash
npm run acceptance:browser -- --mode local-non-hdc
```

完整本地候选应满足 preflight 与 Playwright 通过、A-E/G-I 通过、F 因硬件条件 skipped、requirements 59/59、operations 56/56。若共享 `8787` 的 auth/gateway 状态仍失败，保留证据并单独诊断，禁止降低任何断言。

- [ ] **Step 4：验证和记录 evidence**

浏览器矩阵通过后执行：

```bash
npm run acceptance:evidence
shasum -a 256 test-results/acceptance-evidence-runs/latest-full.json
```

记录 run ID、source commit 和 SHA-256。若 browser 失败，evidence check 仅作诊断，失败运行不得替换 `latest-full`。

- [ ] **Step 5：提交真实结果**

```bash
npm run docs:check
git diff --check
git add docs/generated/acceptance-browser-evidence.md docs/generated/acceptance-operation-evidence.md docs/generated/acceptance-operation-evidence/index.json docs/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md docs/zh-CN/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md
git commit -m "docs: record standard local acceptance evidence"
```

完成后仍不得关闭 TD-042，也不得宣称 target、production、full-pilot 或 cutover ready。
