# MOD D02 比较采集与 runner 权限提案

> English companion: [English proposal](../../../exec-plans/active/2026-09-29-mod-d02-comparison-runner-permissions-proposal.md)
>
> **状态：仅为提案（PROPOSED ONLY）。** 本文是前向契约提案，不是对 S7/P11 决策的已接受修改，不是实现，也不授权配置凭证或写入目标数据。[Cutover、Archive 与回滚决策](../../../design-docs/parameter-catalog-cutover-archive-rollback.md)中的 P11 契约仍为规范依据。

日期：2026-09-29
复核基线：`e0b219d8c3b164352c4d63faec1019853d01de5c`

## 待决事项

请批准或拒绝为现有组织范围的 MOD D02 v2 证据 writer 增加一个最小的、经身份认证的入口及其受限数据库调用能力。入口只采集**P11 之前、pre-activation 阶段、单个组织和一条已完成 S7 run** 的证据；它不运行、替代或通过 P11。

建议只增加一个经过身份认证的内部操作：

```text
POST /api/v2/parameter-catalog/cutover-runs/:runId/comparison/mod-d02
```

该路由使用现有 API 身份解析器，从经过身份认证的 `AuthContext` 推导组织和用户，并由服务端构造 `createUserInvocation(auth)`，然后调用现有 `writeModParameterCatalogComparisonCasesV2` 路径。请求只接受 `runId`；不能提交组织、actor、phase、权限、gate 或 waiver。服务会重新读取数据库中的用户与角色并验证组织管理员权限。这是最小的 USER 认证入口，因为 writer 要求服务端品牌化的 `user` invocation，而当前没有任何生产调用方能构造它。CLI 的 `operatorAuditRef` 不等于经过认证的 USER 证明。

采集后，**独立的只读 P11 verifier** 必须基于相同的源边界重新计算完整 V01-V17 和跨全部 11 个 consumer family 的 D01-D09 语义比较。它必须使用与 writer 不同的代码和数据库凭证。P11 报告才是 P12 前的证据；组织投影采集响应和其数据库行都不是。Verifier 必须独立重算 D02，不能把 v2 writer 自己生成的 observation 当作自身正确性的证明。

## 仓库中观察到的边界

- `createReleaseVerificationService` 是 routes-less 模块，默认 adapter map 为空。`runVerification(planDigest)` 不接受 trusted invocation。生产 PostgreSQL adapters 覆盖 V/M/P gates。本树中没有生产调用 `runVerification`、`generateLiveComparisonReport` 或 v2 MOD writer 的位置。生产 OPS comparison 只通过 `readReport` 读取 S10-PER 报告。
- `writeModParameterCatalogComparisonCasesV2` 只接受 `phase: "pre-activation"`、trusted user invocation 和 completed-manifest run。它从 invocation 推导组织、重新验证已持久化授权，并且只写 MOD D02 组织投影。返回值明确为 `fullReport.available: false`，原因是 `eleven-family-and-nine-gate-coverage-not-collected`。
- `readCompletedModComparisonManifestForComparison` 验证 trusted user、持久化组织/用户和已完成 P7 manifest。迁移 `0179_parameter_catalog_comparison_manifest_binding.sql` 将 v2 行约束到已完成的 `s7-orc-p0-p10-v2` run 和精确 P7 selection。phase 字段只表示比较场景；它不证明 P13，也不建立独立验证。
- MOD writer 的事务对 `public.users` 和 `public.user_role_bindings` 执行 `FOR SHARE`，并对 `public.parameter_modules`、`parameter_catalog.organization_subject_registrations` 和 `parameter_catalog.subject_placements` 执行 `LOCK TABLE ... IN SHARE MODE`。它调用 `parameter_catalog.assert_catalog_subject_active`，并对两张 v2 comparison 表执行写入/读取以验证幂等性。
- 迁移 0138 从 `PUBLIC`、`catalog_synchronizer_role` 和 `parameter_governance_writer_role` 撤销 comparison case/result 表权限。迁移 0139 的 `catalog_verification_writer_role` 只允许对 `verification_*` 追加写入；`catalog_verifier_role` 只允许读取 `verification_*`。这两个角色均不提供 v2 comparison 写入权限，也不提供 P11 所需的源数据读取权限。迁移 0179 增加约束和触发器，不增加运行时 grants。
- `comparisonCaseResultsV2.integration.test.ts` 中的一次性 PostgreSQL 测试角色获得了宽泛 fixture SELECT、Catalog active-Subject guard 的 EXECUTE 以及两张 comparison 表的 INSERT。随后测试观察到，在暂时授予 `users`/`user_role_bindings` 的 `UPDATE(id)` 以及 modules/registrations/placements 的表级 UPDATE 前，所需行锁和表锁均以 SQLSTATE `42501` 失败。这些 grants 是测试探针，不是部署角色契约。将它们复制给 API LOGIN 会赋予数据修改能力。
- `docs/SECURITY.md` 保留普通 API LOGIN 不直接写 Catalog，以及 Governance composition-root 的权限边界。直接向 API LOGIN 授予 0179 INSERT 或用于加锁的 UPDATE，会与已接受契约冲突。现有 Governance writer 无法组合本操作：它没有 Catalog、Cutover、Verification 或 comparison 表权限。

