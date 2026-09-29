# MOD D02 比较采集与 runner 权限提案

> English companion: [English proposal](../../../exec-plans/active/2026-09-29-mod-d02-comparison-runner-permissions-proposal.md)
>
> **状态：仅为提案（PROPOSED ONLY）。** 本文是前向契约提案，不是对 S7/P11 决策的已接受修改，不是实现，也不授权配置凭证或写入目标数据。[Cutover、Archive 与回滚决策](../../../design-docs/parameter-catalog-cutover-archive-rollback.md)中的 P11 契约仍为规范依据。

日期：2026-09-29
复核基线：`e0b219d8c3b164352c4d63faec1019853d01de5c`

## 待决事项

**唯一待审批问题：**是否接受受信的离线维护进程使用专用 reader，取得下文精确 29 relation/137 列的 provider 读取权及 `auth_sessions` 六列，并知晓获准列在 SQL 层对所有组织的行可见；同时接受单独的 function-only capture LOGIN/NOLOGIN owner，受下文锁、审计与 0179 约束？当前数据库还通过 `PUBLIC` 授予 `TEMP`；批准时须明确接受“持久来源不可写但可创建临时对象”，或者在影响审查后单独批准数据库级 TEMP 权限变更。回答“是”只批准实施该权限包，不代表部署、替代 P11 或启动候选 API；回答“否”则选择下文固定组织/run 范围的只读函数替代方案，它需要单独的 definer 及 provider 查询适配。采集只限于 API、worker、web 停止时，针对**单个组织、一条已完成 S7 run** 的 **P11 之前、pre-activation** 证据。

建议的代码入口是 `ops/self-hosted/scripts/upgrade.sh` 中已填充的 maintenance 路径：`controller.dispatch({ action: "execute" })` 返回已完成 P10 后，且 Release Verification 的 `prepareVerification` / `runVerification` 调用之前。该 controller 已在同一进程组合 `executeCutover`、Release Verification core 和 PostgreSQL gate adapters。独立的 `scripts/wayfinder/execute-parameter-catalog-cutover.ts` 也在 P10 后退出。当前这两个入口都不调用 v2 comparison writer、不实现 P11，也不创建 trusted invocation；这是前向扩展建议，不是现有行为。

Deployment Operator 启动 maintenance 进程。P10 后，Organization Admin 通过受保护的终端提示向离线进程提供现有 WiseEff local-auth session token。该建议 seam 只支持 `AUTH_PROVIDER=local`；OIDC/HMAC 部署必须在另行批准离线认证 seam 前 fail closed。拟议的只读 resolver 使用 `hashLocalSessionToken` 对 token 求哈希，检查 `auth_sessions` 的过期和撤销状态，并从 PostgreSQL 重新读取 active user、Organization、role bindings 和有效权限。只有服务端构造的 `AuthContext` 才可传给 `createUserInvocation(auth)`。`createUserInvocation` 只给 `AuthContext` 加品牌，不执行认证。CLI 或 JSON 不得选择 user/session ID 或组织；`operatorAuditRef` 只是审计标签，不是身份认证。

该流程复用现有账户认证来源，不引入停机前授权 token。`/api/v1/auth/login` 在密码验证后创建本地 session，但它是可重复使用的 bearer credential，且不绑定 run。有效性以数据库持久化的 `expires_at` 和 `revoked_at` 为准；到期或撤销后拒绝，在此之前可重放。Capture action 会单独绑定精确 run，并对相同证据幂等；同一身份下证据变化则 fail closed。这只能证明 WiseEff 账户已认证，不能证明操作者是现场真人：ADR-0038 明确规定 `AuthContext` 不作此保证。若决策要求真人身份保障，则缺少 IdP/MFA 或等效的人类专用身份契约，获批前必须保持禁用。离线 resolver、连接及重放边界均待批准；现有 HTTP resolver 会更新 `last_used_at`，不能直接复用。

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

1. 停机前，由现有 `/api/v1/auth/login` 流程创建有效的 local-auth Organization Admin session。Session 只用于认证，不批准 run，也不豁免任何 gate。OIDC/HMAC 部署不支持此拟议 seam，保持禁用。Deployment Operator 准备精确 plan、目标 artifact 与 Catalog Release pins。
2. 已接受的 P2 边界停止 API、worker、web 和 proxy 流量，暂停并排空 queue，并证明 leased work 为零、业务流量为零、无 application writer，且 legacy/candidate 两道 writer fence 均生效。此后 S7 只能通过已接受的 one-shot maintenance 进程继续。Capture 期间没有 HTTP API。
3. `executeCutover` 报告 P10 已完成后，maintenance 进程保留 completed P0-P10 run receipt/checkpoints，重新证明 P2 隔离并读取持久化 run。它要求 P0-P10 的所有 checkpoint，包括 P2、P5/P7/P10；一个完整的 v2 P7 manifest；稳定的 source snapshot fingerprint、plan digest、target artifact SHA、Catalog Release ID/digest；且没有 live S7 run。进程从不可变的部署包 attestation 读取可信 artifact SHA，不接受请求或操作员提供的 identity 字段。Completed-run receipt/checkpoints 只是证据，不是 capture 或 P11。
4. Admin 通过无回显终端提示输入 local session token。拟议的 `wiseeff_mod_d02_source_reader` connection 对 token 求哈希，验证精确的 `auth_sessions` 行（包含持久化 expiry 和 revocation 字段），并重新读取当前 active user、Organization、role bindings 和有效权限。结果必须匹配 session 持久化的 user/Organization，并具有该组织 `admin` 权限。Source-reader connection 也运行只读 MOD D02 provider；其 allowlist 必须覆盖 provider 精确使用的 run/manifest、module/association 和 Catalog source reads。Capture transaction 接收已验证的 session ID，并在提交前重新检查和锁住 session、active user、Organization 和 admin role。过期/撤销 session、inactive user、角色变化、跨组织范围或任意 pin 缺失都必须拒绝。该 seam 当前不存在，须另行提出和实现。
5. 现有 `provideModParameterCatalogComparisonCaseBatchV2` provider 在 source-reader `Database`/root Pool 上生成 scoped projection。当前 writer 要求 `Database` 和 `pool` 指向同一个 root Pool，并把 source reads 与写事务耦合，因此不能在 source-reader 与 capture LOGIN 之间原样调用。建议的 TypeScript 拆分把生成的 batch 传给独立 `wiseeff_mod_d02_capture` connection 上的专用函数；该函数在同一事务内复核所有 pins、source inventory/associations 并加锁，然后原子写入 case/result 和 audit。完全相同重试不产生新写入；同一身份下证据变化则 fail closed。回执只包含 scoped projection digest、计数/校验和及新增/回放计数，不含 Archive payload、原始值，也不宣称 P11 通过。启动 P11 前必须提交事务并关闭 capture connection。
6. 随后单独运行只读 P11 verifier，针对相同 run、plan、artifact、Catalog Release、mapping epoch、P7 manifest 和 source boundary 重新计算所有必需的 V01-V17 和 D01-D09。它独立计算 D02；writer 生成的行只是检查输入，不是自身正确性的证明。Verifier 与 capture 使用不同代码进程和数据库身份。
7. 只有达到已接受门槛时 P11 才通过：`unexplained-difference` 为零、`unqueryable/protected-reference-missing` 为零、枚举每个 protected reference、覆盖全部 11 个 consumer family，且确定性期望计数/校验和匹配。只有已接受的 P11/报告审批流程可以进入 P12。
8. P12 将两个通过的 P11 report digest 绑定到 read-pointer switch。P13 在服务仍停止时退役 legacy writers。P13 后必须以新 attempt 重新运行完整的 `post-retirement-runtime` V01-V17 和 D01-D09，包括 V13/P02 writer reachability 与 privilege negatives。只有该报告通过且获批后，candidate API 才可 verify-only 启动；之后在流量隔离时再做 worker/web 与内部 API/browser acceptance。

