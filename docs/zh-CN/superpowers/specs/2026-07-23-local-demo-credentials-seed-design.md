# 本地 Development 演示账号种子 — 设计

> 日期：2026-07-23  
> 状态：已批准实现  
> English: [`docs/design-docs/2026-07-23-local-demo-credentials-seed-design.md`](../../../design-docs/2026-07-23-local-demo-credentials-seed-design.md)  
> 分支：`feat/local-demo-credentials-seed`

## 问题

M0 已种 ChargeLab 七个演示用户与角色绑定，但不写 `user_password_credentials`。本地 API 默认 `AUTH_MODE=production` + `AUTH_PROVIDER=local`，这些 persona 无法密码登录，只能 bootstrap / 自助注册（Committer 还需 Admin 审批），按角色测 UI 成本高。

## 目标

- `NODE_ENV=development` 下跑完 M0 后，各种子角色可用**固定 username + 共用演示密码**登录。
- 非 development 的 seed 仍保持无演示密码。
- 复用现有 scrypt 哈希与 login，不为此开 auth bypass。

## 非目标

- 改 mock 的 `activeRoleId` 切换。
- 把演示密码带进生产/客户库。
- 取代空库上的 `admin:bootstrap`。
- 每人不同密码，或以邮箱登录。
- 自动批准任意自助注册的 Committer。

## 设计

### Gate

仅当 `process.env.NODE_ENV === "development"` 时执行 `seedLocalDemoCredentials`；否则打日志跳过，不写演示凭据。

### 账号

共用密码：`WiseEff-Dev!`

| Username | User ID | 种子权限（M0+M1 后） |
|---|---|---|
| `xu.yun` | `u-xu-yun` | 组织级 `admin` |
| `zhao.heng` | `u-zhao-heng` | `hardware-user` |
| `liu.min` | `u-liu-min` | `software-user` |
| `wang.jie` | `u-wang-jie` | `hardware-committer` |
| `chen.na` | `u-chen-na` | `software-user` |
| `li.peng` | `u-li-peng` | `hardware-committer` |
| `sun.mei` | `u-sun-mei` | `software-committer` |

username 须通过 `validateLocalAccountUsername`。

### 实现形状

1. 抽出 helper（建议 `server/modules/auth/seedLocalDemoCredentials.ts`，由 `scripts/seed-m0.ts` 调用）：账号表 + 共用密码常量；`hashLocalAccountPassword`；对 `user_password_credentials` 按 `user_id` upsert。
2. 在 `seedM0Foundation` 末尾（用户/角色/admin 绑定之后）调用。
3. development 重跑 seed 幂等：同 `user_id` 重置为演示 username/密码。
4. username 被其他用户占用则 seed 失败并给出清晰错误（清凭据或 wipe volume）。

### 文档

中英 `local-development` 增加账号表与 development-only 说明；中英 `authentication` 注明 development M0 后可用这些账号登录（空库仍可用 bootstrap）。

### 测试

扩展 `seed-m0.test.ts`（或 helper 单测）：development 写入七个 username；非 development 不写；常量 username 通过策略校验。

## 验收

- 新本地库 + development M0（及常规 M1+）：`xu.yun` / `WiseEff-Dev!` 得 Admin；`wang.jie` 同密码得 hardware-committer。
- `NODE_ENV=production` 跑同一 seed 不产生这些凭据行。
- register / bootstrap / OIDC 路径不变。
