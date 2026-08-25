# DTS 参数调试通过已连接 Device Bridge 检测目标

> English: [English](../../../exec-plans/completed/2026-08-25-dts-bridge-target-detection.md)

**状态：** 已于 2026-08-25 完成 GitHub issue #630。实现已在功能分支提交；与本 issue 无关的登录页修改仍保持未提交、未暂存。

## 目标

让 `/dts-reload` 与节点调试页一样，使用现有的、带认证和组织范围约束的 Device Bridge 目标检测 seam。只有本地 health 报告某个 Bridge 已连接且该 ID 存在于已注册 Bridge 列表时，检测请求才携带 `bridgeId`。HDC/ADB 切换、Bridge 替换或断开、过期目标、结构化错误和请求时序都必须安全。

## 范围与决策

- 扩展页面到 gateway 的 seam 与 HTTP 请求体，接收可选且已 trim 的 `bridgeId`；继续使用规范路径 `POST /api/v1/debugging/targets/detect`。
- 保留服务端认证、权限、组织、撤销、连接池和协议 gateway 校验；不增加迁移、不绕过 RPC、不伪造 `deviceId`，不重分类 409。
- Bridge 或协议发生变化时清理目标展示并使进行中的检测失效；忽略旧请求、旧 Bridge 或旧协议的响应。
- 沿用现有本地化错误展示，保留 `PROTOCOL_UNSUPPORTED` / `DEVICE_UNAVAILABLE` 与 request ID；空目标单独显示可行动提示。
- 本机没有已连接的 Device Bridge 或 HDC 设备，因此本地浏览器证据只覆盖 Bridge 离线状态。真实 Windows Bridge/HDC 和多副本亲和性仍属于部署验收。

## 实现记录

| 范围 | 文件 | 结果 |
| --- | --- | --- |
| 页面检测状态 | `src/features/dts-reload/DtsReloadPage.tsx` | 仅使用 health 确认且已注册的 Bridge，传入当前协议和 ID，清除过期状态、控制请求时序，并展示离线/空目标/结构化错误。 |
| 应用 seam | `src/app/routes.tsx` | 把可选 Bridge ID 转发给现有 debugging gateway。 |
| HTTP 契约 | `src/infrastructure/http/debuggingClient.ts` | 序列化有效的 trim 后 ID；ID 不可用或为空时省略。 |
| Bridge 选择 | `src/application/bridge/bridgeTargetSession.ts` | 优先选择最新 health 确认且已注册的 Bridge。 |
| 回归覆盖 | `src/features/dts-reload/DtsReloadPage.test.tsx`、`src/infrastructure/http/debuggingClient.test.ts`、`src/application/bridge/bridgeTargetSession.test.ts`、`server/modules/debugging/routes.test.ts` | 覆盖 HDC/ADB、离线/ready、替换/断开、过期响应、请求序列化、Bridge 选择、规范路由和两类结构化 409。 |

## UI 交互自动化审查

- 继续由 `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` 中的 `DTS-RELOAD-DEPLOY-001` 和条件操作 `DTS-RELOAD-DEPLOY-HW-001` 负责 `/dts-reload` 工作流；本修复改变已有工作流的目标发现，不新增 operation ID。
- 既有 fake-Bridge 验收继续负责部署 RPC 证据；下面的本地浏览器走查负责页面状态、协议切换、手动重试、离线错误、snapshot、截图、console 和 network 检查。
- 真实 Windows Bridge/HDC 运行没有用本地证据冒充，必须在部署机验收环境执行。

## 验证证据

### 自动化检查

- `npm test -- src/features/dts-reload/DtsReloadPage.test.tsx src/infrastructure/http/debuggingClient.test.ts src/application/bridge/bridgeTargetSession.test.ts`：最终协议/Bridge 时序改动后 3 个文件 / 67 项通过。
- `npm run test:server -- --run server/modules/debugging/routes.test.ts -t "connected bridge id|typed target-detection failure"`：增加两类结构化 route case 后 3 项通过。
- `npx tsc --noEmit --pretty false` 与 `git diff --check`：最终时序修改后通过。
- 之前的仓库门禁：`npm run ui:check` 通过；`npm run build` 通过；`npm run test:scripts` 948 项通过、5 项 skip；`npm run bridge:test` 138 项通过；`npm run test:server` 2746 项通过、8 项 skip。
- 最终 `npm test` 前端阶段中，410 个测试文件 / 3058 项测试仅有 1 项与本 issue 无关的失败：继承的 `src/App.test.tsx` 仍查找已移除的“注册”页签。`src/App.tsx` 与 `src/App.test.tsx` 未由本 issue 修改或暂存。