### 阶段与进程边界

| 阶段 | 进程与身份 | 允许操作 | 必须固定的 pins / proof | 必须拒绝的情况 |
| --- | --- | --- | --- | --- |
| P2 保持至 P9 | 已接受的 one-shot maintenance 进程；API/worker/web 已停止，queue 已排空、proxy 已停止。Deployment Operator 是进程操作员；不得从 `operatorAuditRef` 推断 USER 身份。 | 仅继续 P2 隔离屏障之后获批的 cutover phase。 | P2 隔离、零 lease/业务流量、operation/database locks、两道 writer fence、recovery point、固定 plan/source/artifact/Release pins。 | 任意 application process、lease、流量、writer 或 pin 不匹配仍存在。 |
| P10 已完成：run 回执/checkpoints | `upgrade.sh` 记录完成的 P0-P10 run/checkpoints 并退出 cutover action；尚未 capture。API/worker/web 保持停止。 | 保留并校验 completed-run receipt、P7 manifest 和不可变 package attestation。 | P0-P10 全部 checkpoint、精确 run/plan/source/artifact/Release pins、完整 P7 manifest、无 live S7 run，并重新证明 P2 隔离。 | 缺 checkpoint/manifest/attestation、run 仍活动、pin 漂移或隔离丢失。 |
| P10 后 capture | 拟议的一次性 maintenance 扩展。`wiseeff_mod_d02_source_reader` 验证 Admin session 并运行 provider reads；独立 `wiseeff_mod_d02_capture` 调用固定函数。API/worker/web 保持停止。 | 采集一个组织范围的 MOD D02 batch，然后提交并关闭 capture connection。 | Local-auth session 对当前 users/org/roles 重新验证；source-reader `session_user=current_user=wiseeff_mod_d02_source_reader`；capture `session_user=wiseeff_mod_d02_capture`、definer `current_user=catalog_mod_d02_capture_owner`；重新验证全部 P10 pins 和 P2 proof。 | 非 local auth provider、session 错误/过期/撤销、非 admin/跨组织 principal、未批准 reader scope、source 过期、DB/role 错误或 pin 不完整。 |
| P11 | 独立 verifier 进程，使用只读 verifier credential；没有 API/worker/web。Capture transaction 和 connection 已提交并关闭。报告仅由已批准的 append-only evidence writer 持久化。 | 重算完整 V01-V17 和 D01-D09；持久化不可变 report digest。 | P2 隔离持续有效；target/run/plan/artifact/Release/mapping epoch/P7 manifest/source boundary 相同；unexplained/unqueryable 均为零；完整覆盖 11 个 family 和 protected references。 | 有并发 capture/write、缺 raw-read 授权/来源、family/reference 覆盖不完整、阈值非零或 source 漂移。 |
| P12 | One-shot maintenance controller；应用服务继续停止；审批主体彼此独立。 | 初始完整 P11 通过后执行精确 read-pointer CAS。 | 两个初始 P11 report digest 和已接受审批均绑定本次 switch。 | 审批/report 缺失或不匹配，pointer/source 漂移。 |
| P13 | One-shot maintenance controller；应用服务继续停止。 | 退役 legacy writers，然后安排独立的 post-retirement 完整验证。 | 退役证明和精确 P12 pointer/run pins。 | legacy writer 仍可达、pointer/source 漂移或退役证明不完整。 |
| P13 后验证 | 独立只读 verifier；API/worker/web 继续停止。 | 新的 `post-retirement-runtime` attempt，完整重跑 V01-V17 和 D01-D09，包括 V13/P02 negatives。 | 新 attempt identity、精确 artifact/database Release pins、完整 11-family/protected-reference coverage，阈值失败为零。 | 部分重跑、证据缺失、raw-read gap、source 过期或阈值非零。 |
| Candidate API | 仅在获批的 post-retirement-runtime report 后启动 candidate API；worker/web 随后启动，queue/proxy/public traffic 继续关闭。 | Verify-only readiness 与隔离的内部/API/browser acceptance。 | 精确 artifact/database Release digest 相等，且有获批的 P13 runtime pin。 | runtime pin 缺失/过期、migration/synchronization/repair、pointer 漂移，或 public-release 获批前出现公共流量。 |

## 对象与权限矩阵

此表区分建议的 scoped capture 与独立 verifier。“精确 SELECT”表示只授权所需 relation/column，不表示数据库实施了行级租户隔离。拟议 source-reader 没有 RLS policy，可见获准列的所有行；组织/run 过滤由可信 maintenance process 执行。这不是 schema 级授权，但数据库本身不强制组织行范围。

