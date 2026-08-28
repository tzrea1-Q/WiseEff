# 组织管理设计

> English: [English](../../design-docs/2026-08-19-organization-administration-design.md)
> 状态：**锁定设计**——D1–D11 于 2026-08-19 经拷问式设计会话敲定
> 日期：2026-08-19
> 执行计划：[`docs/zh-CN/exec-plans/completed/2026-08-19-organization-administration.md`](../exec-plans/completed/2026-08-19-organization-administration.md)
> ADR：[ADR-0037](../../adr/0037-organization-administration-is-home-org-tenant-operations.md)（英文）

## 定位

组织管理是把 Organization **当作自身**来运营的产品：成员、入职、组织档案。它不是 Organization-scoped governance（ADR-0001 / ADR-0015）——那条轴仍然只表示规格、模块、overlay、日志域、知识库相对项目的 catalog 作用域。

当前缺口是：Organization 只是安全戳（`id`、`name`、`created_at`），本地注册却把硬件部 / 软件部装成租户。开发环境其实已经把注册打进 ChargeLab，下拉是假的。

## 锁定决策

| ID | 决策 |
| --- | --- |
| D1 | 新产品是**组织管理**，不是把参数后台的组织配置再加厚。 |
| D2 | **Organization** 是租户边界（一家公司或一次部署的客户）。硬件 / 软件是 **Role discipline**。 |
| D3 | 产品只运营调用者的 **home organization**。没有组织目录、创建、归档、切换。库里可以有多余行，那是 bootstrap 或夹具。 |
| D4 | 入职通道：本地自助注册且组织隐含；目标环境走 OIDC JIT + Admin 开账号。邀请是后续（TD-119）。 |
| D5 | **Project member** 不在本产品。组织成员资格不是项目访问权。 |
| D6 | 本地注册加入 **Evaluation Organization**（种子档案里是 ChargeLab）。部门组织不再是加入目标；已有成员迁到部署的 home organization。隔离测试用夹具组织，不用产品里的「部门」。 |
| D7 | 侧栏「组织管理」替换「用户管理」。规范路径 `/organization`（组织档案）与 `/organization/members`（人员管理），切换方式对齐调试后台范围对等页。`/user-permissions` 永久重定向到 `/organization/members`。参数后台组织子导航不动。 |
| D8 | 档案展示只读 `id`、`created_at`，以及可改的**显示名**。v1 不做 slug、logo、时区、归档。 |
| D9 | `users:manage` 可改名。显示名是非空、有长度上限的标签，**不**做全局唯一。改名走审计写。 |
| D10 | 本地 Admin bootstrap：有 ChargeLab 就加入；否则用 bootstrap 名称创建或加入恰好一家（中性默认名，不再是硬件部）。0 家或多家且没有明确目标则 fail-closed。 |
| D11 | OIDC 语义不动：token 的 `organization_id` claim 就是 Organization。登录路径不把部门式 id 重写掉。 |

## 领域模型

| 概念 | 规则 |
| --- | --- |
| Organization | 租户边界。用户、项目、一切组织级 catalog 只属于一个。 |
| Home organization | `AuthContext` 上唯一的 Organization。个人资料不能改它。 |
| Organization membership | 属于该 Organization。不是项目 ACL。 |
| Organization display name | 可改的标签。身份仍是 `organizations.id`。 |
| Evaluation Organization | 本地自助注册加入的那一家。种子档案里是 ChargeLab。 |
| Role discipline | 平台角色的硬件或软件侧。永远不是 Organization。 |
| Project member | 预留。本产品不交付。 |

场景：

- **硬件与软件审同一块板。** 张三（hardware-user）和李四（software-committer）本地注册后都进 ChargeLab，都能看见 Aurora。学科与组织无关。
- **试点 Admin 改掉 ChargeLab。** 显示名变成客户公司名，`id` 仍是 `org-chargelab`。重新拉取 `/api/v1/me` 即新名。审计记录新旧名。
- **自托管本地没有种子。** bootstrap 用中性名创建一家 Organization。注册加入这一行，不会再造硬件部。
- **OIDC 仍发 `org-software-department`。** 该用户仍进那一行。运营改 IdP 或做数据迁移。登录不会偷偷并租户。
- **不该看见尚未公布的板。** v1 不做。组织内成员仍看见全部项目。

## 产品面

一个侧栏入口、两条范围页，权限仍是 `users:manage`（与今天的用户治理相同）：

1. **组织管理**（`/organization`）— 可编辑显示名，只读 id 与创建时间。
2. **人员管理**（`/organization/members`）— 今天的用户目录：开账号、换角色、启停、永久注销非当前用户、Committer 审批。没有项目列。注销会清除账号自有状态，保留业务与审计历史，并将其中的用户引用置为 `null`。

侧栏文案：组织管理。旧深链 `/user-permissions` 重定向到 `/organization/members` 并保留查询串。

## 入职

| 运行时 | 加入方式 |
| --- | --- |
| 本地评测（`AUTH_PROVIDER=local`） | 自助注册，无组织下拉。加入 Evaluation Organization（有种子则 ChargeLab，否则 bootstrap 那一家）。Committer 仍待审批。Admin 不能自助注册。 |
| 目标环境（`AUTH_PROVIDER=oidc`） | IdP claim + 现有 JIT。在仍存在的用户治理路径上，Admin 仍可开账号。 |
| 以后 | 邀请链接或邮箱（TD-119）。 |

`POST /api/v1/auth/register` 不再要求部门组织字段。仍发送 `organization: "硬件部"` 的客户端在计划写明的短兼容窗口内被忽略或拒绝——不得再创建 `org-hardware-department`。

## 组织写入 API

- `GET /api/v1/organization` — 调用者的 home organization。
- `PATCH /api/v1/organization` — 仅 `{ name }`；`users:manage`；审计 `organization-update`。
- 现有 `/api/v1/users*` 保留。没有 `/api/v1/organizations` 集合。

## 非目标（v1）

- 组织目录、创建、归档、切换（TD-120）。
- 项目成员 / 项目级角色（TD-121）。
- 邀请、邮箱验证、域名加入（TD-119）。
- 把 Tenant 和 Department 拆成两个实体。
- 新权限 `organization:manage`。
- OIDC claim 重映射。
- 把 `org-chargelab` 当作标识来改名。

## 权限与审计

不新增权限键。`users:manage` 覆盖成员和显示名。`platform-admin` 仍不能列出其它 Organization 的用户。改名与用户变更仍是与领域写同一事务的 High 级审计写（ADR-0027）。
