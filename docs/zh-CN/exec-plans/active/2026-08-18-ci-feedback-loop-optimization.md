# CI 反馈环优化

> 状态：**进行中 — 已实现，待合入**
> 日期：2026-08-18
> 实现分支：`feat/ci-feedback-loop`（从最新 `origin/main` 切出；Wave 0+1 同一 PR）
> English: [`docs/exec-plans/active/2026-08-18-ci-feedback-loop-optimization.md`](../../../exec-plans/active/2026-08-18-ci-feedback-loop-optimization.md)

**目标：** 不再把 38 分钟的 M5.12 本机非 HDC 全量验收当作 PR 合入门槛。全量套件改到合并后 / 夜间 / 按需跑；日常改动走分层 GitHub Actions，对齐成熟 TypeScript 产品的调度方式。

**架构：** 三层，一个工作流，一个哨兵 required check。

| 层 | 何时跑 | 证明什么 | 墙钟目标 |
| --- | --- | --- | --- |
| L0 探测 | 每个事件 | 哪些路径变了，后面哪些 job 可以跳 | < 1 分钟 |
| L1 合入门槛 | 每个产品 PR；`main` | 单测/集成、lint、文档、UI 棘轮、合同、构建；UI 路径再跑一次质量门；产品路径再跑带 `@ci-smoke` 的验收 | 常规 10–15 分钟；文档-only 2–5 分钟 |
| L2 全量本机非 HDC | `push` 到 `main`、夜间、标签 `full-acceptance`、`workflow_dispatch` | 今天的 a11y + visual + responsive + `acceptance:browser --mode local-non-hdc` + 证据归档 | 30–38 分钟 |
| L3 目标合成 | 仅手动 | `target-non-hdc` / `full-pilot` 不变 | 与现在相同 |

任务勾选、文件清单、验证命令与 Documentation Impact Matrix 以英文计划为准。下面是调研结论与对本仓库的裁剪。

---

## 行业调研（一手来源）

下列主张来自各项目自己的 workflow YAML 或官方文档，于 2026-08-18 拉取。不用二手博客当依据。

### 调度与双跑