## 建议的执行顺序

1. Maintenance Operator 启动已接受的 S7 流程，并证明 P2 流量隔离、零 leased work、零业务流量和两道 writer fence。该 run 必须已完成 P0-P10 checkpoints，且拥有有效的 v2 P7 manifest。
2. 经过身份认证的 Organization Admin 只用已完成的 `runId` 调用建议的 POST 操作。服务端重新验证用户在数据库中的组织管理员权限；组织范围不得由请求体或 URL 决定。completed-manifest reader 绑定持久化 run、P0/P1/P5/P7/P10 checkpoints、plan/source fingerprint、Release ID/digest 和完整 manifest digest；路由将 run 的目标 artifact SHA 与可信部署 artifact SHA 比较。缺失或不相等的 pin 在 capture 前拒绝，并在写入事务中再次执行 current-release guard。
3. 操作运行 MOD provider，并将完整组织投影作为一组原子的 pre-activation case/result 写入。完全相同的重试是幂等回放；同一 case identity 对应不同批次时必须 fail closed。
4. 操作只返回投影 digest、inventory 数量/校验和、case 数量和新增/回放计数。不返回 Archive payload 或原始值，也不宣称 Release Verification 报告已通过。
5. 单独运行的只读 P11 verifier 针对相同 run、plan、artifact、Catalog Release、mapping epoch 和源边界执行所有必需的 V01-V17 与 D01-D09 检查，生成并绑定不可变报告 digest。它必须独立读取/重算 D02，并证明 inventory 与 family 覆盖完整。
6. 只有达到已接受门槛时 P11 才通过：`unexplained-difference` 为零、`unqueryable/protected-reference-missing` 为零、枚举每个 protected reference、覆盖全部 11 个 consumer family，且确定性期望计数/校验和匹配。只有已接受的 P11/报告审批流程可以进入 P12。

只有 S7 P10 完成且所有已接受 P11 maintenance 条件仍成立时，才能提供此操作。run 不完整、源 pin 漂移、inventory/provider 查询失败、association 缺失或有歧义、用户无权时必须拒绝。成功的 MOD D02 采集本身永远不构成 P11 结果。

## 对象与权限矩阵

此表区分建议的 scoped capture 与独立 verifier。“精确 SELECT”表示仅访问冻结后的 provider 和 manifest reader 所需的 relation/column 与 run/organization 行，不是 schema 级读取权限。