| 对象 | 建议的 MOD D02 capture | 独立 P11 verifier | 明确禁止 |
| --- | --- | --- | --- |
| 已认证 principal 与 local session（`public.auth_sessions`、`public.users`、`public.user_role_bindings`、`public.organizations`、`public.roles`） | 拟议离线 resolver 校验 token hash、session expiry/revocation，并重载当前持久化 `AuthContext`；capture function 在提交前重新检查并锁定 session、active user、Organization 和 admin binding。 | 只读获取 verifier 所需的身份/授权证据。 | CLI/JSON 指定 actor/组织/角色；不得修改用户、角色或 session 数据（仅 definer owner 可用锁定所需的 `UPDATE(id)`）；Agent/System invocation；将 `operatorAuditRef` 当作身份依据。 |
| S7 run 与 P7 manifest（`parameter_catalog.parameter_catalog_cutover_runs`、`parameter_catalog.parameter_catalog_cutover_events`、`parameter_catalog.parameter_catalog_cutover_checkpoints`、`parameter_catalog.catalog_releases`、`parameter_catalog.legacy_identities`、`parameter_catalog.legacy_mapping_versions` 和 manifest 引用的 owner 行） | 应用过滤选择精确的已完成 v2 run 和不可变 P7 selection，并生成经认证组织的投影。LOGIN 可读取获准列的所有行；不得推进 head 或修改 checkpoint。 | 在同一冻结的 P0-P10 数据和 pins 上只读重算。 | 两条路径均不得写入 mapping、Archive、checkpoint、phase 或 run。 |
| MOD 源数据与 association（`public.parameter_modules`、`public.parameter_module_mappings`、`parameter_catalog.organization_subject_registrations`、`parameter_catalog.subject_placements`、`parameter_catalog.current_project_parameter_bindings`） | 应用过滤选择经认证组织的投影；source-reader 可读取获准列的所有行。Capture function 在自身事务锁内复核已接受 inventory 和 association。 | 在已接受源 snapshot 上只读执行双读语义比较。 | INSERT/UPDATE/DELETE、reconciliation、reclassification 或 fallback。 |
| Catalog identity 与 active Release | 通过现有认证 Catalog read composition 解析 Subject；只调用精确 active-Subject guard `parameter_catalog.assert_catalog_subject_active(text,text,text,text)`。 | 以相同 Release ID/digest 为 pin，只读解析 canonical 语义。 | 写入 Catalog subject、Definition、Release、head 或 activation；不得使用 publication capability。 |
| `parameter_catalog.parameter_catalog_comparison_cases` | INSERT 新的 v2 MOD/D02/pre-activation 行；按精确 key SELECT 验证相同的幂等重放。 | 为独立一致性核验而 SELECT；verifier 不写入。 | UPDATE/DELETE/TRUNCATE；改写 v1 行；P11 verifier 插入 case。 |
| `parameter_catalog.parameter_catalog_comparison_results` | INSERT 匹配的 result 行；按精确 key/evidence tuple SELECT；提交前立即检查 deferred constraints。capture 函数返回前必须核对每个 case/result 配对。 | 为独立一致性核验而 SELECT；verifier 不写入。 | UPDATE/DELETE/TRUNCATE；case 无 result 时函数必须抛错并回滚事务。迁移 0179 本身不约束反向配对。 |
| 历史 raw comparison inventory（`parameter-modules/comparisonInventoryRepository.ts` 使用的 `parameter_module_dismissed_compatibles`） | 不可用它替代 scoped MOD D02 capture 契约。 | 独立 P11 historical-read gate 必须先解决第 174 个未 allowlist 的原生 Catalog observation `S12-MOD:legacy-catalog-raw-read:3d36995998094eb1:b170050e2ad90587`：parameter-modules 历史 identity owner 提供受控的精确 row-ID 枚举，并取得 Catalog 批准/退役证明。即使 verifier 取得 SELECT 权限，也不代表原有 `comparisonInventoryRepository.ts` SQL 获得授权；该 SQL 仍未获许可。已知的 6 个历史 unqueryable case 仍是 blocker；scoped v2 组织投影不会覆盖或解决它们。 | 不授予写权限，也不得静默用当前 Module Registry 投影替换。 |
| Archive 元数据与 payload | P7 manifest 可标识精确选中的 Archive ID/disposition。采集结果和报告只可保留类型化 ID、校验和、计数和 disposition。 | verifier 可证明准确的 Archive 引用和 mapping 结果。 | 导出/复制 payload、写入 comparison 行或日志/报告、删除/改写，或缩短保留期。 |
| Release Verification 证据（`verification_gate_registry`、`verification_plans`、`verification_attempts`、`verification_gate_results`、`verification_reports`、`verification_approvals`） | Maintenance capture 不得审批报告，也不得添加通过的 P11 gate。 | 单独获批的 evidence-writer composition 可追加 verifier artifact/report 引用；独立源数据 reader 保持只读。 | 不得为了捷径把 `catalog_verification_writer_role` 或 `catalog_verifier_role` 指派给 maintenance capture；这些角色没有源数据或 v2 行权限。 |
| Trusted audit | 拟议 capture 函数在 case/result 配对所在的同一事务中追加一条固定、脱敏的 `public.audit_events` 行，并在重试时按确定性 ID 读取。缺少 audit 能力则不得启用。 | 经 report owner 持久化独立 verifier 的 artifact/report digest，不给 verifier 源数据写权限。 | 调用方提供 actor 归因、记录原始 payload，或写入完成后尽力补审计。 |

### 拟议 capture 的精确权限差异

