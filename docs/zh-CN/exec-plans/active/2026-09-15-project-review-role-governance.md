# 项目审核角色治理正式方案

> English: [English](../../../exec-plans/active/2026-09-15-project-review-role-governance.md)

**状态：** 待采纳的正式方案，尚未开始实施。  
**源码基线：** 2026-09-15 核对的 `main@3a49ba62685523742bac0d212ea2d652ce3f8e88`。  
**目标：** 管理员通过产品界面配置项目审核角色，普通账号完成参数提交、硬件审核、软件审核和合入，全程无需终端配置。修改角色必须保留其他范围的授权，也不能扩大到配置范围之外。

## 1. 问题依据与范围

“缺少审核候选人”属于真实的提交前置条件不满足。目前尚未取得部署项目的实际角色清单；源码能确认产品能力缺口，但不能据此决定应给哪些员工授权。

| 已确认的当前实现 | 影响 |
| --- | --- |
| `server/modules/parameters/reviewWorkflowRepository.ts`：候选人必须是本组织、启用状态，并具有该项目的精确角色绑定；软件 MDE 也能进入软件开发候选池。 | 仅给账号配置组织级 MDE，不会自动成为项目候选人。 |
| `src/UserPermissionsPage.tsx`、`src/infrastructure/http/userGovernanceClient.ts`：组织管理提交一个角色，并把返回的第一个绑定转换成 `roleId`。 | 缺少项目角色入口，前端也丢失了完整的授权范围信息。 |
| `server/modules/users/service.ts`、`repository.ts`：替换角色时删除该用户在组织内的全部绑定；注册角色审批也调用此操作。 | 修改组织角色可能清空项目角色。需要在共享写入处覆盖全部生产调用方。 |
| `server/modules/auth/repository.ts`：组织与项目角色的内置权限被合并到全局权限集合。 | 新增项目 MDE 可能增加全局能力，必须先修正作用域再开放配置。 |
| `server/modules/parameter-kernel/policy.ts`、`parameters/service.ts`：审核按角色授权，指定处理人不是独占执行限制；组织角色及管理员例外也能获得阶段权限。 | 必须一起定义候选发现、阶段执行以及“指定处理人”的含义。 |
| `docs/adr/0037-organization-administration-is-home-org-tenant-operations.md` 与 TD-121 | 组织管理曾明确排除项目成员产品。本方案只补项目审核角色，不宣称完成通用项目成员或项目可见性访问控制。 |

交付一条完整流程：按范围更新角色和计算权限、项目配置、候选就绪检查、进行中单据处理、有存量数据的部署验收。复用 `user_role_bindings`、已有审核状态、审计和界面组件。不引入自定义角色、部门、切换组织、项目邀请、通用项目可见性迁移、自动批量授权或新工作流引擎。

本方案需要重新确认 ADR-0037 中“项目角色尚未作为产品交付”的边界；保留“本组织”隔离和“不放进 `/organization` 管理”的原则。采纳后记录一个范围明确的后续决策，并在 TD-121 中区分已交付的审核角色与仍待规划的项目访问控制，不能整体关闭 TD-121。

## 2. 推荐产品规则

以下是建议采纳的实施合同，不代表部署环境已具备这些行为。

| 概念 | 正式规则 |
| --- | --- |
| 组织角色 | 决定账号在本组织的通用能力。编辑时只修改组织范围的内置角色。 |
| 项目审核角色 | 显式绑定到一个项目的内置业务角色，提供本项目的参数能力及对应审核阶段资格；不增加全局调试、知识、日志或管理员权限。 |
| 候选池 | 本组织、启用状态、具备精确项目角色的全部用户。只有组织角色、管理员身份或其他项目角色均不足以入选。每个池按用户 ID 去重。 |
| 本轮处理人 | 提交时选定的阶段负责人和通知接收人。保留当前按角色候选池执行的规则：本项目当前具备对应阶段资格的其他用户也能处理；不新增独占执行规则。 |
| 配置权限 | 本组织启用状态的管理员，同时具备 `users:manage` 和组织范围的 `admin` 或 `platform-admin`；服务端核验项目与用户归属。历史上带项目范围的管理员角色不能据此取得配置权。 |
| 管理员介入 | 保留显式、可审计的组织管理员介入已有审核单据的通道。界面区分介入与普通候选资格；管理员身份不能自动补足新提交缺失的角色。 |