| 对象 | 建议的 MOD D02 capture | 独立 P11 verifier | 明确禁止 |
| --- | --- | --- | --- |
| 已认证 principal（`public.users`、`public.user_role_bindings`、`public.organizations`、`public.roles`） | 现有认证中间件解析身份；writer 重新验证 active user、组织及 `admin`/`platform-admin` 角色。数据库锁 owner 只对相应用户和 role-binding 行执行 `FOR SHARE`。 | 只读获取 verifier 所需的身份/授权证据。 | 请求体指定 actor/组织/角色；更新用户或角色；Agent/System invocation。 |
| S7 run 与 P7 manifest（`parameter_catalog.parameter_catalog_cutover_runs`、`parameter_catalog.parameter_catalog_cutover_events`、`parameter_catalog.parameter_catalog_cutover_checkpoints`、`parameter_catalog.catalog_releases`、`parameter_catalog.legacy_identities`、`parameter_catalog.legacy_mapping_versions` 和 manifest 引用的 owner 行） | 只读已完成的 v2 run 和不可变 P7 selection，并限定于该用户组织的投影。不推进 head，不修改 checkpoint。 | 在同一冻结的 P0-P10 数据和 pins 上只读重算。 | 两条路径均不得写入 mapping、Archive、checkpoint、phase 或 run。 |
| MOD 源数据与 association（`public.parameter_modules`、`parameter_catalog.organization_subject_registrations`、`parameter_catalog.subject_placements`） | 按组织读取并复核，同时持有 `SHARE` 表锁；modules 与 associations 不变。 | 在已接受源 snapshot 上只读执行双读语义比较。 | INSERT/UPDATE/DELETE、reconciliation、reclassification 或 fallback。 |
| Catalog identity 与 active Release | 通过现有认证 Catalog read composition 解析 Subject；只调用精确 active-Subject guard `parameter_catalog.assert_catalog_subject_active(text,text,text,text)`。 | 以相同 Release ID/digest 为 pin，只读解析 canonical 语义。 | 写入 Catalog subject、Definition、Release、head 或 activation；不得使用 publication capability。 |
| `parameter_catalog.parameter_catalog_comparison_cases` | INSERT 新的 v2 MOD/D02/pre-activation 行；按精确 key SELECT 验证相同的幂等重放。 | 为独立一致性核验而 SELECT；verifier 不写入。 | UPDATE/DELETE/TRUNCATE；改写 v1 行；P11 verifier 插入 case。 |
| `parameter_catalog.parameter_catalog_comparison_results` | INSERT 匹配的 result 行；按精确 key/evidence tuple SELECT；提交前立即检查 deferred constraints。capture 函数返回前必须核对每个 case/result 配对。 | 为独立一致性核验而 SELECT；verifier 不写入。 | UPDATE/DELETE/TRUNCATE；case 无 result 时函数必须抛错并回滚事务。迁移 0179 本身不约束反向配对。 |
| 历史 raw comparison inventory（`parameter-modules/comparisonInventoryRepository.ts` 使用的 `parameter_module_dismissed_compatibles`） | 不可用它替代 scoped MOD D02 capture 契约。 | 独立 P11 historical-read gate 必须先解决第 174 个未 allowlist 的原生 Catalog observation `S12-MOD:legacy-catalog-raw-read:3d36995998094eb1:b170050e2ad90587`：parameter-modules 历史 identity owner 提供受控的精确 row-ID 枚举，并取得 Catalog 批准/退役证明。即使 verifier 取得 SELECT 权限，也不代表原有 `comparisonInventoryRepository.ts` SQL 获得授权；该 SQL 仍未获许可。已知的 6 个历史 unqueryable case 仍是 blocker；scoped v2 组织投影不会覆盖或解决它们。 | 不授予写权限，也不得静默用当前 Module Registry 投影替换。 |
| Archive 元数据与 payload | P7 manifest 可标识精确选中的 Archive ID/disposition。采集结果和报告只可保留类型化 ID、校验和、计数和 disposition。 | verifier 可证明准确的 Archive 引用和 mapping 结果。 | 导出/复制 payload、写入 comparison 行或日志/报告、删除/改写，或缩短保留期。 |
| Release Verification 证据（`verification_gate_registry`、`verification_plans`、`verification_attempts`、`verification_gate_results`、`verification_reports`、`verification_approvals`） | capture 路由不得审批报告，也不得添加通过的 P11 gate。 | 单独获批的 evidence-writer composition 可追加 verifier artifact/report 引用；独立源数据 reader 保持只读。 | 不得为了捷径把 `catalog_verification_writer_role` 或 `catalog_verifier_role` 指派给 capture 路由；这些角色没有源数据或 v2 行权限。 |
| Trusted audit | 拟议 capture 函数在 case/result 配对所在的同一事务中追加一条固定、脱敏的 `public.audit_events` 行，并在重试时按确定性 ID 读取。缺少 audit 能力则不得启用。 | 经 report owner 持久化独立 verifier 的 artifact/report digest，不给 verifier 源数据写权限。 | 调用方提供 actor 归因、记录原始 payload，或写入完成后尽力补审计。 |

### 拟议 capture 的精确权限差异

