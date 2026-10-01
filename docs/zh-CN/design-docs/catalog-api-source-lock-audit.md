# Canonical API 来源行锁能力审阅

> English: [API source-lock audit](../../design-docs/catalog-api-source-lock-audit.md)

## 待批准的具体能力，尚未实现

固定源码为 A #939 `8dd0ea074e6686ba58d773c99c5a387050fb937c`，tree `1ed21d931af9f4badd8e1c461ce2b70953684379`。本独立文档后继不改授权、迁移、provisioning、SQL 或 #939，不纳入 #1008/#1009。[脱敏测量](../../exec-plans/active/849-inventory/issue-853-api-source-lock-audit.json) 保留逐列 ACL 和全部71条探针。

正式 lab provisioner 创建的 API LOGIN 可以读三处受保护对象，但不能执行所需行锁；base Binding 和公共来源链锁实际成功。现有可调用 controlled function 不满足缺失的读取/锁契约。建议批准后只新增下述一个 function-only 能力，不给 API 表/视图 UPDATE、不删除锁，也不借用历史维护 reader/capture 的批准扩大 API 能力。

## 环境与证据边界

专用 PostgreSQL16.14/pgvector0.8.6，库 `wiseeff_a_api_lock_20261001`，隔离对象存储，实际180条迁移至0182。管理员准备现有 canonical DTS 夹具；随后原样调用 `provisionPublicationRuntimeLogins(mode="lab")`，没有追加 GRANT。这是该源码正式实验室配置的能力，不是目标部署账号证据。

API LOGIN `wiseeff_ra_aapilock20261001_api` 为 LOGIN/NOSUPERUSER/NOINHERIT/NOCREATEROLE/NOCREATEDB/NOBYPASSRLS。成功的普通探针逐条记录 session_user=current_user，事务前后 PID 相同。拒绝记录来自同一个 API client，catch 未另存 actor/PID，不冒称每条错误都带完整身份字段。writer 对照显式 SET LOCAL ROLE，与普通 API 身份分开。

71条记录为 **60成功查询/owner调用、9次预期42501、2次应用类型拒绝**，不是71项完整业务验收。原始 ACL 查询故意不带租户过滤、只取一行，用于隔离权限；真实 owner 调用使用源码作用域。被检查对象 RLS=false，不能从 SELECT 能力推断租户授权。AuthContext 来自持久化用户夹具，不代表 OIDC、真实HTTP、浏览器或目标身份；没有设备I/O。

原190表逻辑计数/hash及对象hash比较前后完全一致。复核发现原快照包含夹具凭据表的派生指纹；交付JSON和保留的本地JSON现排除六张凭据/session/token/webhook表摘要，仅发布184表摘要及一个对象hash。原始相等结论保留为实测记录，被排除的hash/行不作为交付证据；后续采集须在读取前排除这些表。每个探针回滚。统一 postgres 租约覆盖迁移、角色配置、LOGIN、关闭和清理；API连接0、lab角色0，独立重获租约成功，之后删除自有容器及生成的私有连接文件。未发布凭据或整行数据。空表的成功锁语句只能证明权限，不能证明锁到实体。

## 实际对象、列权限与锁矩阵

表名以 public 或 parameter_catalog 限定。S为SELECT、U为表UPDATE；每个被检查列的S/U与该表或视图一致，完整列名与逐列布尔值见JSON。U只说明语句权限，不代表绕过不可变触发器。

