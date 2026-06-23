# 本地 Device Bridge 运行手册

> English: [English](../../runbooks/local-device-bridge.md)

本手册用于 WiseEff Local Device Bridge Phase 1（本地/自托管）操作，包括配对、连通性检查与条件验收执行。

## 适用范围

- Phase 1 以 Windows 优先的 Bridge 配对与运行时为主。
- Bridge-backed 会话仍受后端调试权限、lease、确认 token、快照回滚与审计约束。
- 本文关注本地/自托管操作流程，不覆盖托管云发布流程。

## 必需环境变量

服务端运行变量：

```text
DEVICE_BRIDGE_ARTIFACT_ROOT=ops/self-hosted/bridge-artifacts
DEVICE_BRIDGE_PAIRING_TTL_SECONDS=300
DEVICE_BRIDGE_TOKEN_TTL_DAYS=90
DEVICE_BRIDGE_WS_PATH=/api/v1/device-bridges/ws
```

条件验收变量：

```text
DEVICE_BRIDGE_LAB_AVAILABLE=true
DEVICE_BRIDGE_SERVER_URL=https://<你的-wiseeff-域名>
```

可选验收辅助变量：

```text
DEVICE_BRIDGE_LAB_USER_ID=u-xu-yun
DEVICE_BRIDGE_LAB_ENABLE_WRITE=false
DEVICE_BRIDGE_LAB_WRITE_VALUE=3150
DEVICE_BRIDGE_LAB_CONFIRM_WRITE=confirm-high-risk-write
```

## 制品与 Manifest 检查

1. 确认 `DEVICE_BRIDGE_ARTIFACT_ROOT` 下存在 Bridge 制品。
2. 验证 manifest 接口：
   - `GET /api/v1/device-bridges/releases`
3. 确认包含 Windows AMD64 条目，且下载地址为同源相对路径：
   - `/downloads/device-bridge/<version>/windows/amd64/...zip`

## 配对流程

1. 已认证用户申请配对码：
   - `POST /api/v1/device-bridges/pairing-codes`
2. Bridge CLI 交换配对码：
   - `POST /api/v1/device-bridges/pair`
3. Bridge 保存 `bridgeToken` 并发起：
   - `WSS /api/v1/device-bridges/ws`，请求头 `Authorization: Bridge <token>`
4. 运维校验 Bridge 归属与列表：
   - `GET /api/v1/device-bridges/mine`

## 调试执行检查

通过 `/api/v1/debugging/*` 验证 bridge-backed 行为：

- detect 返回包含 `bridge:<bridgeId>:...` 目标 id
- 创建 session 后持久化 `execution_mode=bridge`
- 高风险写入缺少确认 token 时返回校验失败
- 带 `confirm-high-risk-write` 的高风险写入成功并生成快照元数据

## 条件验收执行

仅在本地 Bridge lab 可用时执行：

```bash
DEVICE_BRIDGE_LAB_AVAILABLE=true \
DEVICE_BRIDGE_SERVER_URL=https://<你的-wiseeff-域名> \
npm run acceptance:e2e -- e2e/acceptance/local-device-bridge.acceptance.spec.ts
```

未设置 `DEVICE_BRIDGE_LAB_AVAILABLE=true` 时，该验收默认 skip。

## 排障建议

- **Manifest 缺少 Windows 制品**：检查 `DEVICE_BRIDGE_ARTIFACT_ROOT` 与制品目录结构。
- **Bridge WebSocket 被拒绝**：检查 token TTL/scope 与服务器时间偏差。
- **detect 只有服务端目标**：确认 Bridge 在线（`/device-bridges/mine`）且已连接 WS 路径。
- **写入被拒绝**：确认角色具备 `debugging:write`，高风险参数需 `confirm-high-risk-write`。
- **回滚冲突或拒绝**：检查 lease/session 归属与 snapshot 状态。