| 对象与操作 | 现有正式能力 | 实际需要与当前缺口 | 建议归属 | 负向验收 |
| --- | --- | --- | --- | --- |
| LOGIN 与角色切换 | `wiseeff_api` 是 baseline reader、Governance writer 和 publication coordinator 的 `NOINHERIT` 成员；0139 writer/verifier 是 `NOLOGIN`。现无 capture LOGIN 或生产调用者。 | 需要由服务端认证的 USER 触发及同库 capture 连接；SYSTEM 或调用方手造 `AuthContext` 均不足。 | API 路由负责认证；拟议 `wiseeff_mod_d02_capture` LOGIN 只能执行固定函数。 | 记录 `session_user`、`current_user`、`rolsuper=false`、`rolbypassrls=false`，不得有意外成员关系；worker/verifier/API 不能执行函数。 |
| `assert_catalog_subject_active` `EXECUTE` | Governance writer 在受控切换后可调用；正式 API LOGIN 直接调用得到 `42501`。 | 当前 writer 在写事务内调用；Governance 角色没有 comparison 表能力。 | 仅给拟议函数 owner 精确签名的 `EXECUTE`，不直接授予 API。 | API 直接调用仍为 `42501`；Release 错误/漂移或 Subject inactive 时函数拒绝。 |
| `users`、`user_role_bindings` 的 `FOR SHARE` | 普通 API 的 public 表 DML 不是 capture LOGIN 的权限；0139 角色也不给这些锁。一次性测试 LOGIN 需要 `UPDATE(id)`。 | 持久化管理员复核须持有两种行锁直至 case/result 提交。 | 仅函数 owner 获得精确表的 `SELECT` 与 `UPDATE(id)`；capture LOGIN 均不获得。 | capture LOGIN 直接加锁返回 `42501`；inactive、非管理员或跨组织请求写入零行。 |
| `parameter_modules`、组织登记和 Placement 的 `SHARE` 与读取 | API 的 public/Governance 路径彼此独立；拟议 capture LOGIN 无表权限。一次性测试 LOGIN 因加锁需要表级 UPDATE。 | 写事务内锁定三表，重查完整 inventory、每个 module observation 和精确 Registration/Placement。 | 函数 owner 获得列出的 `SELECT` 与因锁需要的表级 UPDATE，不提供可调用的数据更新例程。 | capture LOGIN 直接 UPDATE/加锁为 `42501`；来源或关联变化时 case/result/audit 均零写入。 |
| 完成 run、Release、legacy identity/version、P7 event/checkpoint 的 `SELECT` | 正式 API 有 Catalog baseline 读取；verifier 角色仅可 SELECT `verification_*`。 | 在 capture 连接重验 v2 完成 run、plan/artifact/release/manifest 和精确 selection。 | 函数 owner 只获得列明的 S7/Catalog `SELECT`；0179 仍执行延迟的精确 selection 校验。 | run/selection/version/pin 错误或未完成时拒绝；capture LOGIN 不能写 S7 或 Catalog 行。 |
| 0179 case/result 的 `SELECT, INSERT` | 0138 不授予 Governance/synchronizer/PUBLIC；0139 writer 仅涉及 `verification_*`；正式 API LOGIN 不写 Catalog。 | 原子保存并幂等核对完整 MOD D02 配对。 | 只有函数 owner 获得两张指定表的 `SELECT, INSERT`。 | API/capture LOGIN/worker/verifier 直接 INSERT 为 `42501`；函数内错误 tuple 或仅 case 的尝试不能提交。 |
| `public.audit_events` 的 `SELECT, INSERT` | 既有应用 audit helper 以调用方身份写；capture LOGIN 没有直接表权限。 | 在配对所在 SQL 事务中写一条固定脱敏事件；同一请求重试须按确定性 ID 读取已有事件。 | 函数 owner 仅获得 `SELECT, INSERT`，经下述固定事件路径使用。 | capture LOGIN 直接 SELECT/INSERT 为 `42501`；audit 失败回滚配对；同 request ID 携带不同的稳定内容时拒绝。 |
| 历史 dismissed row-ID 枚举 | 当前 `comparisonInventoryRepository.ts` 的 raw SELECT 未获原生 Catalog 边界许可；SELECT 权限不能补足。 | 为独立 P11 比较提供完整组织范围历史身份，与 MOD v2 capture 分开。 | 后续切片由 parameter-modules 历史身份 owner 提供受控读取，并取得 Catalog 批准/退役证明。 | 当前原生 ID 继续未放行；来源拒绝/不可用阻断 P11，只读凭证不能写 dismissed 行。 |

## 建议的数据库调用边界——不是当前 SQL 或 grants

