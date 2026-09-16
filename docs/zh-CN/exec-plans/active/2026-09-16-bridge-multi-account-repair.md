# 本地 Device Bridge 多账号重新绑定

> English: [English](../../../exec-plans/active/2026-09-16-bridge-multi-account-repair.md)

## 目标

账号 A 可以完成本机 Bridge 配对。切换到账号 B 后，页面必须要求 B 用**新配对码**重新绑定同一台机器，把本机进程切到 B 的 bridge id/token，然后自动检测设备。`GET /api/v1/device-bridges/mine` 继续按用户 + 组织隔离。B 不能列出、重命名、撤销或通过调试接口使用 A 的 Bridge。

## Git 与 PR

- Scratch 分支：`fix/bridge-multi-account-repair`，基于最新 `origin/main`
- 停止边界：聚焦测试 + `npm run build` + `npm run bridge:package:check`；实现代理不创建 GitHub PR
- 证据：前端向导/面板/DTS reload/节点调试测试、Bridge 运行时测试、配对/路由/仓库测试、调试服务隔离、安装包一致性

## 公开缝合点

- Web：重连后的最新本地 `/health` + 当前用户 `/mine`
- Bridge CLI：`connect --code` 强制重启并等待**新的** `bridgeId`
- API：pair 只为配对码所属用户创建或复用机器 Bridge

## 文档影响矩阵

| 区域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | 不变 | `AGENTS.md`、`ARCHITECTURE.md` |
| 计划文档 | 更新 | `docs/PLANS.md`、`docs/zh-CN/PLANS.md`、本计划 |
| 产品规格 | 不变 | 调试仍按账号持有 |
| 架构 / 前端 | 更新 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` |
| 质量 / 测试 | 更新 | `docs/developer/verification-matrix.md`、`docs/zh-CN/developer/verification-matrix.md` |
| 可靠性 / 运行手册 | 更新 | `docs/runbooks/local-device-bridge.md`、`docs/zh-CN/runbooks/local-device-bridge.md` |
| 安全 / 治理 | 复核 | `/mine` 的用户+组织隔离未扩大 |
| 生成制品 | 更新 | `ops/self-hosted/bridge-artifacts/0.1.1/` |
| 安装器文档 | 更新 | `ops/self-hosted/bridge-installer/README.md`、`README.zh-CN.md` |

## 文档更新门禁

以上 Update 行已在本次变更中修改。安全复核：`/mine`、撤销、重命名、调试 detect/session 仍按 `userId` + `organizationId` 查询，没有增加组织级 Bridge 可见性。

## 验证

见英文计划中的命令列表。
