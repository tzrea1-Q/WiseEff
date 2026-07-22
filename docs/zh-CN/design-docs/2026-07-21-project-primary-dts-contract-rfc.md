# RFC：项目主 DTS 契约（退役平台合成基 DTS）

> English: [English](../../design-docs/2026-07-21-project-primary-dts-contract-rfc.md)

- 日期：2026-07-21
- 状态：**Accepted for planning**
- 依赖：[`2026-07-21-dts-parameter-surface-boundary-rfc.md`](2026-07-21-dts-parameter-surface-boundary-rfc.md)
- 修订：[`2026-07-21-dts-capability-cut-matrix.md`](2026-07-21-dts-capability-cut-matrix.md) §6 中合成基 **Keep-internal** → **Retire**
- 实现计划：[`../exec-plans/active/2026-07-21-retire-synthetic-base-dts.md`](../exec-plans/active/2026-07-21-retire-synthetic-base-dts.md)

## 1. 问题

目标用户旅程：

1. 创建项目并**上传一份项目 DTS**；
2. 之后只在 WiseEff 前端改参、提交；
3. 所有批准变更最终落到**该项目最终 DTS 文本**；
4. 管理员在后台维护**模块 ↔ 驱动 / compatible / 实例**，**不维护 DTS 文件**。

当前 M1 seed 仍依赖平台合成基 `wiseeff-power-base.dts` + 项目 overlay。该文件仅为 `&label` / phandle 解析存在，却带来持续维护成本，并暗示错误心智（平台基树 + overlay）。

后台模块映射管的是**业务归属**，不能替代基 DTS 的引用解析——正确做法是**取消对平台基 DTS 的依赖**，而不是在后台「映射更猛」。

## 2. 决策摘要

| # | 决策 | 选择 |
| --- | --- | --- |
| P1 | 用户可见 DTS 模型 | 每项目 **一份项目主 DTS** |
| P2 | 写回目标 | 恒为 **项目主 DTS**（首次 ingest 后的权威文本） |
| P3 | 管理员 DTS 职责 | **无** — 不维护基树 / overlay / seed DTS |
| P4 | 管理员关系职责 | 仅 **模块 ↔ 驱动 / compatible / 实例** |
| P5 | `wiseeff-power-base.dts` | 从 seed / demo / 产品路径 **退役** |
| P6 | Demo / seed | 每 demo 项目 = **一份自洽主 DTS** |
| P7 | Config Set 多文件 | 仅可作实现细节；写回须收敛到项目主文本；UI 不要求维护多文件 |

## 3. 产品契约（要点）

- **上传一次，前端改参**：日常不要求任何人编辑多文件 Config Set。
- **写回承诺**：合并后更新项目主 DTS 字节（occurrence 级写回精神不变）。
- **后台只管归属**：跨项目对比用 binding / spec / module，不靠共享基树。

## 4. 退役范围

- Seed 不再以 `wiseeff-power-base.dts` 为共享 `entryFile`。
- 文档与裁剪矩阵中「合成基 Keep-internal」改为 **Retire**。
- 禁止「靠改基 DTS 修 seed」作为运维手段。

过渡期：文件可短暂留作迁移夹具，不得再作为长期平台资产。

## 5. 与参数面 MVP 的关系

不重开参数面 / 模块导航 / L0·L2 决策；补齐裁剪矩阵 §6 与边界 RFC D3/D5 留下的 seed 缺口。

## 6. 成功标准

- `db:seed:m1` 不再依赖共享平台基；
- 文案仍是「上传项目 DTS」；
- 模块映射仍是唯一归属维护面；
- 改参合并更新项目主 DTS；
- 文档与锁定计数同步更新；`docs:check` 通过。

细节与任务拆分见英文 RFC 全文与 exec plan。