- [GitHub Actions concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency)：同一 concurrency group 同时只跑一趟；`cancel-in-progress: true` 取消过期 run。官方 PR 示例：`group: ${{ github.head_ref || github.run_id }}`。
- [vitejs/vite `ci.yml`](https://github.com/vitejs/vite/blob/main/.github/workflows/ci.yml)：`on.push` 只覆盖 `main` / release / feat / fix / perf / 版本标签；`pull_request` 不限。concurrency 为 `${{ github.workflow }}-${{ github.event.number || github.sha }}` 且取消进行中。`changed` job 在 diff 只有 `docs/**`、`**.md`、模板、以及除 `ci.yml` 以外的 `.github/**` 时跳过重测试矩阵。跳过时仍有 `test-passed` / `test-failed` 哨兵报状态。
- [vercel/next.js `build_and_test.yml`](https://github.com/vercel/next.js/blob/canary/.github/workflows/build_and_test.yml)：`push` 只在 `canary`；`pull_request` 类型为 `opened, synchronize`。PR 用 ref 取消旧 run，push 用 SHA 隔离。`changes` job 产出 `docs-only`，重 job 在文档-only 时跳过。required 聚合 job 名叫 `thank you, next`。部署到 Vercel 的 e2e **不是**每个 PR。
- [prisma/prisma `main` `ci.yml`](https://github.com/prisma/prisma/blob/main/.github/workflows/ci.yml)：只有 `pull_request` + `merge_group`，**没有 `push`**。注释 Pattern 1：文档-only 时 required job 仍启动并报状态，Postgres 步骤跳过。
- [prisma/prisma `v7` `test.yml`](https://github.com/prisma/prisma/blob/v7/.github/workflows/test.yml) 原文：*“Run on `push` only for main, if not it will trigger `push` & `pull_request` on PRs at the same time.”* 正是 WiseEff 现在的双跑。
- [Turborepo GitHub Actions 指南](https://turbo.build/repo/docs/guides/ci-vendors/github-actions)：标准例子是 `push.branches: ["main"]` 加 `pull_request` 的 `opened, synchronize`，并设 `timeout-minutes: 15`。功能分支的 push 不再跑第二遍全量 CI。
- [microsoft/playwright `tests_primary.yml`](https://github.com/microsoft/playwright/blob/main/.github/workflows/tests_primary.yml)：`push` / `pull_request` 只对 `main` / `release-*`。PR 用 `paths-ignore` 排除 `docs/**`（工作流级；见下方 Pending 陷阱）。concurrency 用 `head_ref || run_id`，push 互不取消。矩阵 `fail-fast: false`。
- [Playwright `tests_secondary.yml`](https://github.com/microsoft/playwright/blob/main/.github/workflows/tests_secondary.yml)：贵的 mac/Windows 矩阵只在 `pull_request` 的 `labeled`（或 push 到主干）上跑；部分 job 还要 `CQ1`。
- [vitest-dev/vitest `ci.yml`](https://github.com/vitest-dev/vitest/blob/main/.github/workflows/ci.yml)：`push` 只 `main`。unit / e2e / coverage **分 runner**，不在一台机器串行。
- [Grafana `pr-e2e-tests.yml`](https://github.com/grafana/grafana/blob/main/.github/workflows/pr-e2e-tests.yml)：`cancel-in-progress` **仅 PR**。文档 PR 跳过 Playwright 分片，但保留占位 required job `All E2E tests complete`。主干 `push` 强制跑 e2e。
- [Home Assistant](https://github.com/home-assistant/core/blob/dev/.github/workflows/e2e-tests.yml)：Playwright e2e 只有 `workflow_dispatch` / `workflow_call`，**不进 PR**。PR 门是 lint + 受影响的 pytest。
- [Rust `jobs.yml`](https://github.com/rust-lang/rust/blob/master/src/ci/github-actions/jobs.yml)：注释写明「合进默认分支必须绿」的是 bors `auto:`，不是每个 PR push 的完整矩阵。

WiseEff 现在相反：`on: push` 与 `on: pull_request` 都不加限制，无 concurrency，无路径过滤。一次 PR 提交会拉起两趟 38 分钟（账单约 96 分钟）。

### 不要用工作流级 skip 挡 required check

GitHub 官方：job 被 `if:` 跳过 → 状态 **Success**，不挡合入。整个 workflow 因 `paths` / `paths-ignore` / `[skip ci]` 没启动 → check 停在 **Pending**，**会挡住** required check。原文：不要把「可能被跳过的 workflow」设为 required。

Vite / Vitest：workflow 总启动，贵 job 用 `if:`，文档-only 仍跑 lint。Playwright 自己的 `tests 1` 用 PR `paths-ignore`——若以后把那些 job 设为 required，这是不安全模式（他们靠无 filter 的 `infra` 保命）。Grafana 用永远存在的占位 job。[Supabase `docs-e2e.yml`](https://github.com/supabase/supabase/blob/master/.github/workflows/docs-e2e.yml) 仓库内注释写同一陷阱：Docs E2E 是 master 上的 required check，所以每个 PR 都必须产出 check；工作流级 `paths` 会让无关 PR 一直 Waiting。Prisma `main` 称此为 Pattern 1。

**本仓库规则：** `ci.yml` 禁止 `on.paths` / `paths-ignore`。只允许 job 级 `if:`。哨兵 job 必须每次都跑。

### 昂贵浏览器套件不是默认 PR 门

- [calcom/cal.diy `pr.yml`](https://github.com/calcom/cal.diy/blob/main/.github/workflows/pr.yml)（`calcom/cal.com` 现指向此社区 fork；Cal.com 生产已闭源）：只有 `pull_request_target`，无 `push`。文档/文案类变更标成不必全量检查。Playwright 等 `ready-for-e2e`。[Playwright 规则](https://github.com/calcom/cal.diy/blob/main/agents/rules/testing-playwright.md)写明：代码 PR 若跳过 e2e，`required` **故意失败**，挡合入。标签只是推迟贵套件，不是让 e2e 变成可选项。合并队列 [`all-checks.yml`](https://github.com/calcom/cal.diy/blob/main/.github/workflows/all-checks.yml) 总是跑全量 e2e。
- [twentyhq/twenty `ci-e2e-main.yaml`](https://github.com/twentyhq/twenty/blob/main/.github/workflows/ci-e2e-main.yaml)：产品 Playwright 只在 **`push` 到 `main`** 或 PR 带 `run-merge-queue` 时跑。普通 PR 跳过 e2e，status-check **不因 skip 变红**。`cancel-in-progress` 在 `main` 上为 false。
- [supabase/supabase `studio-e2e-test.yml`](https://github.com/supabase/supabase/blob/master/.github/workflows/studio-e2e-test.yml)：每个 `push: master` 和每个 PR **启动** workflow；Playwright 步骤只在 studio 相关路径变更时跑。`fail-fast: false`，两片加权 `62:38`。
- [Nx affected](https://nx.dev/ci/features/affected)：图一大，全量重测会太慢；CI 应只跑 PR 碰到的项目及其依赖。本计划不引入 Nx，用单包路径过滤表达同一决定。
- [Google Testing Blog — Test Sizes](https://testing.googleblog.com/2010/12/test-sizes.html)、[Just Say No to More End-to-End Tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)、[Hackable Projects, Pillar 3](https://testing.googleblog.com/2016/11/hackable-projects-pillar-3.html)：小测试是 presubmit 信号；反馈环必须快、可靠、能隔离失败。把整晚 e2e 当 *唯一* 发布门槛会拖死进度。大 / UI 测试更碎。[Microsoft 工程实践](https://learn.microsoft.com/en-us/devops/develop/how-microsoft-develops-devops)：PR 跑约 5 分钟的快速子集，明确不是完整矩阵。

WiseEff 的 M5.12 现在把 Large 套件（共享 Postgres、Vite、四次 Playwright 冷启动、约 129 个验收、11 路由 × 3 视口）钉在每个 PR 和每次 push 上。

### Playwright 官方 CI 建议（该抄什么、不该盲抄）

- [Playwright CI](https://playwright.dev/docs/ci)：GitHub 托管 runner 上优先 `workers: 1` 保稳定；要快就用 **跨 job 分片**，不要在单台 2–4 核上加 worker。每个 job 设 `timeout-minutes`。`--only-changed` 只作 PR 上的预跑失败加速，同一页写明这是启发式，后面仍必须跑全量。不建议缓存浏览器二进制。
- [Playwright sharding](https://playwright.dev/docs/test-sharding)：`--shard=x/y` 只对能并行的测试有意义。没有 `fullyParallel` 时按文件切，文件大小不均就会浪费机器。

WiseEff 已经是 `workers: 1` / `fullyParallel: false`，因为验收库共享且会改数据。在隔离之前对这套套件分片是错的。今天只有质量门路由和 disposable-DB 规格适合诚实分片。

### 本方案采纳的模式

1. 功能分支只走 `pull_request`；`push` 限于 `main`（Vite / Next / Prisma v7 原文 / Turbo / Grafana / HA / Rust）。Prisma `main` 更狠（没有 `push`）；本仓库仍要 `push: main`，因为没有 merge queue 也得跑 L2 证据。
2. 每次都设 `concurrency`；**只对 PR 取消进行中**（Grafana / Twenty / Playwright / Next）。不要取消正在跑的 `main` L2。
3. 路径探测 + **job 级** `if:` 跳过文档-only（含 Supabase Docs E2E、Prisma Pattern 1）。`ci.yml` **禁止** 工作流级 `paths-ignore`（GitHub Pending 陷阱）。探测失败时按 L1 跑，不当成文档-only。
4. 哨兵 job 必须每次启动（Next `thank you, next`、Vite `test-passed`、Cal.diy `required`、Grafana 占位、Twenty status-check）。
5. 大型浏览器套件离开默认 PR 关键路径。Cal.diy **挡合入**直到带标签的 e2e 跑完；Twenty 普通 PR 跳过也不红。本仓库取 Next 中间态：产品 PR 无标签也跑 L1 + `@ci-smoke`，全量 L2 留在 `main` / 夜间 / `full-acceptance`。
6. 每个套件一次 Playwright 进程，质量门不要冷启动三次。
7. 每个 job 设 `timeout-minutes`。分片矩阵 `fail-fast: false`。不缓存 Playwright 浏览器。
8. 本计划不引入 Nx/Turbo，也不对共享库验收分片。

---

## 本仓库基线

2026-08-17 绿跑 [`32000206916`](https://github.com/tzrea1-Q/WiseEff/actions/runs/32000206916) 与 2026-08-18 工作流实测：

- 墙钟 **38 分 32 秒**。关键路径是 `Acceptance local non-HDC`（2309 s）。`Build and test` 596 s，被验收盖住。
- 验收拆分：browser 1519 s，responsive 277 s，a11y 182 s，visual 163 s，seed 59 s。四次独立 Playwright 进程，`CI` 下不复用已有服务。
- 两份 Playwright 配置都是 `workers: 1`。共享 seed 库。topology / semantic 还会在串行队列里再起 disposable Postgres + API + Vite。
- `scripts/check-acceptance-ci.ts` 要求工作流文本里出现四条独立命令，把慢形状钉死。
- 验证矩阵写文档-only 本地只需 `docs:check`，CI 不认。
- 无 concurrency、无 `timeout-minutes`、无路径过滤。`main` 一红，后续 PR 都先付约 20 分钟质量门，才在验收里看到晚失败。

本计划不修产品验收失败（TD-079 等）。它让那些失败不必排队 40 分钟才被看见，也让绿的文档 PR 不必再付 38 分钟。

---

## 已锁定决定

1. **合入门槛是 L1，不是今天的 L2。** 全量本机非 HDC + 证据归档仍强制跑在 `main`、夜间、标签 `full-acceptance`、以及 `workflow_dispatch` 的 `local-non-hdc`。功能分支的每次 push 不再自动开跑。
2. **不是「等人打标签才跑 e2e」。** Cal.diy 的 `ready-for-e2e` 仍会挡住代码 PR 合入，代价是等标签。Twenty 普通 PR 不跑 Playwright 也能绿。两者都不贴本仓库合入 `main` 的节奏。产品路径 PR **总是**跑已有规格上的 `@ci-smoke`（最多 5 个，不要 disposable-DB）。标签 `full-acceptance` 让 PR **自愿** 在合入前跑 L2。
3. **文档-only PR** 只跑 L0 + `docs:check`（以及文档检查器本身变更时的 script 测试）和哨兵。不装 Playwright、DTS，不种 Aurora。
4. **M5.11 质量门在 CI 里一次跑完。** 本地仍保留 `acceptance:a11y` / `visual` / `responsive`。job 级 seed 之后设 `WISEEFF_QUALITY_SKIP_SEED=true`。
5. **不引入 Nx、Turborepo、自托管 runner、浏览器二进制缓存。**
6. **不对共享库验收 job 分片**，除非以后做隔离（本计划范围外）。Wave 2 可以把质量门和全量验收拆成兄弟 job，质量门路由可以分片。
7. **以后若打开 branch protection，required check 是哨兵 job**（`CI / required` 或 `CI / Merge bar`），不是 `Acceptance local non-HDC`。跳过的 L2 不得让 PR 变红。`ci.yml` 必须每次 PR 都启动；贵 job 只用 `if:` 跳过。
8. **`latest-full.json` 与 M5.10 证据索引仍只来自全量。** smoke 走已有 focused-run 命名空间，不得发布 `latest-full`。
9. **full-pilot 仍只手动、非默认。**
10. **Wave 0 可以先于 Wave 1 合入。** 真正改反馈环的是 Wave 1。
11. **只取消过期的 PR run。** `main` / 夜间 / 手动的 L2 不被后到的 SHA 杀掉。

关键风险（完整表见英文计划）：`ci.yml` 若加工作流级 `paths-ignore`，以后把该 workflow 设为 required 会卡在 Pending。只允许 job 级 `if:`。产品 PR 跳过 L2 时哨兵必须绿（Twenty），不要抄 Cal.diy「没跑全量 e2e 就红」。

---

## 波次（摘要）

### Wave 0 — 卫生，不改 M5.12 分层

产品 PR 仍跑今天的全量 L2，只去掉周围浪费。实现清单与英文计划 Wave 0 勾选项对齐：

- `on.push` 只限 `main`；保留 `pull_request` 与 `workflow_dispatch`。**不要**加工作流级 `on.paths` / `paths-ignore`。
- concurrency：`group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}`，`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`（只取消过期 PR）。
- `timeout-minutes`：`build-and-test` 20、acceptance 50。
- L0 changed-files **job** + job 级 `if:`；`ci.yml` 自身永不进 skip 集。
- 哨兵 job `if: always()`。
- 质量门三次冷启动并成一次；`db:seed:all` 之后设 `WISEEFF_QUALITY_SKIP_SEED=true`。

成功：文档-only ≤ 5 分钟；产品 PR ≤ 35 分钟；一次提交不再双跑；新 PR push 取消旧 PR run（不取消 `main` L2）。`ci.yml` 不用工作流级 `paths`。

### Wave 1 — 分层合入门槛（改 M5.12 合同）

按路径分 `docs-only` / `ui` / `product` / `workflow`。产品 PR 跑 L1 + `@ci-smoke`。L2 只在 `main` / 夜间 / 标签 / 手动。重写 `check-acceptance-ci` 棘轮。同步改中英验证矩阵与测试策略里的 M5.12 表述（英文 testing-strategy 目前缺 ZH 已有的 §8，同一变更补上）。

成功：常规产品 PR 10–15 分钟；文档-only ≤ 5 分钟；`main` 仍产出 Playwright 报告与操作证据产物。

### Wave 2 — 让剩下的 L2 更便宜（可选）

L2 质量门与浏览器验收拆 job；缓存 `.wiseeff-tools`（不缓存浏览器）；质量门路由可分片；`--only-changed` 只能当 L2 的预跑，不能替代 L2。不对共享库验收分片。

成功：L2 墙钟 ≤ 25 分钟，且不断言变弱。

---

## Git 与 PR

实现子代理只在功能分支提交，不得开/合 GitHub PR。父代理 review、验证、开/合 PR，再同步本地 `main`。

**落地决定（2026-08-18）：** Wave 0+1 同一 PR。本会话要改合入门槛，不单独合「产品 PR 仍跑全量 L2」的中间态。Wave 2 不进本 PR；合入后若夜间 L2 仍慢，再开后续并记技术债。

### 实现合同（摘要）

- 工作流总启动，无 `on.paths`。job：`detect`、`docs-governance`（每次 `docs:check`）、`build-and-test`（L1）、`acceptance-quality`（`acceptance:quality-run` 一次进程）、`acceptance-smoke`、`acceptance-local-non-hdc`（L2）、target synthetic、哨兵 `required`（显示名 Merge bar）。
- `acceptance:quality` 仍是元数据检查。新脚本 `acceptance:quality-run` 一次跑完 warmup+a11y+visual+responsive。
- smoke 三个已有用例打 `@ci-smoke`：shell `/`、auth-runtime、parameter-home。证据命名空间 `focused-ci-smoke`，不得发布 `latest-full`。
- `main` / 夜间：L1 + L2，不重复 smoke/quality。产品 PR：L1 + quality + smoke。文档-only：detect + docs:check + 哨兵。
- 路径分类与棘轮测试见英文计划 Implementation Contract。

---

## UI 交互自动化

本计划只改 CI 调度和「何时」跑已有套件，不改用户可见交互。不新增验收 ID。smoke 不得用窄用例去满足只有全量规格才能证明的 required ID。L2 仍跑 `acceptance:browser` 并上传原产物路径。

---

## Documentation Impact Matrix

与英文计划同一张表。中文侧必须在 Wave 1 更新：

- `docs/zh-CN/developer/verification-matrix.md`
- `docs/zh-CN/design-docs/testing-strategy.md` §8
- `docs/zh-CN/QUALITY_SCORE.md`（一句 CI 事实）
- `docs/zh-CN/PLANS.md`（本计划在 active 列表）
- 本文件

`docs/zh-CN/manual-acceptance.md` 若仍写「每个 PR 跑全量本机非 HDC」，同一 Wave 改掉。

---

## Documentation Update Gate

计划迁入 `completed/` 前必须 `npm run docs:check` 通过。每个 `Update` / `Review` 行要么已改，要么记录「未改 + 证据」。推迟项写入 `docs/exec-plans/tech-debt-tracker.md`（例如「共享验收库隔离后才能对 L2 分片」）。中英计划文件名必须成对归档，不得一边 active 一边 completed。
