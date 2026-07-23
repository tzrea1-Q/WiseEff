# API 认证

> English: [English](../../api/authentication.md)

WiseEff 支持四类认证运行方式：本地开发认证、用于本地 smoke 的 HMAC bearer token、WiseEff 本地账号，以及 M6.2 自托管身份路径使用的 OIDC/JWKS bearer token。

## 开发模式

开发认证通过以下配置启用：

```text
AUTH_MODE=development
```

开发请求可以传入：

```text
x-wiseeff-user: <seed-user-id>
```

该模式只用于本地开发和测试，不是生产身份边界。

## OIDC 生产模式

目标自托管生产身份推荐使用 OIDC：

```text
AUTH_MODE=production
AUTH_PROVIDER=oidc
AUTH_OIDC_ISSUER=https://id.example.com/realms/wiseeff
AUTH_OIDC_AUDIENCE=wiseeff-api
AUTH_OIDC_JWKS_URI=
```

请求必须携带：

```text
Authorization: Bearer <oidc-access-token>
```

API 通过 discovery/JWKS 校验 issuer、audience、expiration、not-before 和签名。`AUTH_OIDC_JWKS_URI` 在 issuer discovery 文档暴露 `jwks_uri` 时可以留空。

Access token 必须包含 `sub` 和组织声明。OIDC token 只证明身份；WiseEff 会按 token 的组织和 `sub` 从 PostgreSQL 加载有效用户、激活状态、角色和权限。只有当 token 包含 `email_verified=true` 时，才允许用 email 作为迁移期 fallback 绑定。管理员在 WiseEff 用户治理中修改角色后，API 授权会从数据库立即生效，不依赖 IdP role claim 更新。

`wiseeff_roles` 可以用于 bootstrap 诊断或兼容，但 M6.2 之后生产授权不以它作为最终来源。若存在该 claim，角色 id 必须属于支持集合：

```json
[
  { "projectId": null, "roleId": "admin" },
  { "projectId": "aurora", "roleId": "hardware-user" }
]
```

支持的角色 id 是 `guest`、`hardware-user`、`software-user`、`hardware-committer`、`software-committer` 和 `admin`。不支持的角色 id 会被拒绝。

## 本地账号生产模式

WiseEff 自有本地账号通过以下配置启用：

```text
AUTH_MODE=production
AUTH_PROVIDER=local
```

该 provider 使用 PostgreSQL 保存凭据和会话，并提供以下账号生命周期路由：

| 路由 | 用途 |
| --- | --- |
| `POST /api/v1/auth/register` | 使用所选组织和允许自助选择的平台角色注册本地账号。非 Committer 角色返回带 session 的 `201`；Committer 申请返回无 token 的 `202 pending_approval`。 |
| `POST /api/v1/auth/login` | 使用用户名和 password 换取本地会话 token。 |
| `POST /api/v1/auth/logout` | 撤销当前本地会话 token。 |
| `GET /api/v1/me` | 返回已认证用户的 `AuthContext`。 |
| `PATCH /api/v1/me/profile` | 更新当前用户的姓名和职务。 |
| `POST /api/v1/users` | 让 Admin 在当前组织中创建已启用的本地账号，并设置用户名、初始密码、职务和角色绑定。 |
| `GET /api/v1/users/registration-role-requests` | 让 Admin 查看待审批的本地 Committer 注册申请。 |
| `POST /api/v1/users/registration-role-requests/:requestId/approve` | 让 Admin 批准待审批的 Committer 角色申请。 |
| `POST /api/v1/users/registration-role-requests/:requestId/reject` | 让 Admin 拒绝待审批的 Committer 角色申请。 |

注册请求包含 `organization`、`name`、`username`、`roleId` 和 `password`。自助注册组织选项为 `硬件部` 和 `软件部`。自助注册永远不接受 `admin`；申请 `hardware-committer` 或 `software-committer` 时，账号会以 inactive 状态创建，先写入对应基础 User 角色，并创建待 Admin 审批的角色申请。该路径不会创建 session token，密码登录也会在审批前被拒绝；只有审批通过后才激活账号并授予申请的 Committer 角色。本地账号不再保存或返回 email 地址，用户名就是本地登录标识。当前暂时不支持邮箱验证，因此注册不能被当作已验证域名 onboarding 或邀请接受流程。

管理员创建用户不走自助注册，而是使用 `POST /api/v1/users`。请求包含 `name`、`username`、`password`、可选 `title` 和 `roles`；后端会在一个事务中创建用户、密码凭据、角色绑定和审计事件。这类账号会立即启用，包括 Committer/MDE 角色，因为该操作本身已经要求 `users:manage` 权限。响应和审计 metadata 都不能返回或记录明文密码、密码哈希。

在本地开发 profile（`NODE_ENV=development`、`AUTH_MODE=production`、`AUTH_PROVIDER=local`）下，自助注册账号会刻意加入已 seed 的 `org-chargelab` / `ChargeLab` 演示组织，从而能看到本地种子参数、日志和调试数据。同一 development profile 下，`db:seed:m0` 还会为 ChargeLab 演示 persona upsert 固定 username 与共用演示密码（见 [本地开发](../developer/local-development.md) 中的演示登录说明）；非 development 的 seed 不写这些凭据。非开发的本地账号部署仍使用所选部门组织 id（`org-hardware-department` 或 `org-software-department`），以保留租户隔离语义。

密码只以 salted `scrypt` 哈希保存在 `user_password_credentials`。只有登录成功或非 Committer 注册成功才会在响应中返回一次不透明的 `we_local_*` bearer token；待审批 Committer 注册和管理员创建本地账号都不会在创建响应中返回 session token。数据库 `auth_sessions` 只保存 SHA-256 token 哈希。会话会按服务 TTL 过期，退出登录会写入 `revoked_at`。注册、登录、退出、资料更新、管理员创建用户、角色替换和启停账号都会写审计事件。

登录后的请求使用：

```text
Authorization: Bearer <we_local_session_token>
```

本地会话解析仍会通过 WiseEff PostgreSQL 重新加载激活状态、角色和权限，并返回与 OIDC/HMAC 相同的 `/api/v1/me` 结构。被停用的用户或没有有效角色绑定的用户不能靠旧 token 继续访问。

本地账号适合自管理评估环境或尚未接入外部 IdP 的部署。需要 SSO、MFA、身份生命周期联邦和浏览器 token refresh 的目标企业部署仍应使用 `AUTH_PROVIDER=oidc`。

## 本地 HMAC Smoke 模式

本地 smoke 认证通过以下配置启用：

```text
AUTH_MODE=production
AUTH_PROVIDER=hmac
AUTH_TOKEN_ISSUER=wiseeff-local
AUTH_TOKEN_HMAC_SECRET=<secret>
```

请求必须携带：

```text
Authorization: Bearer <base64url-json-payload>.<hmac-sha256-signature>
```

签名声明必须包含 issuer、subject 和 organization。角色和权限只取自签名声明。该 profile 只用于本地 smoke/test 流程，不能作为目标环境身份验收证据。

## Smoke Token

M5 smoke 接受：

```text
M5_SMOKE_AUTHORIZATION
WISEEFF_SMOKE_AUTHORIZATION
```

探测 `/api/v1/operations/pilot-readiness` 时应使用包含 `admin:access` 的 token。

不要提交真实 staging 或 production bearer token。