| 界面名称 | 存储角色 | 可承担的阶段 |
| --- | --- | --- |
| 硬件 MDE | `hardware-committer` | 硬件审核 |
| 软件 MDE | `software-committer` | 软件审核，也可承担软件合入 |
| 软件开发 | `software-user` | 软件合入 |

每类角色可以配置多人。新一轮提交前，三个候选池都必须至少有一个有效候选人。软件 MDE 可以兼任软件合入，因此两个人即可覆盖三个位置。保留同一人被显式授予多个角色的能力；本轮不新增职责分离或禁止自审规则。管理员要进入普通候选池，也需要显式的项目业务角色。

保留组织范围的参数查看、编辑授权，包括前面修复的参数读取行为。普通阶段执行改为要求精确的项目审核角色，与候选发现一致；这是有意取消原有的组织级 MDE 审核回退。撤销项目审核角色后，即使账号仍是组织 MDE，也失去该项目的这项职责。停用账号立即阻止全部主动执行。修改组织角色不隐式删除独立授予的项目角色，账号界面需要解释这一区别。

## 3. 用户流程

1. 在现有项目管理列表的每行、移动端卡片增加“审核角色”。打开项目范围页面，建议路由为 `/parameter-admin/projects/:projectId/review-roles`，支持直接访问、刷新、返回项目列表。保持已有源码和配置工作台的交互。
2. 页面展示三个候选池、缺失提示，以及包含三项角色复选框的用户编辑区。从现有本组织用户目录搜索人员。已经被配置但已停用的人保留显示，并标明不可用；只能给启用账号新增角色，允许移除停用账号的角色。每次原子保存一个用户在这个项目的角色，保存前展示范围和前后差异；不提供看似全项目原子保存、实际逐人提交的按钮。
3. 进入参数项目时以及提交前显示审核就绪状态，指出具体缺少哪一类。具备权限的管理员可直接进入项目配置；普通用户收到明确的联系管理员提示。请求加载中、失败与真正的空候选池分别展示。
4. 配置保存后、返回参数项目时、提交前刷新候选与就绪状态。仍然有效的选择继续保留；失效的选择清空并说明原因。就绪检查失败或角色冲突时保留参数值、暂存草稿和修改原因。服务端在提交事务内重新验证。
5. 组织管理中分别显示组织角色与项目职责。项目职责链接到项目管理，不随组织角色表单一起编辑。不再用 `roles[0]` 推断组织角色；保留完整绑定，并明确展示历史上存在的多个组织角色。
6. 进行中的审核保留提交时的处理人和决策历史。被指定的人失效时，显示其不可用状态和当前可处理该阶段的候选池。其他合格候选人或显式管理员介入可以继续；不能静默改派、伪造审批、跳过阶段或重置已完成的决策。提交人仍可按现有能力撤回。采用角色池模式后，本轮无需另建专门的改派功能。

## 4. 服务端与 API 合同

### 4.1 按范围写入及兼容

继续由 users 模块统一拥有角色写入。共享操作负责校验范围、锁定目标用户行、比较规范化后的当前角色集合与预期集合、只更新自己管理的子集，并在同一事务中记录审计。全部生产写入必须遵循同一加锁约定，包括组织角色审批、停用和删除。在引入工作流锁前确定唯一的锁顺序，用真实 PostgreSQL 验证相反顺序的并发操作。

| 建议 API | 合同 |
| --- | --- |
| `GET /api/v1/projects/:projectId/workflow-role-bindings` | 仅管理员可见的项目角色清单，包含停用账号的绑定和各候选池就绪状态。选人复用已授权的用户目录，不向普通提交人暴露完整账号信息。 |
| `PUT /api/v1/projects/:projectId/workflow-role-bindings/:userId` | `{roles: RoleId[], expectedRoles: RoleId[]}`，只允许上述三类角色。`roles` 为空代表移除这个用户在该项目的这三类角色。比较与更新范围严格限定在本项目的这三类角色。 |
| `PUT /api/v1/users/:userId/organization-roles` | 对组织范围的内置角色使用相同的预期集合合同。保留所有项目绑定及另行管理的 Catalog 能力绑定；保留防止自我锁死和平台管理员授予、撤销限制。 |
| 现有 `PUT /api/v1/users/:userId/roles` | 只含组织角色的请求适配为组织范围更新，保留项目及能力绑定。包含项目角色的旧请求明确拒绝并返回可操作的废弃提示，不能留下第二条全量覆盖通道。迁移全部第一方调用，包括注册审批和账号创建；公开账号创建不能夹带项目授权。 |
| 现有 `GET /api/v1/projects/:projectId/parameter-workflow-assignees` | 保留三个候选数组，增加服务端计算的 `ready`、`missingRoles`，不暴露管理员专用目录。检查项目属于当前组织，并检查相应项目的读取、编辑范围。 |

