# 质量评分

> English: [English](../QUALITY_SCORE.md)

这是 WiseEff 的活质量看板入口。完整评分表、验证门与覆盖说明以英文版为准；本页记录中文语境下的模块摘要与剩余缺口。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## DTS 重载覆盖

DTS 重载调试（`/dts-reload`，`server/modules/dts-reload`）经系列 #281–#290 落地。覆盖候选列表、敏感节点启动门、overlay 编译/预检、假桥部署（mount / pushFile / trigger）、内核日志证据、行为核对、残留记账、恢复基线与配置管理。验收 ID：

| ID | 覆盖 | 说明 |
| --- | --- | --- |
| `DTS-RELOAD-DEPLOY-001` | automated | 假本地设备桥部署至 `unverifiable` |
| `DTS-RELOAD-KERNEL-001` | automated | 内核日志采集保持未判定证据 |
| `DTS-RELOAD-VERIFY-001` | automated | `debug.readNode` 行为核对 |
| `DTS-RELOAD-RESIDUE-001` | automated | 残留 + 恢复基线 |
| `DTS-RELOAD-DEPLOY-HW-001` | conditional | 真实 HDC 实验室；需 `DEVICE_BRIDGE_HDC_AVAILABLE=true` |

Agent 发起的变更调用（start / deploy / restore）在服务端直接拒绝，并审计 `dts-reload-agent-refused`（#301）；敏感节点 Agent 拒绝仍作纵深防御。#284 人类操作者敏感行为不变。

剩余缺口：硬件条件证据（`DTS-RELOAD-DEPLOY-HW-001`）；多副本桥路由（TD-067）；延期产品债 TD-063–066。

## 前端 UI 质量门禁

- `npm run ui:check`(CI 门禁):逐规则统计令牌块之外的裸颜色/裸 `z-index`/裸 `font-size`/手写 `box-shadow`/`ease` 关键字,以及 `window.confirm`、手写 modal-backdrop、固定英文残留清单;任一规则计数超过 `scripts/ui-standards-baseline.json` 即失败。计数下降时在同一变更里运行 `npm run ui:check -- --update-baseline` 下调棘轮;基线为 0 的规则从第一天起硬禁止。
- `npm run lint`(CI 门禁):eslint 9 flat config,`jsx-a11y` + `react-hooks` 作用于 `src/**/*.{ts,tsx}`;零违规规则设 error 阻断,存量规则设 warn 并在 `eslint.config.js` 中记录当日计数,后续逐步清偿后升级为 error。
- 修改门禁脚本本身时,运行 `npm run test:scripts -- scripts/check-ui-standards.test.ts`。

## 关键阅读点

- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](root/AGENTS.md)
- [docs/zh-CN/root/README.md](root/README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](root/CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](root/ARCHITECTURE.md)
- [docs/zh-CN/README.md](README.md)
- [docs/zh-CN/frontend.md](frontend.md)
- [docs/zh-CN/PLANS.md](PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](QUALITY_SCORE.md)