现有 TypeScript writer 无法在正式 API LOGIN 下安全运行：当前没有直接 Catalog active-Subject EXECUTE 或 0179 INSERT；PostgreSQL 又要求 UPDATE 权限才能取得它使用的 SHARE locks。本提案不表示已经有新的 migration 或 runtime grant。

建议的实现候选是一个原子 `SECURITY DEFINER` 函数，例如 `parameter_catalog.capture_mod_d02_pre_activation_v2(...)`，owner 是新建的 `catalog_mod_d02_capture_owner`（`NOLOGIN`、`NOSUPERUSER`、`NOCREATEDB`、`NOCREATEROLE`、`NOINHERIT`、`NOBYPASSRLS`）。函数接收 run ID、服务端解析的 principal/organization ID、不可变 manifest pins，以及 TypeScript 生成的 batch/checksum。普通路由必须先验证带品牌的 USER invocation；函数再独立重新读取并锁定持久化授权，并依赖 0179 的 deferred constraint/trigger 绑定精确的已完成 run/P7 selection。它会原子插入收到的证据和 audit 事实，但不重新运行或证明 TypeScript provider 的语义 observation；只有独立 P11 verifier 会完成该验证。该函数不能认证 HTTP，也不能替代独立 verifier。

函数 owner 只获得以下权限：

- 对 `public.users`、`public.user_role_bindings`、`public.organizations`、`public.roles`、`public.parameter_modules`、`parameter_catalog.organization_subject_registrations`、`parameter_catalog.subject_placements`、`parameter_catalog.parameter_catalog_cutover_runs`、`parameter_catalog.parameter_catalog_cutover_events`、`parameter_catalog.parameter_catalog_cutover_checkpoints`、`parameter_catalog.catalog_releases`、`parameter_catalog.legacy_identities` 和 `parameter_catalog.legacy_mapping_versions` 执行 `SELECT`；
- 仅因 PostgreSQL 对现有 `FOR SHARE` 行锁的要求，对 `public.users` 和 `public.user_role_bindings` 授予 `UPDATE(id)`；
- 仅因 PostgreSQL 对现有 `LOCK TABLE ... IN SHARE MODE` 的要求，对 `public.parameter_modules`、`parameter_catalog.organization_subject_registrations` 和 `parameter_catalog.subject_placements` 授予表级 `UPDATE`；
- 对 `parameter_catalog.parameter_catalog_comparison_cases` 和 `parameter_catalog.parameter_catalog_comparison_results` 授予 `SELECT, INSERT`，不授予 `UPDATE`、`DELETE` 或 `TRUNCATE`；
- 对精确的 `parameter_catalog.assert_catalog_subject_active(text,text,text,text)` guard 授予 `EXECUTE`；以及
- 对 `public.audit_events` 授予固定 capture event 的 `SELECT, INSERT`，用于按精确 ID 核对重试；不授予 update/delete/truncate。

这些因加锁而需要的 UPDATE 只属于 `NOLOGIN` 函数 owner。该 owner 没有成员也不能登录。其 `audit_events` SELECT 是表级授权；真正把读取限制为固定 ID 的是拟议 definer 函数体，不是 SQL 行级权限。普通 API runtime 不获得表权限，也不属于 owner role。独立的 `wiseeff_mod_d02_capture` LOGIN 作为经过身份认证的 capture service 专用连接，只获得 schema `USAGE` 和该函数的 `EXECUTE`；它不能成为 Governance、Catalog、Cutover、Verification 或 migration-owner role 的成员。从 `PUBLIC` 和所有其他角色撤销此函数 EXECUTE。将 `search_path` 固定到可信系统 schema（例如 `pg_catalog, pg_temp`），函数内所有非系统对象均使用 schema-qualified 名称。

TypeScript writer 必须调整为通过这一个函数调用提交生成的 batch。函数在同一事务内取得现有 users/role 行的 `FOR SHARE` 锁，以及 modules、registrations、placements 的 `SHARE` 表锁，然后核对完整 MOD inventory 的数量/校验和、每个已锁定 module 的 `id/kind/origin/parentId/attributionSubjectId/sourceKey` 与 case legacy observation，以及精确 Registration/Placement 关联。函数原子插入并验证每个 case/result 配对及 audit，在提交前强制检查 0179 deferred constraint；0179 负责绑定 run/P7 selection，却不会拒绝缺少 result 的 case。函数不会重复 TypeScript 语义 provider，也不声称其 observation 为真。拒绝分离的“先加锁”函数再加 API 直接 DML：锁按事务生命周期释放，API 直接 DML 仍会报 `42501`。独立 P11 verifier 仍负责验证源边界和全部 family 的语义等价。