新写入拒绝重复、格式错误、不支持及跨范围的身份。审计记录操作者、组织、项目、目标用户、变更前后角色与请求 ID，不包含凭据或参数值。角色变更与审计必须同时提交或同时回滚。通知仅复用现有流程需要的站内通知。

并发控制采用“比较后更新”：加锁、规范化、鉴权后比较。如果实际状态已等于目标状态，直接成功，不重复产生变更或通知。否则预期集合过期时返回 `CONFLICT`，使用稳定细分代码，例如 `role-bindings-stale`；界面刷新后让操作者重新查看差异。这是按当前状态的并发保护，不证明期间没有发生过其他修改。响应丢失后读取状态核实，不盲目恢复旧的全量角色清单。迁移前的组织范围旧请求，在其明确的组织范围内仍是后写覆盖，但绝不能删除项目角色。

不增加第二份角色存储或通用授权框架，也不预设必须增加数据库迁移。写入处规范化自己管理范围内的重复行，读取时去重；若确需全局唯一约束，必须先盘点存量数据和全部写入来源。

### 4.2 权限作用域前置条件

内置全局权限只从组织范围角色计算。保留已有 Catalog 能力解析及其独立作用域合同。带项目身份的参数操作，根据组织授权加本项目业务授权计算，其他项目角色不能参与。项目角色不能增加全局设备写入、知识写入、日志或管理员权限。

检查被修改鉴权函数的全部调用者，而不只检查新增页面：身份构造、`/me`、参数读取／编辑／关键参数编辑／审核／合入、Catalog 项目读取、Agent 权限及前端导航和操作投影。只有项目角色的账号仍须能够进入并操作其获准项目；仅从全局集合删除权限、却不修复这些消费者，属于未完成。没有解析出项目的请求可以发现允许的项目，但不能用不明确的范围授权项目写入。对调试、日志、知识各选代表性的拒绝用例验证边界，不重做这些产品。

保留用户、Agent、系统调用来源和敏感节点合入门禁，不能构造特权身份来补足候选资格。

### 4.3 候选发现、提交和执行

候选发现、提交校验及普通审核、合入使用同一份角色与阶段资格定义。在事务中从数据库读取所选用户或实际操作者的当前状态，检查组织、项目和启用状态，并与撤权串行化。撤权先提交时，后续阶段操作必须拒绝；阶段操作先完成授权并取得串行执行顺序时，可以在撤权前完成。不能只依赖请求开始时的 `AuthContext` 快照。

每次新的普通参数提交都必须拥有三个候选池和三个明确、有效的处理人，包括直接 HTTP 请求和结构化编辑适配器；省略处理人不能绕过门禁。盘点并迁移全部 `submitParameterChanges` 调用方。已经存储的无处理人历史轮次继续可读，按当前阶段角色池授权；测试数据创建不构成生产例外。项目初始化审核采用自己的工作流，不在本轮改动范围。审核时只验证当前阶段资格；前一阶段审核人之后被撤权，不抹除已经提交的决策。后续阶段暂时无人可处理时，单据停留在该阶段等待角色补齐，不删除草稿、值或历史，也不生成替代决策。

## 5. 实施顺序和工作范围

一条功能分支、一次协调发布。四项工作按依赖顺序完成，不作为四个独立可部署补丁。

