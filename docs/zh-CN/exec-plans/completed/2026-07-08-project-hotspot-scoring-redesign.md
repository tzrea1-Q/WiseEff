# 项目热点行为评分重设计

> English: [English](../../../exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md)
>
> **状态：** 2026-08-23 在 `codex/wave4-hotspot-contract-closeout` 完成；由 parent 提交 PR 并合入后才成为 `main` 事实。

## 目标与最终边界

本计划把 project、module、parameter 三种热榜从静态库存信号切换为行为治理评分。最终公共合同只有四个维度：

| 维度 | 键 | 含义 |
| --- | --- | --- |
| 窗口变更频次 | `frequency` | 所选窗口内的历史变更与变更请求 |
| 修改范围 | `scope` | project/module 统计参数实例，parameter 统计项目 |
| 流程压力 | `workflow` | 窗口请求、开放请求与打回工作 |
| 协作广度 | `collaboration` | 窗口内与全周期不同贡献者 |

`score` 是四维得分的舍入总和。parameter 热点的 `scope` 表示“修改该定义的项目数 / 拥有该定义的项目总数”，不是参数实例数。

本次 Wave 4 收口只对齐已经存在的生产行为与公开合同，并删除当前 `kind` schema 下不可达的旧代码。它不再次改变评分公式、排序、状态标签、证据文案或路由。最终 API-mode 浏览器门禁额外发现一处独立的移动端遮挡：在 Parameter Home `390x844` 下，固定的小泽入口压住最后一条热榜；现在该路由在不超过 640px 时让入口跟随页面内容，不再覆盖热榜。

## 行为评分模型

30 天基线公式：

- `frequency = historyEventsInWindow × 3 + changeRequestsInWindow × 10 × requestWeight`
- `scope = modifiedParamCount × 2 + modificationRate × 100 × 4`
- `workflow = changeRequestsInWindow × 8 × requestWeight + openRequestCount × 5 + returnedInWindow × 12`
- `collaboration = contributorsInWindow × 15 + contributorsAllTime × 3`
- `modificationRate = modifiedParamCount / max(totalParamCount, 1)`

窗口请求权重：`7d = 1.25`、`30d = 1.00`、`180d = 0.90`。

状态合同：

- `需要关注`：`score ≥ 180`，或 `openRequestCount ≥ 10`，或 `modificationRate ≥ 0.15`。
- `偏高`：`score ≥ 100`，或 `changeRequestsInWindow ≥ 5`。
- `正常`：其它情况。

趋势比较当前窗口与前一个等长窗口的总分。证据固定为修改范围、窗口变更次数、待处理流程与窗口请求三类。

## 最终实现

- `src/domain/parameters/projectHotspotScoring.ts`：四维纯评分、状态与证据生成。
- `src/domain/parameters/dashboardTypes.ts`：`DashboardHotspot.scoreBreakdown` 只允许四维行为结构。
- `server/modules/parameters/dashboard/hotspotRepository.ts`：project/module/parameter 行为聚合。
- `server/modules/parameters/dashboard/service.ts`：所有合法 kind 直接映射到同一个行为评分 seam。
- `src/features/parameter-home/components/HotspotScorePanel.tsx`：统一展示四维；parameter 的 scope 标签为“项目修改范围”。
- `src/infrastructure/mock/mockParameterDashboardRepository.ts`：mock/API 共享相同结果形状。
- `server/modules/contracts/dtoSchemas/parameters.ts`：实现 `ParameterDashboardHotspotsResponse` 的具体 OpenAPI schema。

Wave 4 删除了无人调用的五维服务端 scorer、旧 DTO union、旧 presentation 分支、test-only 旧 scorer 与对应测试。删除测试成立，因为复杂度不会转移到其它调用方：当前生产、mock 和 UI 都已经只走行为评分接口。

## 合同 RED 与 GREEN

初始 RED 直接测试生成 OpenAPI：`ParameterDashboardHotspotsResponse` 当时只是没有 `items` / `scoreBreakdown` 的空 `object` 占位，因此无法阻止英文文档继续写旧五维。

GREEN 后生成合同固定为：

```json
{
  "frequency": 30,
  "scope": 40,
  "workflow": 25,
  "collaboration": 15
}
```

四个键都是必填项，`additionalProperties` 为 `false`；DTO 测试明确拒绝 `risk` / `impact` / `drift` 的旧结构。服务端测试对三种 kind 断言相同的精确键集合，而不是匹配源码文本或私有函数。

## 验证