| 对象与操作 | 现有正式能力 | 实际需要与当前缺口 | 建议归属 | 负向验收 |
| --- | --- | --- | --- | --- |
| LOGIN 与角色切换 | `wiseeff_api` 是 baseline reader、Governance writer 和 publication coordinator 的 `NOINHERIT` 成员；0139 writer/verifier 是 `NOLOGIN`。现无 offline source-reader/capture LOGIN 或生产调用者。 | P10 后，maintenance process 需要一个只读连接同时解析 local session 并运行 MOD provider source reads，另需独立 capture connection 调用固定函数。Provider 要求 `Database` 与 `pool` 共用 root Pool，因此 source reads 不能使用仅有 EXECUTE 权限的 capture LOGIN。`createUserInvocation` 本身不执行认证。 | 拟议 `wiseeff_mod_d02_source_reader` 仅获精确 auth/session 和 provider SELECT；`wiseeff_mod_d02_capture` 只能执行固定函数。两者均不得切换其他角色。 | 记录 source-reader、capture connection 及 definer function 内的 `session_user`/`current_user`；名称必须匹配，且 `rolsuper=false`、`rolbypassrls=false`，无非预期 membership。API/worker/verifier 不能执行函数。 |
| Local session 与有效 `AuthContext` | `/api/v1/auth/login` 在本地密码验证后创建不透明 token；`auth_sessions` 只存 SHA-256 hash、创建/过期时间和撤销状态。当前 API resolver 调用 `localAuth.resolveSession`，会更新 `last_used_at`。 | 拟议只读 resolver 校验 token hash，并在不读取密码 hash、不写入数据的情况下重载 active user、Organization、role bindings 和权限。这证明账户认证，不证明现场真人。此 seam 仅支持 `AUTH_PROVIDER=local`；OIDC/HMAC 在另行批准离线 seam 前 fail closed。 | 新的 `wiseeff_mod_d02_source_reader` LOGIN 只获已枚举 auth/provider relations 的获批 SELECT 列；下方可销毁探针已枚举当前 provider/kernel 列，但仍待授权及运行时 ACL 审查。包含 `roles.id/permissions` 和仅 `user_password_credentials.username`，不得包含 `password_hash`。函数 owner 另行锁定/复核对应 session 和 admin 行。 | session 不存在、hash 错误、过期/撤销、user inactive、角色变更/非 admin、跨组织、不支持的 auth provider 或 reader 写入尝试。Session 在过期/撤销前仍可重放；不声称有 run-bound token。 |
| `assert_catalog_subject_active` `EXECUTE` | Governance writer 在受控切换后可调用；正式 API LOGIN 直接调用得到 `42501`。 | 当前 writer 在写事务内调用；Governance 角色没有 comparison 表能力。 | 仅给拟议函数 owner 精确签名的 `EXECUTE`，不直接授予 API。 | API 直接调用仍为 `42501`；Release 错误/漂移或 Subject inactive 时函数拒绝。 |
| `auth_sessions`、`users`、`organizations`、`user_role_bindings` 的 `FOR SHARE` | 普通 API public 表 DML 不是 capture LOGIN 的权限；0139 角色也不给这些锁。一次性测试 LOGIN 需要 `UPDATE(id)` 才能取得既有 user/role locks。 | 持久化 session validity 与 Organization-admin 复核必须锁至 case/result 提交；并发撤销、用户/组织变化或角色变化不得与 capture 竞争。 | 仅函数 owner 获得四张表的精确 `SELECT` 和锁所需的 `UPDATE(id)`；source-reader 仅 SELECT、capture LOGIN 仅 EXECUTE，两者均无 UPDATE 或直接加锁权限。 | source-reader/capture LOGIN 直接加锁或 UPDATE 返回 `42501`；session 过期/撤销、inactive/非管理员/跨组织请求均写入零行。 |
| `parameter_modules`、组织登记和 Placement 的 `SHARE` 与读取 | API 的 public/Governance 路径彼此独立；拟议 capture LOGIN 无表权限。一次性测试 LOGIN 因加锁需要表级 UPDATE。 | 写事务内锁定三表，重查完整 inventory、每个 module observation 和精确 Registration/Placement。 | 函数 owner 获得列出的 `SELECT` 与因锁需要的表级 UPDATE，不提供可调用的数据更新例程。 | capture LOGIN 直接 UPDATE/加锁为 `42501`；来源或关联变化时 case/result/audit 均零写入。 |
| 完成 run、Release、legacy identity/version、P7 event/checkpoint 的 `SELECT` | 正式 API 有 Catalog baseline 读取；verifier 角色仅可 SELECT `verification_*`。 | 在 capture 连接重验 v2 完成 run、plan/artifact/release/manifest 和精确 selection。 | 函数 owner 只获得列明的 S7/Catalog `SELECT`；0179 仍执行延迟的精确 selection 校验。 | run/selection/version/pin 错误或未完成时拒绝；capture LOGIN 不能写 S7 或 Catalog 行。 |
| 0179 case/result 的 `SELECT, INSERT` | 0138 不授予 Governance/synchronizer/PUBLIC；0139 writer 仅涉及 `verification_*`；正式 API LOGIN 不写 Catalog。 | 原子保存并幂等核对完整 MOD D02 配对。 | 只有函数 owner 获得两张指定表的 `SELECT, INSERT`。 | API/capture LOGIN/worker/verifier 直接 INSERT 为 `42501`；函数内错误 tuple 或仅 case 的尝试不能提交。 |
| `public.audit_events` 的 `SELECT, INSERT` | 既有应用 audit helper 以调用方身份写；capture LOGIN 没有直接表权限。 | 在配对所在 SQL 事务中写一条固定脱敏事件；同一请求重试须按确定性 ID 读取已有事件。 | 函数 owner 仅获得 `SELECT, INSERT`，经下述固定事件路径使用。 | capture LOGIN 直接 SELECT/INSERT 为 `42501`；audit 失败回滚配对；同 request ID 携带不同的稳定内容时拒绝。 |
| 历史 dismissed row-ID 枚举 | 当前 `comparisonInventoryRepository.ts` 的 raw SELECT 未获原生 Catalog 边界许可；SELECT 权限不能补足。 | 为独立 P11 比较提供完整组织范围历史身份，与 MOD v2 capture 分开。 | 后续切片由 parameter-modules 历史身份 owner 提供受控读取，并取得 Catalog 批准/退役证明。 | 当前原生 ID 继续未放行；来源拒绝/不可用阻断 P11，只读凭证不能写 dismissed 行。 |

### 可销毁 PostgreSQL 读取权限探针

`server/modules/release-verification/comparison/comparisonCaseResultsV2.integration.test.ts` 的聚焦探针使用真实 P0–P10 orchestrator、两个持久化组织、MOD 模块、Registration/Placement、已发布 Catalog Release，以及正式 `provideModParameterCatalogComparisonCaseBatchV2`。可销毁的 `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS` 只取得**列级** SELECT。来源 `Database` 与直接 `Pool` 指向同一个 root Pool；该测试角色的服务端语句日志只记录参数化 SQL，不记录绑定值，涵盖 Pool 获取的 client。此角色下读取成功只能证明当前通用 provider 调用链的权限需求，既不是已部署 reader，也不代表按 D02 业务所需字段进一步收窄后的最小投影。Registry 和 Kernel 当前会读取 D02 本身未消费的 DTO 字段及整份 Release 内容。

下表是该调用链固定的候选授权清单。每个列集合包含输出、JOIN、WHERE 和 ORDER BY 所需列；不能因为过滤列不在 DTO 中便将其删掉。测试不授整表或整 schema SELECT。除特别说明外均为无行锁、表锁的 SELECT。组织过滤发生在应用中，**不**由 PostgreSQL 行安全策略执行。