函数自行负责固定 audit 写入。现有 TypeScript `withAuditedWrite` helper 可以共享一个 `Database` 事务，但它通常直接执行的 audit INSERT 会以 capture LOGIN 身份运行，而该 LOGIN 刻意没有 `audit_events` 的直接授权。其 `public.audit_events` 行使用重新核验的组织及用户（`actor_type='user'`），固定 `app='release-verification'`、`kind='mod-d02-comparison-capture'`、`action='capture-pre-activation'`、`severity='Medium'`、`target_type='cutover-run'`、`target_id=runId`；`trace_id` 为经校验的服务端 request ID。metadata 只包含稳定的 manifest/projection 与源 inventory 摘要及 case 数量。新增/回放计数只放在调用回执中，不作为重试时比较的 audit 内容。由组织、run、request ID 的长度前缀编码生成确定性 ID；同一请求重试须按 ID 读出已有 audit 行并核对所有稳定字段，内容精确相同才返回；不同请求可另记回放事件。audit 失败使 case/result 事务回滚。这是拟议新增的固定事件 definer 例程，不是已有应用 audit helper，也不是已授予的能力。

仅供复核的不可执行 SQL/call 草图。签名、参数和回执字段为具体建议；函数体占位符有意使其无法作为 migration 执行。不得应用：

```sql
-- PROPOSED ONLY; NON-EXECUTABLE PSEUDO-SQL; NO MIGRATION NUMBER ASSIGNED.
CREATE ROLE catalog_mod_d02_capture_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE wiseeff_mod_d02_capture LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT USAGE ON SCHEMA public, parameter_catalog TO catalog_mod_d02_capture_owner;
GRANT SELECT ON public.users, public.user_role_bindings, public.organizations, public.roles,
  public.parameter_modules, parameter_catalog.organization_subject_registrations,
  parameter_catalog.subject_placements, parameter_catalog.parameter_catalog_cutover_runs,
  parameter_catalog.parameter_catalog_cutover_events,
  parameter_catalog.parameter_catalog_cutover_checkpoints, parameter_catalog.catalog_releases,
  parameter_catalog.legacy_identities, parameter_catalog.legacy_mapping_versions,
  parameter_catalog.parameter_catalog_comparison_cases,
  parameter_catalog.parameter_catalog_comparison_results
TO catalog_mod_d02_capture_owner;
GRANT UPDATE (id) ON public.users, public.user_role_bindings TO catalog_mod_d02_capture_owner;
GRANT UPDATE ON public.parameter_modules, parameter_catalog.organization_subject_registrations,
  parameter_catalog.subject_placements TO catalog_mod_d02_capture_owner;
GRANT INSERT ON parameter_catalog.parameter_catalog_comparison_cases,
  parameter_catalog.parameter_catalog_comparison_results, public.audit_events
TO catalog_mod_d02_capture_owner;
GRANT SELECT ON public.audit_events TO catalog_mod_d02_capture_owner;
GRANT EXECUTE ON FUNCTION parameter_catalog.assert_catalog_subject_active(text,text,text,text)
TO catalog_mod_d02_capture_owner;

CREATE FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(
  p_run_id text, p_principal_id text, p_organization_id text,
  p_expected_artifact_sha text,
  p_manifest_digest text, p_projection_digest text,
  p_case_batch jsonb, p_request_id text
)
RETURNS TABLE (
  organization_id text, selection_run_id text, selection_projection_digest text,
  source_inventory_count integer, source_inventory_checksum text, case_count integer,
  newly_written_count integer, replayed_write_count integer
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS <reviewed body>;
ALTER FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,jsonb,text)
  OWNER TO catalog_mod_d02_capture_owner;
REVOKE ALL ON FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,jsonb,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA parameter_catalog TO wiseeff_mod_d02_capture;
GRANT EXECUTE ON FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,jsonb,text)
  TO wiseeff_mod_d02_capture;
-- Grant no table privileges and no role membership to wiseeff_mod_d02_capture.
```

```text
PROPOSED call: route resolves auth -> createUserInvocation(auth) -> existing MOD D02 provider builds
              canonical case batch -> one function call(runId, principalId, auth-derived organizationId,
              trustedDeploymentArtifactSha, manifestDigest, projectionDigest, caseBatch, requestId)
              on dedicated connection -> return
              typed scoped receipt; independent P11 remains a separate run.
```