| 任务 | 修改与主要位置 | 完成证据 |
| --- | --- | --- |
| P1：权限和写入安全，R3 | `server/modules/auth/{repository,policy}.ts`；`server/modules/users/{routes,schemas,service,repository}.ts`；`server/modules/parameter-kernel/policy.ts` 及直接策略消费者。先固定角色权限矩阵和全部写入来源。 | 真实 PostgreSQL 下，授权保留、权限边界、过期写入、并发撤权和审计回滚的先失败后通过测试。 |
| P2：项目审核角色配置，R2，依赖 P1 | `src/components/parameter-admin-next/ProjectsOperationsPanel.tsx`、`src/components/admin/ProjectAdminTable.tsx`、新项目审核角色视图、用户治理端口／客户端／类型、`src/UserPermissionsPage.tsx` 及 API 接线。 | 管理员真实配置、普通用户拒绝、冲突恢复、组织角色变更保留项目角色。 |
| P3：工作流衔接，R3 核心与 R2 界面，依赖 P1/P2 | `server/modules/parameters/{service,reviewWorkflowRepository}.ts`；`src/application/ports/ParameterRepository.ts`、`src/infrastructure/http/parameterClient.ts`、`ApiProjectTopologyWorkspace.tsx`、`DtsBindingDraftTray.tsx` 及审核页消费者。 | 候选、提交、审核规则一致；中途停用或撤权有可验证的恢复路径；失败保留草稿。 |
| P4：升级和验收，依赖 P1–P3 | 现有浏览器验收、双语合同／安全／运行手册、带存量数据的演练。 | 新旧项目升级、重启后可用；普通账号完整审核链、权限回归与回滚演练。 |

## 6. 威胁与验收矩阵

实施者提供可执行测试；独立 Spec 审阅者在 P1/P3 实施前挑战下表；部署环境观察由操作员提供。每条自动验证命令必须实际收集到预期的非零用例数量，跳过数据库或浏览器用例不算验收通过。

| 编号 | 场景 | 必须观察到的结果 |
| --- | --- | --- |
| R01 | 项目全部角色为空、缺一个角色、软件 MDE 兼任、历史重复绑定 | 精确提示缺失角色，不误报就绪；候选 ID 唯一，三个位置配置有效后提交成功。 |
| R02 | 只有组织 MDE、其他项目 MDE、跨组织或停用用户、伪造项目或管理员角色 | 不取得普通候选或阶段资格；非法配置无写入，也不生成成功审计。 |
| R03 | 配好项目角色后修改组织角色或通过注册角色审批 | 保留项目与能力绑定，只更新预览的组织范围；客户端保留完整 DTO。 |
| R04 | 两个管理员修改同一子集、分别修改不同项目、响应丢失后重试 | 过期修改冲突，不同范围修改都保留，重试和回读不重复产生副作用。 |
| R05 | 提交／审核／合入中撤权、停用及删除并发 | 串行顺序明确，不用过期权限执行、无死锁，保留历史并说明恢复方式。 |
| R06 | 只有项目 MDE、组织访客加项目 MDE、带项目范围的历史管理员 | 本项目参数流程正常；不会新增其他项目或全局设备／知识／日志／管理能力；合法组织授权继续有效。 |
| R07 | 审计或数据库失败、无效项目或用户、格式错误或空角色集合 | 原子回滚，空集合只删除当前范围的角色，不损坏其他范围。 |
| R08 | 指定处理人失效、其他候选接手当前阶段、管理员介入、候选池为空 | 审计如实记录实际操作者和介入，已完成决策不变，空池阻止普通执行。 |
| R09 | 存量升级、组织范围旧客户端、废弃的全量角色客户端、重启及应用回滚 | 现有授权和数据保留，安全旧客户端不删项目角色，危险旧请求被拒绝；旧的破坏性写入和项目角色扩大成全局权限都不能重新对外生效。 |
| R10 | 配置 → 普通用户编辑 → 提交 → 硬件／软件审核 → 合入 → 重新读取 | 真实源码版本和值持久化，审计操作者正确，之前结构索引和未变更基线修复不回退。 |

扩展现有 `server/modules/users/service.test.ts`、`server/modules/parameters/reviewWorkflowRepository.test.ts`、`server/modules/parameters/serviceReviewWorkflow.integration.test.ts`、身份和参数权限测试。在 users 服务入口新增真实 PostgreSQL 的按范围写入及并发用例，扩展前端客户端、页面和提交托盘测试。各实施任务写明实际测试路径；TypeScript 集成完成后执行构建。

```bash
npm run test:server -- server/modules/users/service.test.ts server/modules/parameters/reviewWorkflowRepository.test.ts server/modules/parameters/serviceReviewWorkflow.integration.test.ts
npx vitest run src/infrastructure/http/userGovernanceClient.test.ts src/components/parameter-topology/DtsBindingDraftTray.test.tsx
npm run build
npm run docs:check
```