| 生产调用/过滤 | relation 与精确 SELECT 列 | 数据库边界 |
| --- | --- | --- |
| 持久化 invocation 复核：user ID、组织、role join、capability role 谓词 | `public.users(id, organization_id, name, email, title, is_active)`；`public.organizations(id, name)`；`public.user_role_bindings(user_id, project_id, role_id)`；`public.user_password_credentials(user_id, username)`；`public.roles(id, permissions)` | 直接 `Database.query`；无 `password_hash`。现有 helper 会读取资料字段，尽管 MOD 授权主要只需身份、active、组织和 admin role。 |
| 完成 run 与 P7/P10：精确 run ID、release/plan/artifact pin、phase、有序 manifest、identity scope owner | `parameter_catalog.parameter_catalog_cutover_runs(id, source_snapshot_fingerprint, target_artifact_sha, target_catalog_release_digest, migration_contract_version, plan_digest, current_phase, state)`；`parameter_catalog.parameter_catalog_cutover_checkpoints(cutover_run_id, phase, checkpoint_digest, payload, committed_at)`；`parameter_catalog.parameter_catalog_cutover_events(cutover_run_id, phase, event_kind, payload)`；`parameter_catalog.catalog_releases(id, release_digest, predecessor_release_id, release_version, release_sequence, published_at)`；`parameter_catalog.legacy_mapping_versions(id, legacy_identity_id, cutover_run_id, version_number, source_checksum, graph_fingerprint, r_class, target_kind, target_id, archive_id, evidence_archive_id, supersedes_version_id)`；`parameter_catalog.legacy_identities(id, source_kind, source_id, owner_scope_kind, owner_scope_id)`；`public.projects(id, organization_id)` | 获取的 Pool client 在 repeatable-read、read-only 快照中读取。Manifest reader 先核对**完整 run**，后投影授权组织；SQL 不强制租户行范围。 |
| 模块 registry：组织过滤与稳定模块/映射排序 | `public.parameter_modules(id, organization_id, name, parent_id, sort_order, description, scope, importance, kind, origin, source_key, attribution_subject_id, path)`；`public.parameter_module_mappings(id, organization_id, parameter_module_id, match_kind, match_value, priority)` | 直接 registry 查询。通用 registry 还加载 D02 不作为 case 身份的 mapping 行。 |
| Registry 的有效 Binding 事实：组织/Registration 关联 | `parameter_catalog.current_project_parameter_bindings(id, organization_id, registration_id)` | 只授权**视图** SELECT，不直接授权基表。0167 视图以 owner 权限内部读取 `project_parameter_bindings`，并由 `definition_replacement_projects`、`project_parameter_values`、`project_value_source_pins`、`project_parameter_source_occurrences`、`project_source_member_tombstones` 过滤。当前 MOD case 构造不使用 Binding 数量。 |
| 固定发布的 Governance 分页：组织、当前 Placement join、Registration 排序 | `parameter_catalog.organization_subject_registrations(id, organization_id, subject_id, status, registration_method, current_placement_id, updated_at)`；`parameter_catalog.subject_placements(id, organization_id, registration_id, module_id, updated_at)` | Pool client 只读快照。现有 helper 先载入该组织完整行集，再切分页；不能把首页成功当成完整库存。 |
| 当前 Catalog 指针及固定 Kernel Release/lineage 完整加载 | `parameter_catalog.catalog_state(current_catalog_release_id)`；`parameter_catalog.catalog_materializations(release_id, compiled_fingerprint, database_fingerprint, installed_at)`；`parameter_catalog.catalog_release_subjects(release_id, subject_id, lifecycle, selector_snapshot, tombstone_provenance)`；`parameter_catalog.catalog_subjects(id, kind, canonical_key)`；`parameter_catalog.catalog_release_subject_aliases(release_id, alias_id, lifecycle, tombstone_provenance)`；`parameter_catalog.catalog_subject_aliases(id, subject_id, selector_kind, normalized_selector)`；`parameter_catalog.catalog_release_definition_heads(release_id, definition_id, revision_id)`；`parameter_catalog.parameter_definitions(id, subject_id, property_key)`；`parameter_catalog.definition_revisions(id, definition_id, revision_number, catalog_release_id, content_digest, content)` | 直接 Pool 查询及已获取 client 的只读事务。当前指针/发布查询复用上方 `catalog_releases`。Kernel 加载整份选定发布，而非仅指定 Subject ID；所以 `content` 是**当前路径**实际授权代价。 |
| 双事实 readiness：发布策略能力、精确 active receipt、artifact digest | `catalog_publication.publication_policies(singleton, revision, publication_enabled, low_risk_single_actor_publish, capability_contract_revision, updated_at, updated_by_principal_id)`；`parameter_catalog.catalog_activation_receipts(id, kind, release_id, release_digest, created_at)`；`catalog_publication.release_artifacts(artifact_digest)` | 直接 `Database` 与 Pool 读取。`singleton` 是 WHERE 列：不给此列会使 policy 查询失败，readiness 呈现 `unsupported-catalog-capability` / `not-ready`；这不是发布权限。 |
| 拟议离线 local-session 查询；**生产 provider 不调用，本轮也未交付运行时代码** | `public.auth_sessions(id, user_id, organization_id, token_hash, expires_at, revoked_at)` | 测试专用候选以 `token_hash = $1` 查询，再使用已有持久化 `getAuthContext`。不得调用会更新 `last_used_at` 的 HTTP `resolveSession`。 |

Provider 不需要直接执行 `assert_catalog_subject_active`，也不需要 comparison case/result 写入、audit SELECT、历史 dismissed-compatible raw read 或 `SET ROLE`。Subject guard 和行/表锁属于单独的受保护 writer。上面已列出视图 owner 的内部依赖；给 source LOGIN 额外授权这六张基表只会扩大权限。测试角色的 grant 是测量值，不是拟议运行时 grant 或 Catalog 边界许可。

可销毁角色尽管为 `NOINHERIT`，仍通过 `PUBLIC` 继承数据库 `TEMP`；该 LOGIN 也可自行改变默认只读事务设置。实测的 `42501` 因而只证明不能 UPDATE 持久业务表，不能声称绝对无法创建临时对象。审批包必须明确接受这一较窄结论，或加入经影响审查的数据库级 `REVOKE TEMP ON DATABASE ... FROM PUBLIC`，并对确实需要临时对象的角色单独恢复能力。PostgreSQL 没有只针对本 reader 剔除 `PUBLIC` grant 的 per-role DENY；本提案**没有执行**数据库级修改。探针另核对不能直接 CREATE schema 对象、没有角色成员关系、没有 comparison INSERT/audit 或 dismissed-row SELECT、也不能 EXECUTE active-Subject guard；它尚未穷尽继承的所有 PUBLIC 函数能力，因此部署 ACL 审查仍是前置条件。

在本分支的可销毁 pgvector/PostgreSQL 16 上，固定的 provider 29 relation/137 列授权后，聚焦集成测试 **1/1 通过**。两条 MOD R1/R10 selection 均为 appended，结果仍是 `unexplained-difference`，没有把 Archive 冒充 Subject。同一 LOGIN 的 provider 只返回已认证组织的两个 case，直接 SELECT 却读到了另一组织的测试模块。测试通过真实 local login 创建 session；候选只读查询识别正常的组织 Admin，并拒绝错误 token、过期/撤销 session、inactive user、被移除的 Admin 及仅项目级 Admin。现有 HTTP `resolveSession` 在更新 `last_used_at` 时以 `42501` 拒绝。测试在每次候选读取前后，以进程内指纹比较完整 session 行（含 `last_used_at`）、用户/角色与 MOD 业务行，以及 Archive 对象名和内容；断言仅输出相等布尔值，不打印 token/hash/对象字节。撤销必需的 `username` SELECT 后，真实 provider 以 `42501` 失败；此前漏掉 `publication_policies.singleton` 导致 readiness 返回 `unsupported-catalog-capability`，最终固定清单已包含它。直接 case/result INSERT、audit/dismissed-row SELECT、active-Subject guard EXECUTE 和 `SET ROLE parameter_governance_writer_role` 均得 `42501`。测试角色无 role membership；在已检查的 `public`、`parameter_catalog`、`catalog_publication` 三个 schema 中，未发现可执行的 volatile SECURITY DEFINER 函数。这只是本地 ACL 库存，不是目标部署身份回执。

最终隔离试跑中，PostgreSQL 为临时 reader role 记录了 212 条 duration 日志记录；有界扫描发现绑定参数明细行为 0、`we_local_` token 标记为 0。语句轨迹同时包含 `Database` 的 auth/policy 读取与直接/获取的 Pool 的 manifest、registry、Governance、Kernel 读取。公开证据仅保留这些计数及上方 relation/列清单，**不**附原始 SQL 日志、bearer token、session hash、密码、Archive payload 或连接串。该扫描不能证明未来所有错误处理或目标环境日志均会脱敏；这仍是运行时验收任务。

### 来源事实与 capture 事务复核对照