| 对象 | S/U | UPDATE NOWAIT | SHARE NOWAIT | 夹具行数 | 实际消费者/作用域 |
| --- | --- | --- | --- | ---: | --- |
| public.debug_nodes | 是/是 | 成功 | 成功 | 0 | DBG组织内node关联 |
| public.dts_config_set | 是/是 | 成功 | 成功 | 1 | 精确来源set/member |
| public.project_parameter_files | 是/是 | 成功 | 成功 | 1 | 精确成员file |
| public.project_parameter_file_versions | 是/是 | 成功 | 成功 | 1 | 精确成员version |
| public.dts_config_revisions | 是/是 | 成功 | 成功 | 1 | 完整精确revision |
| public.dts_config_revision_members | 是/是 | 成功 | 成功 | 1 | 完整有序membership |
| public.dts_logical_nodes | 是/是 | 成功 | 成功 | 1 | 精确revision节点 |
| public.dts_logical_node_revisions | 是/是 | 成功 | 成功 | 1 | 精确revision图 |
| public.dts_node_occurrences | 是/是 | 成功 | 成功 | 1 | 精确revision图 |
| public.dts_property_occurrences | 是/是 | 成功 | 成功 | 1 | 精确revision图 |
| public.dts_occurrence_effects | 是/是 | 成功 | 成功 | 1 | 精确revision图 |
| public.project_parameter_file_candidates | 是/是 | 成功 | 成功 | 0 | 来源锁后的自有candidate |
| public.project_parameter_value_drafts | 是/是 | 成功 | 成功 | 0 | 冻结选中draft |
| public.project_parameter_value_change_requests | 是/是 | 成功 | 成功 | 0 | 作用域request/reviewer |
| public.project_parameter_value_change_targets | 是/是 | 成功 | 成功 | 0 | request有序targets |
| project_parameter_source_occurrences | 是/否 | **42501** | **42501** | 1 | 完整org/project/config-set集合 |
| project_parameter_bindings（base） | 是/是 | 成功 | 成功 | 1 | cohort/base身份 |
| current_project_parameter_bindings（view） | 是/否 | **42501** | **42501** | 1 | 当前有效Binding，非历史替换行 |
| project_value_source_pins | 是/否 | **42501** | **42501** | 1 | 精确org/project/Binding/Value/pin |
| project_parameter_values | 是/是 | 成功 | 成功 | 1 | 精确Value/Binding |
| binding_history_events | 是/是 | 成功 | 成功 | 1 | 保留的精确历史 |

真实 DBG pin 为不带NOWAIT的FOR SHARE；独立SHARE NOWAIT探针在等待前就拒绝。真实DBG完整复核在view锁42501；真实来源完整cohort owner在occurrence锁42501。公共来源fence与独立JOIN FOR UPDATE OF binding均锁到真实行。后段writer角色的occurrence锁仍42501，不能替代前段能力。

## 实际调用链及可复用部分

- `provisionRuntimeLogins.ts:389–414` 给API Catalog SELECT、治理/workbench DML和可SET但不继承的coordinator/governance-writer/baseline-reader成员关系；未给occurrence/pin/view UPDATE，也无migration/synchronizer/maintenance/capture owner成员关系。
- `debugging/service.ts` 1474/1560/2131/2298 → `canonicalProtectedReference.ts:322–365`：公共来源prefix → 当前view UPDATE → pin SHARE → 精确Value/pin/revision复核 → I/O。独立历史 `assertDebugHistoryPin` 精确保留读取成功，不能改称当前tip。
- 草稿/提交/审核/member：`canonicalSource.ts` → Values owner `values/service.ts` → `values/repositories.ts:129–163`，完整有序occurrence锁与重读、base Binding锁与重读、当前投影+Value/pin。member在后段reviewed tombstone SET ROLE之前已执行这些锁；Values写入/member apply另有 `loadBindingById(...,"update")` 当前view锁。
- 原样复用 `sourceVersion.ts:lockExactSourceRevisionsForProof`：set → file → version → revision → membership → logical nodes/revisions → node/property occurrences → effects，排序、完整集合重读、128成员/100000行限制及busy语义保留。随后canonical occurrence/Binding，再按原调用者顺序锁workflow；不得把新Catalog锁提前到公共prefix之前。
- 复用服务器授权、持久化项目/指派审核人校验、trusted invocation、来源/cohort证明、pending守卫、约束、审计及原子事务。`server/shared/database/client.ts` 一个client执行BEGIN/callback/COMMIT或ROLLBACK；新入口必须接同一caller Queryable，不能另取root pool连接；嵌套savepoint政策保留。

检查了103个函数：没有API可执行的这三处读取/锁契约。writer可执行的 `assert_catalog_subject_active`、`ensure_dts_observation_source_occurrence`、`insert_reviewed_member_tombstone` 分别是Subject、producer和受审写入；trigger不是普通API。发布guard不能代替来源行fence；0182历史枚举和D02 capture仍只属于维护契约。JSON保留函数定义hash/ACL，不能仅凭文本命中或名称认定可复用授权。

## 一个最小 function-only 审阅方案：需人类批准