以上现有文件命令是起始集合，不是未来全部验证。封存时补入新增作用域、并发和页面测试路径。使用实施者独立拥有的 PostgreSQL 数据库、迁移和普通角色数据；禁止在部署数据上运行初始化或测试修复。

浏览器覆盖扩展 `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`、`permissions.acceptance.spec.ts`、`permissions-matrix.acceptance.spec.ts`、`parameter-topology.acceptance.spec.ts`、`parameters-negative.acceptance.spec.ts`。已有需求／操作 ID 为 `PARAM-ADMIN-003`、`PERM-USER-MGMT-001`、`PARAM-ASSIGNEE-001/002/003`、`PARAM-HAPPY-001`、`PLAT-ROLE-002/003`。实施前在两份覆盖映射及中文版本中登记建议的新 ID：`PROJ-REVIEW-ROLES-001`（配置、撤销、冲突）与 `PROJ-REVIEW-READINESS-001`（缺失提示、刷新、恢复）；最初标记待实施，不得标记已自动化。通过已有验收运行器生成操作证据。

真实浏览器必须在 API 模式下验证 **1440×900、768×1024、390×844**，包含快照、截图、键盘、表单、直接链接、控制台和网络检查，并验证真实持久化，不能只测试模拟候选列表。完整验收运行器及无关的已有失败，与本轮聚焦验证分别报告。

## 7. 部署、迁移和回滚

1. 只读盘点各项目候选数量、重复／跨组织／孤立绑定、已停用的指定人员、只有项目角色的账号及进行中单据。不导出凭据或参数值；含人员姓名的详细清单仅供本地授权管理员查看。
2. 不从组织角色自动授权，也不在生产重跑种子数据。保留现有有效项目角色，包括此前可能执行的人工配置。由管理员通过新界面选择实际负责人。归属不明或跨组织记录须由其负责人处理后再启用，不能静默转换成全局授权。
3. P1–P4 本地验证通过后，配套部署兼容的服务端和前端。缓存中的组织范围旧客户端仍安全；已废弃的带项目全量覆盖请求收到明确拒绝。刷新前端资源，从数据库重新读取鉴权状态，撤权不依赖用户退出登录。
4. Aurora 管理员在界面核对三个池，普通角色账号执行 R10；重启 API／容器、修改组织角色后再次核验。这些由操作员在部署服务器完成，本地工作区不能代替目标环境证据。
5. 升级前备份。当前方案不需要删除任何角色、用户、草稿或历史。回滚必须保留已修正作用域鉴权和安全角色写入的服务端。旧服务端不能带着项目绑定重新对外服务：即使封锁了角色写入，它仍会立即把项目角色扩大成全局权限。若确实需要回退服务端，则保持维护隔离，直到修复并验证授权边界；优先只回退兼容的前端资源。同时隔离旧的破坏性角色端点。用“组织访客＋项目 MDE”账号演练回滚，证明全局权限不会重新出现。若后续确需数据库或数据迁移，交付前必须补齐并演练精确恢复流程。不能用旧角色清单覆盖并发产生的新变更。

发布成功要求权限矩阵、界面配置、完整审核链和保留数据的重启证据。只有本地构建通过或 PR 合入，不代表部署验收完成。

## Git & PR Workflow

- 本轮方案分支为 `codex/project-review-role-plan`，从干净 `main` 隔离。可修改范围只有中英方案、计划索引及双语清单。本轮不实施产品、不发布 GitHub Issue、不合入 PR、不修改服务器。
- 建议实施分支为 `codex/project-review-role-governance`，方案采纳后从重新获取的 `origin/main` 创建。P1 → P2 → P3 → P4 使用同一分支，开发并行数为 1。R2/R3 封存前由独立 Standards、Spec 审阅者检查，R3 威胁审阅先于产品修改。
- 精确候选版本的聚焦测试、真实 PostgreSQL、构建、浏览器、文档和独立审阅全部达到已选门槛后封存。只在验证矩阵要求时扩展检查；明确记录失败与跳过，不夹带无关主干修复。
- 之前“无需等 CI 合入”的指令不构成本次仅规划请求的实施授权。后续如获准交付，单独记录 CI 等待豁免、必要本地验证与 GitHub 分支保护，不把缺失的 Hosted 结果写成通过。
- 本轮停止边界是可审阅的双语正式方案及文档检查。后续实施到可集成为止，发布和合入按届时交付指令执行；目标环境验收仍由操作员负责。