现有 v2 writer 与 0179 约束证明的内容不同。下表明确另一条连接生成 batch 后，未来 function-only capture 必须维持的边界。“待实现”表示**本提案尚未实现或获批**。

| 读取/provider 使用的事实 | 当前受保护 writer 或不可变检查 | 跨连接仍需完成 |
| --- | --- | --- |
| Local session hash、到期、撤销、`last_used_at` | 现有 writer 不接收 session ID，不能重新认证离线 bearer。 | **待实现：**候选只读 resolver 验证 token；capture 事务重新读取并锁住同一 session 至提交。真实 local login 建立的有效 session 只证明账户，不证明现场真人。 |
| Active user、组织、admin binding | Writer 重读持久化 `AuthContext`，`FOR SHARE` 锁定匹配的 `users` 和 `user_role_bindings`，拒绝 inactive/非 admin/跨组织。 | **待实现：**函数绑定并锁定 session 的组织，重新核对精确 principal/organization；前一条 reader 连接成功不能授权后一条事务。 |
| 完成 run、plan/artifact/release pin、P7 checkpoint/events、完整 manifest 与精确 identity/version | Reader 在只读快照重验完整 v2 manifest。Writer 在写事务前重读；0179 延迟 trigger 在约束检查时核对新增 result 的完成 run/P7 selection。 | **待实现：**函数在写事务中重验 run/checkpoint/manifest 和来源回执。0179 不证明 provider 的模块/Subject 观测，重放不新增 row 时也不能替代完整 run 复核。 |
| 当前 Catalog Release、readiness、Subject 身份和生命周期 | Provider 在读取前后核对 pin。Writer 在事务内对每个 Subject ID 调 `assert_catalog_subject_active`；0179 绑定 result selection Release。 | **待实现：**函数在 capture 事务检查 release/readiness 漂移与精确 Subject 身份。Guard 的证明比独立 D02/P11 语义核验窄。 |
| 本组织 MOD 模块库存及旧观测 | Writer 对 `parameter_modules` 取 `SHARE`，重载 registry，比对数量/checksum 和每个 case 的 `id/kind/origin/parentId/attributionSubjectId/sourceKey`。 | **待实现：**函数在同一事务重做；通用 mapping/Binding 读取本身不是 case 事实。 |
| Registration/Placement 的 Subject 与模块关联 | Writer 对两表取 `SHARE`，核对精确 registration、placement、status、method、module、Subject。 | **待实现：**函数在锁下复核关联，包括缺失/歧义。 |
| Case/result 身份及重试 | 当前 writer 插入不可变双行，冲突时读取精确 evidence，强制检查延迟约束。0179 对新增 result 核对选定版本。 | **待实现：**函数把来源复核、双行及固定 audit 原子绑定；不能在来源或授权漂移后直接重放旧 batch。 |

既有集成测试中的受控来源变更和同键重试拒绝验证当前 writer 边界；可销毁 reader 撤销列权限验证真实 `42501`。二者都不是不存在的拟议 definer 测试。独立 P11 仍负责完整语义比较和全 family 覆盖。

## 建议的数据库调用边界——不是当前 SQL 或 grants

现有 TypeScript writer 无法在正式 API LOGIN 下安全运行：当前没有直接 Catalog active-Subject EXECUTE 或 0179 INSERT；PostgreSQL 又要求 UPDATE 权限才能取得它使用的 SHARE locks。现有 local API session resolver 会更新 `auth_sessions.last_used_at`，因此不是只读离线认证 seam；两个新 LOGIN 当前都不存在。另一个限制是 `provideModParameterCatalogComparisonCaseBatchV2` 要求 `Database` 与 `pool` 指向同一个 root Pool，而当前 writer composition 将这些 provider reads 与写事务耦合。本提案要求 TypeScript 拆分：用一个范围受限的 source-reader `Database`/Pool 完成认证和 batch 生成，再将 batch 交给独立 capture connection 上的固定函数。Capture function 必须在自己的写事务中重新检查并锁定相关 source/auth 行及所有 pins，之后才接受 batch；两个 LOGIN 不能合并。本提案不表示已经有新 migration 或 runtime grant。

建议的实现候选是一个原子 `SECURITY DEFINER` 函数，例如 `parameter_catalog.capture_mod_d02_pre_activation_v2(...)`，owner 是新建的 `catalog_mod_d02_capture_owner`（`NOLOGIN`、`NOSUPERUSER`、`NOCREATEDB`、`NOCREATEROLE`、`NOINHERIT`、`NOBYPASSRLS`）。函数接收 run ID、已验证的 auth session ID、服务端解析的 principal/organization ID、不可变 manifest pins，以及 TypeScript 生成的 batch/checksum。离线 local-session resolver 必须先验证 bearer session，再构造带品牌的 USER invocation；函数独立重新读取并锁定 auth session、active user 和持久化 Organization-admin binding，并依赖 0179 的 deferred constraint/trigger 绑定精确的已完成 run/P7 selection。它会原子插入收到的证据和 audit 事实，但不重新运行或证明 TypeScript provider 的语义 observation；只有独立 P11 verifier 会完成该验证。该函数不能认证 bearer token/HTTP，也不能替代独立 verifier。离线 auth-resolution seam 待批准和实现。

函数 owner 只获得以下权限：

- 对 `public.users`、`public.user_role_bindings`、`public.organizations`、`public.roles`、`public.parameter_modules`、`parameter_catalog.organization_subject_registrations`、`parameter_catalog.subject_placements`、`parameter_catalog.parameter_catalog_cutover_runs`、`parameter_catalog.parameter_catalog_cutover_events`、`parameter_catalog.parameter_catalog_cutover_checkpoints`、`parameter_catalog.catalog_releases`、`parameter_catalog.legacy_identities` 和 `parameter_catalog.legacy_mapping_versions` 执行 `SELECT`；
- 对 `public.auth_sessions` 执行 `SELECT`；仅因 PostgreSQL 对现有 `FOR SHARE` 行锁的要求，对 `public.auth_sessions`、`public.users`、`public.organizations` 和 `public.user_role_bindings` 授予 `UPDATE(id)`；
- 仅因 PostgreSQL 对现有 `LOCK TABLE ... IN SHARE MODE` 的要求，对 `public.parameter_modules`、`parameter_catalog.organization_subject_registrations` 和 `parameter_catalog.subject_placements` 授予表级 `UPDATE`；
- 对 `parameter_catalog.parameter_catalog_comparison_cases` 和 `parameter_catalog.parameter_catalog_comparison_results` 授予 `SELECT, INSERT`，不授予 `UPDATE`、`DELETE` 或 `TRUNCATE`；
- 对精确的 `parameter_catalog.assert_catalog_subject_active(text,text,text,text)` guard 授予 `EXECUTE`；以及
- 对 `public.audit_events` 授予固定 capture event 的 `SELECT, INSERT`，用于按精确 ID 核对重试；不授予 update/delete/truncate。