### 浏览器走查

- 路由：`http://127.0.0.1:5173/dts-reload`，API 模式，视口 `1440x900`、`768x1024`、`390x844`。
- 三个视口均保存 snapshot 和截图到 `work/ui-checks/issue-630/`；代表文件包括 `dts-reload-1440.snapshot.txt`、`dts-reload-1440-offline.snapshot.txt`、`dts-reload-768.snapshot.txt`、`dts-reload-390.snapshot.txt` 及对应 PNG；`playwright-cli` 截图为 `playwright-cli-1440.png`、`playwright-cli-768.png`、`playwright-cli-390.png`。
- 已实际点击“重新检测”；离线提示正确展示，浏览器 request 列表中离线路径没有 `POST /api/v1/debugging/targets/detect`。能正常完成的 API 项目/Bridge 请求返回成功。
- 因本地 Bridge 进程未运行，health endpoint 反复返回 `GET /local-bridge/health` 500；这些是环境错误，不是目标检测 409。in-app browser 未记录 JavaScript error；`playwright-cli` 将相同失败 health resource 记录为 console error。这里如实记录，不把它当作硬件就绪证据。
- 390px 截图仍能看到 Bridge 安装面板已有的横向裁切/溢出；Issue #630 没有增加布局样式，也没有改变这块无关界面。
- 尚未执行真实部署验收：Windows Bridge health、匹配 `bridgeId`、HDC 能力、Bridge-backed 200 target、无持续目标检测 409，以及多副本无亲和性负面检查均未在本机运行。

## 文档影响矩阵

| 范围 | 状态 | 证据 |
| --- | --- | --- |
| 仓库地图与 agent 指南 | Review | 没有新增子系统、路由、运行模式或安全边界。 |
| 计划与技术债 | Update | 本完成计划及中文 companion 记录实现和有界的目标环境后续；部署证据属于已有条件验收边界，不新增技术债。 |
| 产品规格 | No change | DTS reload 与 Device Bridge 产品行为已有定义，本次是缺陷修复。 |
| 架构与领域模型 | No change | 复用既有页面/gateway/Bridge seam，不增加领域实体或架构决策。 |
| API 契约 | Review | 现有规范检测 endpoint 只增加已支持的可选 Bridge ID；route 测试保留契约和结构化 409。 |
| 安全与治理 | Review | 服务端认证、组织过滤、撤销、连接池和审计行为未改变。 |
| 可靠性与运行手册 | Review | 单 API 和真实 HDC 证据边界仍是部署说明，本次不改变 runbook 行为。 |
| 质量与测试 | Review | 沿用既有 DTS reload 验收 ID，扩展页面、HTTP、Bridge-session 和 route 测试。 |
| 前端与设计 | Review | 复用既有 token 和 Bridge panel，在所需视口验证可见错误状态。 |
| 生成物与 references | No change | 没有 schema、OpenAPI、coverage 生成物或外部 reference 变化。 |

## 文档更新门禁

- [x] 本计划及中文 companion 位于 `completed/`，没有遗留 active 副本。
- [x] 已按实现范围检查每个 `Review` 行；不需要无关的架构、安全、运行时或验收地图改动。
- [x] 已记录本地验证证据和真实硬件证据边界。
- [x] 剩余真实设备或多副本工作已明确限定为部署验收，未在本计划中声称完成。

## Git 与 PR 工作流

实现始终在基于当前 `main` 的 `codex/actual-test-fixes-20260825` 分支完成。只提交 Issue #630 文件；继承的 `src/App.tsx` 与 `src/App.test.tsx` 仍保持未暂存。未来 PR、合入和本地 `main` 同步仍由父智能体/当前会话所有者负责。
