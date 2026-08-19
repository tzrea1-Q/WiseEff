# 本地评估账号加固

> Status: **Active**
> Date: 2026-08-19
> English: [`docs/exec-plans/active/2026-08-19-local-eval-auth-hardening.md`](../../../exec-plans/active/2026-08-19-local-eval-auth-hardening.md)

## 目标

在**对内评估 / 自托管试用**范围内补齐本地账号缺口，不建设企业身份（邮箱、邀请、MFA、OIDC 目标环境证据）。

四项交付：

1. 用户改密与 Admin 重置密码，并吊销其它会话。
2. 服务端强制的自助注册开关；关闭后认证页隐藏「注册」。
3. 登录/注册限流，以及失败登录审计。
4. 认证页说明：评估组织加入规则、用户名规则、角色说明、确认密码、无 Admin 时的 bootstrap 提示。

## 非目标

邮箱验证、邀请链接（TD-119）、MFA、目标环境 OIDC 证据（TD-020）、HttpOnly Cookie / CSRF / refresh 轮换、邮件找回密码。

## Git 与 PR

实现分支：`cursor/local-eval-auth-hardening-5336`（从最新 `main` 检出）。实现代理只在该分支提交；由父代理开/合 PR。

## 架构

- 继续使用 `AUTH_PROVIDER=local`。新增环境变量：
  - `AUTH_LOCAL_SELF_REGISTER`（默认 `true`）
  - `AUTH_LOCAL_AUTH_MAX_ATTEMPTS`（默认 `10`）
  - `AUTH_LOCAL_AUTH_WINDOW_MS`（默认 `60000`）
- 未认证可读的 `GET /api/v1/auth/local-config` 告诉前端是否开放自助注册、是否已有本地 Admin、评估组织显示名。
- `POST /api/v1/me/password` 校验当前密码、更新 scrypt 哈希、吊销其它会话、保留当前会话。
- `POST /api/v1/users/:userId/password` 需要 `users:manage`，写入新密码并吊销该用户全部会话。
- 进程内滑动窗口限流，键为客户端 IP + 用户名（注册另按 IP）。多副本各自计数，评估部署可接受。
- 失败登录写 `auth-event` / `login-failed`（用户名未知时 actor 可为 null；组织尽量落到评估组织）。
- 新错误码 `RATE_LIMITED` → HTTP 429。

## 任务

- [x] 计划与验收 ID
- [x] 后端：配置、限流、改密/重置、会话吊销、失败登录审计、local-config
- [x] 前端：认证页、资料改密、Admin 重置
- [x] 文档 + OpenAPI
- [x] 测试、`npm run build`、`npm run docs:check`

## 验证

- 针对性 vitest：auth / users / env / App / UserPermissionsPage / presentError
- `npm run build`、`npm run docs:check`、`npm run contract:check`
- playwright-cli 在认证页与 `/organization/members` 上检查 1440×900 / 768×1024 / 390×844

## 文档影响矩阵

与英文版同一矩阵：规划、产品上手、API 认证/错误、FRONTEND、SECURITY、自托管 runbook、环境变量、验收覆盖图、生成 OpenAPI。