这些因加锁而需要的 UPDATE 只属于**拟议**的 `NOLOGIN` 函数 owner。其 audit SELECT 会是表级授权；限制固定 ID 读取的应是待实现的函数体，而非 SQL 行级权限。拟议的 `wiseeff_mod_d02_source_reader` LOGIN 会在一个 root Pool 上完成 local-session 解析和所有 provider 读取。上面可销毁探针列出**当前调用链**的精确 SELECT 列。该角色没有 RLS：直接 SQL 可读获准列的所有行，组织过滤由可信维护进程而非 PostgreSQL 租户行隔离实现。Admin 不能得到此凭据。若不接受此全行可见性，较窄的替代是固定组织/run 范围、在 PostgreSQL 内核对持久身份和 pin 的只读函数；代价是另行审查 definer，以及为现有通用 provider 增加第二个查询契约，不必默认引入全库 RLS。探针不批准任一方案。候选 grant 排除 `password_hash`、宽泛 SELECT、直接写/锁授权、audit 访问和 dismissed-compatible raw read；继承的 PUBLIC 函数/schema 权限仍需部署前 ACL 审查。每项来源事实需要 capture 事务内精确重验/锁定或在漂移时拒绝。普通 API runtime 不得取得 comparison 表授权或函数 owner membership。另一个拟议 `wiseeff_mod_d02_capture` LOGIN 只会得到 schema `USAGE` 与精确函数 `EXECUTE`，不加入 Governance/Catalog/Cutover/Verification 或 migration-owner role。拟议函数内部要求相应 `session_user` 和固定 owner `current_user`，核实两者不是 superuser/BYPASSRLS，从 `PUBLIC` 撤销 EXECUTE，固定 `search_path`，并限定所有非系统对象的 schema。

TypeScript provider 必须先在 `wiseeff_mod_d02_source_reader` 连接上构造 batch，再由独立 capture connection 通过这一个函数调用提交。函数在同一事务内取得 auth session、user/role 行的 `FOR SHARE` 锁，以及 modules、registrations、placements 的 `SHARE` 表锁，然后核对完整 MOD inventory 的数量/校验和、每个已锁定 module 的 `id/kind/origin/parentId/attributionSubjectId/sourceKey` 与 case legacy observation，以及精确 Registration/Placement 关联。函数原子插入并验证每个 case/result 配对及 audit，在提交前强制检查 0179 deferred constraint；0179 负责绑定 run/P7 selection，却不会拒绝缺少 result 的 case。函数不会重复 TypeScript 语义 provider，也不声称其 observation 为真。拒绝分离的“先加锁”函数再加 API 直接 DML：锁按事务生命周期释放，API 直接 DML 仍会报 `42501`。独立 P11 verifier 仍负责验证源边界和全部 family 的语义等价。

函数自行负责固定 audit 写入。现有 TypeScript `withAuditedWrite` helper 可以共享一个 `Database` 事务，但它通常直接执行的 audit INSERT 会以 capture LOGIN 身份运行，而该 LOGIN 刻意没有 `audit_events` 的直接授权。其 `public.audit_events` 行使用重新核验的组织及用户（`actor_type='user'`），固定 `app='release-verification'`、`kind='mod-d02-comparison-capture'`、`action='capture-pre-activation'`、`severity='Medium'`、`target_type='cutover-run'`、`target_id=runId`；`trace_id` 为经校验的服务端 request ID。metadata 只包含稳定的 manifest/projection 与源 inventory 摘要及 case 数量。新增/回放计数只放在调用回执中，不作为重试时比较的 audit 内容。由组织、run、request ID 的长度前缀编码生成确定性 ID；同一请求重试须按 ID 读出已有 audit 行并核对所有稳定字段，内容精确相同才返回；不同请求可另记回放事件。audit 失败使 case/result 事务回滚。这是拟议新增的固定事件 definer 例程，不是已有应用 audit helper，也不是已授予的能力。

仅供复核的不可执行 SQL/call 草图。签名、参数和回执字段为具体建议；函数体占位符有意使其无法作为 migration 执行。不得应用：

```sql
-- PROPOSED ONLY; NON-EXECUTABLE PSEUDO-SQL; NO MIGRATION NUMBER ASSIGNED.
CREATE ROLE catalog_mod_d02_capture_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE wiseeff_mod_d02_source_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE wiseeff_mod_d02_capture LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT USAGE ON SCHEMA public, parameter_catalog, catalog_publication TO wiseeff_mod_d02_source_reader;
GRANT SELECT (id, user_id, organization_id, token_hash, expires_at, revoked_at)
  ON public.auth_sessions TO wiseeff_mod_d02_source_reader;
GRANT SELECT (id, organization_id, name, email, title, is_active)
  ON public.users TO wiseeff_mod_d02_source_reader;
GRANT SELECT (id, name) ON public.organizations TO wiseeff_mod_d02_source_reader;
GRANT SELECT (user_id, organization_id, project_id, role_id)
  ON public.user_role_bindings TO wiseeff_mod_d02_source_reader;
GRANT SELECT (user_id, username) ON public.user_password_credentials TO wiseeff_mod_d02_source_reader;
GRANT SELECT (id, permissions) ON public.roles TO wiseeff_mod_d02_source_reader;
-- 完整的拟议 source-reader 列集合见上方“可销毁 PostgreSQL 读取权限探针”。
-- 此处只是不可执行的局部草图，不能作为部署授权脚本。
-- No schema-wide SELECT, writes, or parameter_module_dismissed_compatibles raw read.
-- Never grant password_hash, audit access, or source writes to this reader.

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
GRANT UPDATE (id) ON public.auth_sessions, public.users, public.organizations, public.user_role_bindings TO catalog_mod_d02_capture_owner;
GRANT SELECT ON public.auth_sessions TO catalog_mod_d02_capture_owner;
GRANT UPDATE ON public.parameter_modules, parameter_catalog.organization_subject_registrations,
  parameter_catalog.subject_placements TO catalog_mod_d02_capture_owner;
GRANT INSERT ON parameter_catalog.parameter_catalog_comparison_cases,
  parameter_catalog.parameter_catalog_comparison_results, public.audit_events
TO catalog_mod_d02_capture_owner;
GRANT SELECT ON public.audit_events TO catalog_mod_d02_capture_owner;
GRANT EXECUTE ON FUNCTION parameter_catalog.assert_catalog_subject_active(text,text,text,text)
TO catalog_mod_d02_capture_owner;

CREATE FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(
  p_run_id text, p_auth_session_id text, p_principal_id text, p_organization_id text,
  p_plan_digest text, p_target_artifact_sha text,
  p_release_id text, p_release_digest text, p_source_snapshot_fingerprint text,
  p_manifest_digest text, p_projection_digest text,
  p_case_batch jsonb, p_request_id text
)
RETURNS TABLE (
  organization_id text, selection_run_id text, selection_projection_digest text,
  source_inventory_count integer, source_inventory_checksum text, case_count integer,
  newly_written_count integer, replayed_write_count integer
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS <reviewed body>;
ALTER FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,text,text,text,text,text,jsonb,text)
  OWNER TO catalog_mod_d02_capture_owner;
REVOKE ALL ON FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,text,text,text,text,text,jsonb,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA parameter_catalog TO wiseeff_mod_d02_capture;
GRANT EXECUTE ON FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,text,text,text,text,text,jsonb,text)
  TO wiseeff_mod_d02_capture;
-- Grant no table privileges and no role membership to wiseeff_mod_d02_capture.
-- 测试角色探针不授权任何运行时 GRANT。
```