## 文档影响矩阵

除明确标记本轮规划工作的项目外，下表是实施时的义务。中英文对应路径明确列出，避免产生第二套无人维护的规范。

| 类别 | 动作 | 精确路径与目的 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md`、`CONTEXT.md`、`docs/zh-CN/root/AGENTS.md`、`docs/zh-CN/root/ARCHITECTURE.md`：保持简短，只在模块归属改变时更新。 |
| 计划 | Update | 本中英方案；`docs/PLANS.md`、`docs/zh-CN/PLANS.md`、`scripts/bilingual-docs.ts`（本轮）；`docs/exec-plans/tech-debt-tracker.md`、`docs/zh-CN/exec-plans/tech-debt-tracker.md`（实施时更新 TD-121 范围）。 |
| 产品 | Update | `docs/product-specs/product-spec.md`、`docs/zh-CN/product-specs/product-spec.md`：项目角色、就绪检查、按候选池执行。 |
| 架构与 API | Update | `docs/design-docs/domain-model.md`、`docs/design-docs/api-contract.md`、`docs/design-docs/2026-08-19-organization-administration-design.md` 及 `docs/zh-CN/design-docs/` 下对应文件：范围和兼容合同。 |
| 质量与测试 | Update | `docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md` 及 `docs/zh-CN/developer/` 下对应文件；检查 `docs/developer/verification-matrix.md` 与 `docs/zh-CN/developer/verification-matrix.md`。 |
| 可靠性与运行手册 | Update | `docs/runbooks/identity-provider.md`、`docs/zh-CN/runbooks/identity-provider.md`：盘点、界面配置、发布、回滚时隔离角色写入。 |
| 安全与治理 | Update | `docs/SECURITY.md`、`docs/zh-CN/SECURITY.md`、`docs/security/user-permission-design.md`、`docs/zh-CN/security/user-permission-design.md`；采纳后为 `docs/adr/0037-organization-administration-is-home-org-tenant-operations.md` 链接范围明确的后续决策，实施时才分配 ADR 编号。 |
| 前端与设计 | Review | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、`docs/design-docs/ui-design-system.md`、`docs/developer/ui-quality-checklist.md`：端口、导航、复用组件及验证证据。 |
| 生成产物 | Review | `docs/generated/db-schema.md`、`scripts/bilingual-docs.ts`：确有迁移才重生成数据库文档；本轮登记双语文件。 |
| 参考资料 | Review | `docs/api/examples.md`、`docs/zh-CN/api/examples.md`、`docs/references/productization-api-contract-draft.md`：如有危险的全量替换示例则更新。 |

## 文档更新门禁

实施和目标环境验收结束前，计划留在 active。归档前每个 Update／Review 项必须完成或提供无需修改的证据，必要的延期工作进入债务清单。本方案本身不改写已接受的产品、安全合同，也不关闭债务。维护独立互链的中英文页面，运行 `npm run docs:check`，区分文档治理通过与生成数据库文档检查被跳过。

## 本轮规划记录

- 指令发现：在工作树根目录、`docs/`、`docs/exec-plans/`、其 `active/` 及对应 `docs/zh-CN/` 目录链依次检查 `AGENTS.override.md`、`AGENTS.md`；只命中根目录 `AGENTS.md`。同时遵守用户提供的 Ponytail 规则。
- 基线 `3a49ba62685523742bac0d212ea2d652ce3f8e88`，原工作区保持干净且未修改。本轮文档为 R1，未来 P1/P3 为 R3。没有删除、重命名、运行时、配置、数据库或远端操作。
- 本轮验证：`npm run docs:check` 文档治理通过；本地 PostgreSQL 缺少 pgvector，生成数据库文档检查跳过。`npm run build` 通过，存在浏览器模块外置和产物大小警告；`git diff --check` 通过。修正回滚授权后，独立审阅者 `/root/unchanged_gate_spec` 的 Standards／Spec 联合审阅通过。中英文合同字面值及 R01–R10 编号一致。本轮未执行产品行为、PostgreSQL、浏览器、Hosted 或部署环境验收；构建通过不代表工作流通过。