SQL 函数将 actor 和 organization ID 作为参数接收；PostgreSQL 无法从这些 ID 推断或认证 HTTP principal。只有经过身份认证的路由可以选择专用 connection 并提供这些参数。函数在行锁下重新验证持久化 active-user/organization-admin 状态，0179 负责验证插入行对应的精确 run/P7 selection。两者都不能证明 TypeScript observation 真实；这由独立 P11 完成。

拟议部署配置为 `MOD_D02_CAPTURE_ENABLED`（默认 `false`）、专用 LOGIN 的秘密 `MOD_D02_CAPTURE_DATABASE_URL`，以及从部署包证明填入的 `MOD_D02_CAPTURE_ARTIFACT_SHA`。启动时 composition root 必须比较 capture 与普通 API 连接的数据库身份，并记录脱敏的 `session_user`/`current_user` 及 `rolsuper`/`rolbypassrls`；缺少 URL 或 artifact SHA、数据库/LOGIN 不符或角色权限过高时，该操作保持禁用。函数将服务端提供的 artifact SHA 与持久化 run 和 manifest 比较。请求不得提供这些配置，日志不得输出凭据。禁用操作只停止新 capture，不改动已提交证据。

启用路由前的权限/原子性验收要求：

- API LOGIN 直接对两张 comparison 表 INSERT/UPDATE/DELETE/TRUNCATE，或对三张加锁源/association 表 UPDATE，均以 SQLSTATE `42501` 失败；
- `PUBLIC`、worker、Agent、verifier、Governance 或未经授权的 API role 直接执行函数均以 `42501` 失败；
- 未认证 admin、inactive、跨组织、body scope 替换、错误 run/phase、不完整 manifest、stale inventory、被修改的重试以及缺失 audit 均产生稳定拒绝，且不提交任何 case/result/audit 行；
- 有效完整写入一次性插入匹配的 case/result/audit；完全相同重放不插入新行；任何中途 constraint 或 audit 错误回滚整个操作；
- 历史 raw-read gate 使用单独的只读 verifier 凭证运行，并证明写操作以 `42501` 失败。

以上均为建议验收条件；当前集成测试中的角色只提供 disposable fixture 证据。

## Archive 保留与回滚

Comparison 证据只存储类型化 Archive ID 及 mapping/manifest digest，永不存储 Archive payload bytes。Archive relations 与 objects 保持 append-only，按 protected-reference、audit、business 和法律义务中最长的期限保留。P16 cleanup 和应用回滚都不删除 Archive 或 comparison history。禁用或回滚路由时，撤销专用函数 EXECUTE grant 并禁用/轮换专用连接 secret；保留 0179 及所有已提交的 case/result/audit 行。不得执行 down migration 或擦除数据来制造旧 binary 兼容性。建议 migration 只允许前向添加；准确版本号只在批准后分配。

## 剩余审批边界

唯一审批包是经过身份认证的 Organization Admin trigger、新的专用 capture connection/function capability 和原子 audit 路径。已接受的独立 P11 verifier 仍是其现有契约规定的单独阻断前置条件；它不是本提案中的新决策。批准或本地测试通过本身都不授权 Hosted/target 凭证、生产调用、P12 或公开发布。在审批包与 role-faithful 测试完成前，v2 writer 仍只是可测试的内部 primitive，独立 P11 comparison 仍是单独的必需 gate。

## 文档影响矩阵

| 范围 | 路径 | 动作 |
| --- | --- | --- |
| 提案 | 本文及 `docs/exec-plans/active/` 中的英文配套文档 | 同步更新 |
| 已接受的安全与 P11 契约 | `docs/SECURITY.md`、`docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md`、`docs/design-docs/parameter-catalog-cutover-archive-rollback.md` 及适用中文配套文档 | 审阅；仅在拟议能力获批后修改 |
| 运行时与 API 验证 | `docs/developer/verification-matrix.md`、生成的 OpenAPI 与数据库 schema 文档 | 路由、角色或 schema 实现时更新 |

## 文档更新门禁

本提案在唯一审批包得到决定前保留于 `active/`。英文与中文文本必须保持等价，且 `npm run docs:check` 必须通过。后续实现需更新已接受的安全、API、schema 与验证文档，才可声称新操作已启用；本提案本身不改变这些运行时契约。