```text
PROPOSED call: operator starts ops/self-hosted/scripts/upgrade.sh -> executeCutover returns completed P10
              -> preserve completed P0-P10 run receipt/checkpoints and re-prove P2 -> source_reader validates the Admin's
              local session and runs provideModParameterCatalogComparisonCaseBatchV2 on one root Pool
              -> createUserInvocation(auth) -> pass generated batch to capture function on separate capture DB
              -> function call(runId, sessionId, principalId, organizationId, planDigest, artifactSha,
              releaseId/digest, sourceFingerprint, manifestDigest, projectionDigest, batch, requestId)
              rechecks identity/source/pins under locks and atomically writes the pair/audit
              -> commit and close capture connection before separate full P11 verification.
```

SQL 函数接收 principal、organization 和 session ID；PostgreSQL 无法仅凭这些 ID 验证 bearer token。只有离线 maintenance resolver 可以验证 token 并构造可信 `AuthContext`；函数再在行锁下复核 session、active user 和持久化 Organization-admin 状态。该锁在提交前防止 session 撤销、user/org 改变或角色移除的竞态。Session 不绑定具体 action：数据库中的 expiry/revocation 是权威状态，且在此之前可重放。P2 期间 API 停止，过期 session 无法续期；流程必须拒绝并等待已接受的恢复路径。P11 开始前关闭函数和所有 capture connections。迁移 0179 验证插入行对应精确 run/P7 selection。这些行和 session audit 都不能证明 TypeScript observation 真实；只有独立 P11 可以。

拟议部署配置为 `MOD_D02_CAPTURE_ENABLED`（默认 `false`）、只读 auth/provider LOGIN 的秘密 `MOD_D02_SOURCE_READER_DATABASE_URL`、function-only capture LOGIN 的秘密 `MOD_D02_CAPTURE_DATABASE_URL`，以及从不可变 maintenance-package attestation 填入的 `MOD_D02_CAPTURE_ARTIFACT_SHA`。Capture 前，maintenance composition 比较 S7、source-reader 和 capture connections 的 database OID/身份及 target pins，并记录脱敏进程身份，以及每个数据库身份的 `session_user`/`current_user`、`rolsuper`/`rolbypassrls`。凭证或 artifact SHA 缺失、database/LOGIN 错误、权限过高、不支持的 auth provider 或 session 不匹配均保持禁用。Source reader 的精确 provider/Catalog SELECT allowlist 是实现前必须审核的事项；禁止宽泛 schema grant。函数将服务端提供的 artifact SHA 与持久化 run、release 和 manifest 比较。Session/database secrets 不得出现在 argv、输出、日志或子进程环境中。禁用 maintenance step 只停止新写入，不改变已提交证据。

启用离线 maintenance step 前的身份、权限和原子性验收要求：

- API LOGIN 直接对两张 comparison 表 INSERT/UPDATE/DELETE/TRUNCATE，或对三张加锁源/association 表 UPDATE，均以 SQLSTATE `42501` 失败；
- `PUBLIC`、worker、Agent、verifier、Governance 或未经授权的 API role 直接执行函数均以 `42501` 失败；
- 无有效 session 的调用、非 admin、inactive、跨组织、CLI 参数/终端身份替换、错误 run/phase、不完整 manifest、stale inventory、被修改的重试以及缺失 audit 均产生稳定拒绝，且不提交任何 case/result/audit 行；
- offline session resolver 拒绝 hash 错误、过期/撤销 session、inactive user 和被移除的 Organization-admin binding；不执行任何写入，包括 `last_used_at`；
- auth/provider source-reader 与 capture LOGIN 对 comparison/source UPDATE/INSERT/DELETE/TRUNCATE 及禁止的锁操作均以 SQLSTATE `42501` 失败；
- 有效完整写入一次性插入匹配的 case/result/audit；完全相同重放不插入新行；任何中途 constraint 或 audit 错误回滚整个操作；
- 历史 raw-read gate 使用单独的只读 verifier 凭证运行，并证明写操作以 `42501` 失败。

以上均为建议验收条件；当前集成测试中的角色只提供 disposable fixture 证据。

## Archive 保留与回滚

Comparison 证据只存储类型化 Archive ID 及 mapping/manifest digest，永不存储 Archive payload bytes。Archive relations 与 objects 保持 append-only，按 protected-reference、audit、business 和法律义务中最长的期限保留。P16 cleanup 和应用回滚都不删除 Archive 或 comparison history。禁用或回滚 maintenance step 时，撤销专用函数 EXECUTE grant 并禁用/轮换专用连接 secret；保留 0179 及所有已提交的 case/result/audit 行。不得执行 down migration 或擦除数据来制造旧 binary 兼容性。建议 migration 只允许前向添加；准确版本号只在批准后分配。

## 剩余审批边界

唯一审批包包括拟议的只读 local-session resolver 和 source-reader connection、provider-to-capture 拆分、专用 capture connection/function capability 及原子 audit 路径。本地 session 认证的是可重复使用的 WiseEff 账户；它不绑定 run，也不证明现场真人。Run-bound one-time permit 或真人身份保障目前均无契约，需单独审批。OIDC/HMAC 部署不受此 seam 支持。已接受的独立 P11 verifier 仍是其现有契约规定的单独阻断前置条件；当前 self-hosted controller 尚未实现 P11-P13。批准或本地测试通过本身都不授权 Hosted/target 凭证、生产调用、P12、candidate API 启动或公开发布。在审批包与 role-faithful 测试完成前，v2 writer 仍只是可测试的内部 primitive，独立 P11 comparison 仍是单独的必需 gate。

## 文档影响矩阵

| 范围 | 路径 | 动作 |
| --- | --- | --- |
| 提案 | 本文及 `docs/exec-plans/active/` 中的英文配套文档 | 同步更新 |
| 已接受的安全与 P11 契约 | `docs/SECURITY.md`、`docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md`、`docs/design-docs/parameter-catalog-cutover-archive-rollback.md` 及适用中文配套文档 | 审阅；仅在拟议能力获批后修改 |
| 运行时维护验证 | `docs/developer/verification-matrix.md` 与生成的数据库 schema 文档 | maintenance step、角色或 schema 实现时更新 |

## 文档更新门禁

本提案在唯一审批包得到决定前保留于 `active/`。英文与中文文本必须保持等价，且 `npm run docs:check` 必须通过。后续实现需更新已接受的安全、维护、schema 与验证文档，才可声称新操作已启用；本提案本身不改变这些运行时契约。