提议 `parameter_catalog.lock_canonical_source_read(organization_id text, project_id text, request jsonb)`；这是待审签名，没有部署。request为封闭的三种已有操作，不接受任意表、SQL、谓词、锁模式或组织列表。

| 操作 | 必需身份 | 固定动作及输出 |
| --- | --- | --- |
| source-cohort | configSetId、完整预期occurrenceIds/bindingIds | 校验作用域；精确排序快照；occurrence UPDATE NOWAIT后base Binding UPDATE NOWAIT；完整集合重读；返回给既有Values投影的身份 |
| current-binding | bindingId、预期definition/effective-revision/Value | 先锁作用域base行，再读权威current view并逐字段复核；只支持Values owner原有update/share并保留调用者等待政策；区分替换/缺失 |
| source-pin | bindingId、ValueId、pinId、预期configRevisionId | 精确关联/作用域校验；按现有等待政策pin SHARE；返回精确锁定身份 |

current-binding的base锁后立即current资格重读是**待证明的等价方案**，当前权限探针没有证明替换/发布并发安全。Catalog/Values owner必须先证明它；不为DBG多锁整个cohort来凑共用，也不给API view UPDATE。

- 独立 `catalog_source_lock_owner`：NOLOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS，API/其他调用者无owner成员关系。仅schema USAGE、四对象SELECT、occurrence/base Binding/pin的UPDATE(id)满足PG行锁权限。新owner权限也需审阅；不能仅凭NOLOGIN宣称直接写入不可达。
- SECURITY DEFINER、VOLATILE、固定 `search_path=pg_catalog,pg_temp`、对象全限定；无动态SQL/DML。未知字段/类型、null/重复/错配身份、超限集合、缺失/替换行、完整集合漂移均失败。超限须在阻塞工作前拒绝，不能截断库存。
- 撤销PUBLIC EXECUTE；批准后仅经既有provisioner给认可API运行LOGIN该**精确函数**EXECUTE，不给表/view UPDATE、owner成员关系、默认EXECUTE或维护reader/capture扩权。baseline/worker/manager/D02仍拒绝，除非另行批准。
- 服务器从真实认证持久化上下文与证明派生org/project/身份，在同一caller事务前校验精确用户项目动作和人工指派审核人。DB函数验证关系作用域，不证明共享API LOGIN传入userId的真实性。API已有广泛SELECT且RLS=false，继续信任服务器授权边界必须明示，不包装成独立DB用户鉴权。
- 公共来源prefix先锁；新函数与所有后续操作共用同一tx/client。结果仅在当前事务有效，不做token/cache。PG函数本身不能证明外部事务会持续打开，owner wrapper及caller测试必须拒绝pool/autocommit误用。漂移/busy/权限或后段apply失败回滚，不继续I/O或部分写入；人工审核、审计及约束不绕过。
- 撤回该精确API EXECUTE后新调用42501；现有行权限不变。REVOKE不取消已执行调用/已持有事务，需另审drain政策；provisioner重跑不能偷偷复活已禁用能力。

## 下一位owner及缺少的验收

Catalog授权/Values owner在能力批准后实施；A负责共享ACL/历史阶段验收。协调者核对所有已交付head后分配唯一前向迁移号；此处未预占编号。

必需反例：真实批准LOGIN、同一PID/事务、实体行与双client竞争；cohort插入/删除/改归属；current替换/发布/Value/pin漂移；PUBLIC/worker/D02的EXECUTE拒绝；函数拒绝错配的关系org/project身份；真实应用AuthContext拒绝无权限项目/其他组织用户（共享LOGIN没有逐人RLS）；occurrence/pin/view直接DML仍拒绝（base Binding既有DML属于独立契约）；未知/超限输入；合法保留读取；审核原子性/晚期失败回滚；撤EXECUTE及provisioner禁用；零LOGIN连接/角色清理。保留404/403和stale/pending/replay契约。

D提供的HTTP500/42501、零变化快照，以及Catalog current/pin42501为其他owner输入，不是A本次真实HTTP验收。JSON lifecycle/pending和DTS locator尚未到达。目标账号、浏览器、设备、完整backend、build及新Hosted均未运行；固定树native3562/3389/173 exit1属于继承证据，未重跑，文档不授Catalog许可。已中断的旧#1006复核排除；另建本契约独立只读复核，结果及配置不可核验边界记录在独立PR。