```bash
npx vitest run --config vitest.server.config.ts \
  server/modules/contracts/openapi.test.ts \
  server/modules/contracts/dtoSchemaCatalog.test.ts \
  server/modules/parameters/dashboard/service.test.ts

npx vitest run \
  src/domain/parameters/dashboardTypes.test.ts \
  src/domain/parameters/projectHotspotScoring.test.ts \
  src/features/parameter-home/components/HotspotScorePanel.test.tsx \
  src/hotspotPresentation.test.ts \
  src/infrastructure/mock/mockParameterDashboardRepository.test.ts

node --import tsx scripts/check-openapi-contract.ts
npx tsc -b
npm run build
npm run docs:check
git diff --check

# fresh API-mode runtime、production HMAC、deterministic Xiaoze
npx playwright test --config playwright.acceptance.config.ts \
  --project='Desktop Chrome' e2e/acceptance/parameter-home.acceptance.spec.ts
npm run acceptance:evidence -- --run <focused-run-dir> --require PARAM-HOME-001
```

标准 `npm run contract:openapi` / `contract:check` 在受限 sandbox 中会因 `tsx` 创建 IPC socket 返回 `EPERM`；使用同一 `tsx` loader 的 `node --import tsx` 入口生成并校验相同 artifact。parent/CI 可在普通环境继续运行标准 npm scripts。

## 文档影响矩阵

| 类别 | 状态 | 精确文件 / 证据 |
| --- | --- | --- |
| API 合同 | Update | `docs/design-docs/api-contract.md`、`docs/zh-CN/design-docs/api-contract.md`、`docs/generated/openapi.json`、`server/modules/contracts/dtoSchemas/parameters.ts`、`server/modules/contracts/dtoSchemas/catalog.ts`。 |
| 计划 | Update | 英文计划移入 `docs/exec-plans/completed/`；新增本中文 companion；`docs/PLANS.md` 与 `docs/zh-CN/PLANS.md` 改指 completed 路径。 |
| 产品规格 | Review | `docs/product-specs/product-spec.md`、`docs/zh-CN/product-specs/product-spec.md` 不定义热点维度键或公式，记录 unchanged。 |
| 架构 / 领域 | Review | `CONTEXT.md`、`ARCHITECTURE.md`、`docs/design-docs/full-stack-architecture.md` 不需要改；模块 seam 与路由未移动。 |
| 质量 / 测试 | Review | 现有验证矩阵与测试策略不变；新增的 OpenAPI/DTO/focused tests 与 `e2e/acceptance/parameter-home.acceptance.spec.ts` 使用现有门禁。 |
| 可靠性 / 安全 | No change | 无运行模式、写路径、权限、审计、队列或运维变化。 |
| 前端 / 设计 | Update | `docs/design-docs/2026-07-07-parameter-home-production-redesign-design.md` 与 `docs/zh-CN/design-docs/2026-07-07-parameter-home-production-redesign-design.md` 记录四维 successor、移动端小泽入口安全流式规则并相互链接；`scripts/bilingual-docs.ts` 将该 pair 纳入 required。`HotspotScorePanel` 删除不可达旧分支，浏览器门禁修复避免入口遮挡最后一条热榜。 |
| 生成物 | Update | `docs/generated/openapi.json` 发布具体四维响应结构。 |
| References | No change | 没有当前 reference 定义这份 DTO。 |

## 完成门

- [x] 中英 API 合同固定四维行为结构。
- [x] OpenAPI 不再是空占位，DTO 拒绝旧五维结构。
- [x] 三种合法 kind 共用同一 public DTO/service seam。
- [x] 不可达旧 scorer/projection/presentation 已删除。
- [x] product specs 已 review unchanged，未制造产品行为变化。
- [x] Parameter Home 设计历史、中英治理和两份 PLANS 索引均指向当前合同与 completed archive。
- [x] fresh owned PostgreSQL、production HMAC、deterministic Xiaoze 的 API-mode `PARAM-HOME-001` 及 evidence validator 通过。
- [x] `playwright-cli` 在 `1440x900`、`768x1024`、`390x844` 均保存 snapshot + screenshot；首条热榜已展开，console error 为 0，dashboard API 为 2xx，无横向溢出；门禁发现的移动端入口遮挡已有 focused acceptance 回归测试。
- [x] focused tests、typecheck、build、docs 与 diff 在 parent handoff 前通过。

本轮 owned acceptance runtime 使用 PostgreSQL `127.0.0.1:55494`、API `127.0.0.1:8794` 与 Vite API-mode `127.0.0.1:5194`，具备 run marker 与独立 object-store namespace；本地证据位于 `work/ui-checks/wave4-hotspot/`。评分公式、排序、状态标签、证据和路由均未变化，唯一交互变化是浏览器门禁发现并验证的移动端小泽入口位置修复。

共享 tracker、Wave 4 计划、PR、CI、合入与 merged-main 证据由 parent 负责，本实现分支不提前修改或声称完成。
