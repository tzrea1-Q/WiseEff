# T1.1 重开评审修复设计

> English: [English](../../../../exec-plans/active/849-inventory/source-occurrence-review-repair-design.md)

状态：已授权 Scratch 修复。限定设计评审后，用户明确接受修订未发布 0151，并保留原字节、已有任务库／receipt 与 0152。不授权重写已应用历史、缩减范围、commit／PR／合并或开始下一 todo。配套：[威胁矩阵](source-occurrence-threat-matrix.md)、[schema 契约](source-occurrence-schema-contract.md)、[workflow 契约](source-occurrence-workflow-contract.md)。

## 已授权 R5／R6 续行（2026-09-17）

用户已明确允许整体验收检查点中的 R5／R6 设计复审、修复和验收。完成 T1.1 本地验收／封板准备后停止；不进入 T1.2，不 commit、PR、合并、部署或重写历史 receipt。这是重新进入威胁矩阵／设计门禁，不代表跳过独立复审。以下具体任务包须获得 Standards 与 Spec 两路设计批准后才修改生产代码。

### R5：唯一 canonical locator 表示

现有 adapter 与其他正式 pin writer 一致，使用 `serializeContract(locator)` 计算摘要；复用既有 serializer，不新增 helper／格式。同步两个直接测试 proof 构造器和共享 source-backed 夹具。保留精确 locator shape、真实 ObjectStore／CST 证明、值一致性、重放、角色／租户及 owned-source-commit 限制。合法 canonical proof 必须成功；原先接受的紧凑／插入顺序 JSON 摘要必须在任何 Binding／value／history／pin 写入前拒绝。原生 adapter 测试用字面量排序、两空格缩进、LF 终止的 locator preimage 独立计算期望，并保留既有固定 SHA-256 向量；不调用生产 serializer 自证。既有持久 pin／receipt 与所有迁移字节不变，不加旧摘要兼容回退。

### R6：snapshot 准备先于写事务所有权

保留 `loadPublishedCatalog(pool)` 的现有语义：immutable release snapshot 可以在 publication 推进后继续使用固定版本。不增加 latest-release 限制，也不让 Catalog Kernel 的 repeatable-read 事务借用业务事务。

- `syncPublishedCatalogProjectValues(pool, input)` 保留为 direct-pool 入口。先加载 snapshot；空 Catalog 不获取写连接，直接返回零。之后获取一个 client，BEGIN 一次，调用事务内操作，COMMIT／ROLLBACK 一次并释放。不递归，不保留可选 session 回退。
- 抽取既有写主体为 `syncPublishedCatalogProjectValuesInTransaction(tx, snapshot, input)`。必须传入非空 `CatalogSnapshot` 和已有事务 client；不接收 pool、不加载 snapshot、不开始／提交／释放调用方事务。保留来源排序锁、所有权校验、pin／value／history 写入、CAS 和可重试冲突转换。复用现有类型，一个共享 input type 即可，不新增抽象或依赖。
- HTTP `syncLatestPublishedValues` 在 `withAuditedWrite` 前准备 snapshot；无 Catalog 仍是零写入／无审计的 no-op。审计回调只调用事务内操作，鉴权和持久审计语义不变。
- seed materialization 已在 staging 前准备 `snapshot`，直接复用这一版本进行注册及各项目事务内 sync，不在 `root.transaction` 内重新读取。保留现有无 Catalog 语义。其既有 advisory-lock session 单独持有：整个 seed 操作仍需要锁连接加工作连接；R6 不承诺整个 seed 编排可用单连接，也不改写其锁生命周期。项目 sync 不得再取第三条连接。
- 更新所有调用方和既有外层回滚测试。不伪装 Pool、不新增 pool cache、不嵌套 BEGIN、不全局增大 pool／放宽 timeout。

### 已接受验证 seam 与评审任务包

沿用用户已确认的原生 seam：`mapLegacyBinding`、direct／caller-owned canonical sync、真实鉴权 sync route 和 seed materialization。R5 先以独立编码 locator 暴露合法 proof 拒绝，再证明旧摘要拒绝及既有 adapter／replacement 回归。R6 先复现 `max:1` direct sync（含空 Catalog），再证明 populated sync、外层回滚／审计原子性、连接释放与满池完成。并发来源锁竞争只允许返回既有可重试冲突，不允许 pool 取连接超时。复用真实 PostgreSQL、已发布夹具 snapshot 和既有真实来源夹具，不 mock pool；仅使用 55438 上 helper 新建的临时库。

实施归属：父端负责 R6 集成、R5 最小 serializer 修正及文档；如派发测试子任务，必须路径不重叠。独立 Luna／max 评审者负责 Standards 与 Spec。两路设计批准后按 seam 进行 Red→Green、窄回归、build／Node TypeScript／contract／docs／boundary，再独立封板前复审。预计不改 SQL／schema／fingerprint／allowance。此前整体测试和 PC 证据保留明确时间／候选范围，不把生产修复前的记录改称修复后新执行。

### R5／R6 执行回执

生产修改前，两路独立 GPT-5.6-Luna／`max` 设计评审均通过。R5 复用 `serializeContract`；独立字面 locator preimage 先复现 canonical 输入被拒绝，修复后接受。compact JSON 摘要被拒绝，Binding／value／pin／history 数量不变，canonical 重放稳定。原生 Red：11:56:18，1 失败／8 项被选择器排除；Green：11:57:25，完整 adapter 文件 **9/9**。

R6 按上述设计拆分 snapshot 准备与调用方事务内操作，全部 direct、HTTP、seed 及测试调用方已适配；seed 保留 null snapshot 无操作和原有整个编排至少两连接的边界。原生 Red：11:57:54，空 Catalog、`max:1` 报 `timeout exceeded when trying to connect`（1 失败／9 项被选择器排除）。12:00:11 Green：sync、drafts 与三份 seed 测试 **33/33**，无跳过。覆盖空 Catalog 单连接、已物化 Catalog 单连接四并发重放、唯一连接上的调用方事务、既有强制 value／audit 回滚、连接释放及池健康。max-one 的非空用例是重放，不是初次创建；既有初次物化用例通过普通池上的事务内接口验证。未放宽超时或生产连接池容量。

12:07:23 最终受影响集合：**19 文件、171 通过／0 失败／0 跳过**，127.96 秒，使用 helper 新建原生 PostgreSQL 库。覆盖 Binding／迁移、values、sync／routes／drafts、seed、JSON 流程和 DTS 源证明。build、Node TypeScript、OpenAPI freshness、UI ratchet、原生 `docs:check` 均通过；边界仍为 3513/3513 已批准，其余类别零。新增真实鉴权 HTTP、单 PC 观察、独立最终评审和准确停止边界见[整体验收回执](source-occurrence-whole-acceptance.md)。R5／R6 未修改迁移、schema 指纹、allowance、原归档或持久库 receipt。

## 前轮 R1–R4 边界与证据

后续整体验收另见 [2026-09-17 检查点](source-occurrence-whole-acceptance.md)。adapter 摘要与 sync 连接问题曾重开设计门禁；上文另获授权的 R5／R6 续轮不改写此前 R1–R4 历史回执。

- 仓库根／cwd 指令发现选择根 `AGENTS.md`，`AGENTS.override.md` 不存在；本次计划／迁移／source 目录未发现嵌套 `AGENTS*`。继承 HEAD 为 `f9c710f6a90d67462965a06abd47e33aa200e75e`，已接受 main 为 `46b6068693942b95f7cba28ee5de6748a97170fa`。本设计不 rebase、不改继承工作。
- 冻结 0151 SHA-256：`b2740b8ef3854661ef156bf63d0f83ba72403b41ba616ca0c02961964f65ed64`；冻结 0152：`fbdb6ae3efbae67476c7daf96491d08904b995d3654d6027cc07ad3a9acc88fe`。归档的原 0151 和当前 0152 未改变；明确授权的当前 Scratch 0151 已修订。
- 当前 Scratch 的 0151 未跟踪；本地 `git log --all -- server/migrations/0151_source_occurrence_identity.sql` 无提交结果。这不能证明远端／未观察部署中不存在该文件。
- 对任务持久库 `wiseeff_lane_849` 的只读查询发现 0151 校验值 `8930a209b4a2907a8bcfe297d1744c795fd0a8e4cacb1286b639988c39c86ad7`，应用时间 `2026-09-16T13:54:02.562Z`，无 0152 记录。这是另一历史候选，不能自动规范化校验值。未修改数据库或迁移历史。
- runner 先核验文件清单和已应用 checksum，再按文件名顺序、逐文件独立事务执行 pending 迁移。0151 失败就执行不到普通后继 0153。`before`／`through` 是测试／初始化范围，不是生产绕过手段。
- 用户澄清：“本任务测试库执行过就可以”。后续限定本任务测试库范围；这不是独立核实过的外部部署证据。现有 `wiseeff_lane_849` 及旧 receipt 均保持不动。已接受边界是：仅修订未发布 Scratch 的 0151，保留原冻结字节／摘要作为证据，用 helper 新建的临时库验证升级；不把任何旧已应用记录解释成新候选。

## R1——存量 observation/match 升级（两轴 P1）

空值拒绝先于实际回填，后续 `md5:` 赋值又违背规范参数 locator 的 SHA-256 要求。只移动 guard 或只改 digest 前缀均不充分。

**已接受的执行决策：** 普通追加 SQL 无法修复这个阻断在 0151 内的问题。在用户明确的本任务测试范围内，保留已应用历史，仅修订明确获准解冻的未发布 Scratch 候选。在生效迁移清单之外保留冻结 `b274…` 字节，0152 和已有 `8930…` 任务 lane 均不动。用原 migration runner 在 helper 新建临时库中验证 `0150 → 修订0151 → 0152`，已有应用记录的 checksum 冲突仍须拒绝。外部环境及其前向恢复合同不属于本次授权。不得 reset 旧 lane、删除证据让 0151 变空、插入先于 0151 的临时搬运方案、增加 checksum alias、跳过 SQL 或伪造已执行记录。

修复后的升级必须证明每个旧 observation 的不可变租户／项目／revision／file／property 归属及规范 format-tagged 参数 locator；歧义、缺失、跨归属或不支持的历史 locator 均整体中止。保留 observation／match／review-evidence 的 ID 和引用集合。使用与当前 ingest 一致的 locator／digest 表示，不能 hash 显示路径，也不能仅按名称或 raw value 相同推断。同一 root 的不同参数必须独立保留。

从 observation 自己的精确 typed locator 及历史 revision/member/file-version/node/property/effect 归属推导 root，不能依赖 `_0151_binding_roots` 或当前 Binding tip。要求唯一且一致的历史 root，按精确自然键创建／复用 occurrence，再证明各 match 与 observation、Binding 同源。保留原 source locator，不转换不支持的 legacy 形状。字段缺失／多余／非字符串、零个／多个归属候选、矛盾 effect 或跨归属事实均使事务中止。任何 JSON 身份须已有持久 schema/instance/file/root 及包含关系证明，不能伪造。在现有有序表锁下按 ID 排序锁定受影响 observation/match 及历史图行；精确回填成功后才完成非空／FK／唯一性检查。必须补存量 observation **与 match**、关联 review-evidence、历史 revision 不同于当前 revision 的正向覆盖；拒绝用例不能替代。

限定 Spec 评审区分了身份／归属证明与来源字节／值证明：持久图可以确定唯一 DTS locator 归属，但不能证明对象字节、CST 或真实来源值。observation 回填遵守 schema 契约 §2.5 和 Phase B，不能冒充另一条 adapter/replacement 来源值证明；后两条运行时路径的真实 ObjectStore 证明保持不变。0151 开头已有有序 `SHARE ROW EXCLUSIVE` 表锁，在 runner 的同一事务内覆盖发现、回填和约束校验，无需新增 migration hook 或锁框架。

已在任务 lane 只读验证规范 digest 的可行性：先校验 DTS locator 恰有五个字符串字段，再按固定 ASCII 键序、逐标量 JSON 转义、两空格缩进、LF 分隔及末尾 LF 生成精确 UTF-8，交给 `pg_catalog.sha256(bytea)`。这是有限 locator 序列化，不是通用 JSON serializer。SQL／TypeScript 两个逐字节相等向量通过：`{fileVersionId: "version-1", kind: "dts-property", nodeOccurrenceId: "node-1", propertyName: "clock-frequency", propertyOccurrenceId: "property-1"}` 的摘要为 `sha256:1b9ad36da413ad4a105de8eedaece29006c15816b74ce8628e8d7b9d03f3dea4`；property occurrence 后缀改为 emoji、property name 含中文／引号／反斜线／斜线／重音字符时也一致。实验使用 `BEGIN READ ONLY` 与 `ROLLBACK`，未实施迁移；后续原生升级测试须保留这些向量。

重放方案：仅撤回本次未发布候选给 `ObservationFingerprintModel` 新增的 `sourceOccurrenceId` 字段，恢复既有 evidence preimage。不重写旧 evidence fingerprint／receipt，不增加宽松 fallback。occurrence 仍由精确 replay key、完整 locator/evidence 比较及数据库归属检查独立约束。合法重放可以追加新 exact-key idempotency receipt，但旧 source-identity receipt、observation/match/review ID 均不变。覆盖重连后相同重试、同 root 不同参数、证据变化、错误 occurrence 及不支持的 legacy locator。schema 契约要求 occurrence-aware replay，不要求另造 evidence fingerprint 格式。

## R2——replacement occurrence 约束（Spec P1）

对已合法应用精确 0151／0152 的数据库，使用独立受审的新增迁移；编号仅在集成时保留。不改 0144／0151／0152。先检查既有 completed projection，新旧 occurrence 缺失或不同则拒绝，不重写历史。

在 replacement-project owner 上增加 deferred constraint trigger，覆盖插入及完成状态／新旧 Binding endpoint 变更。约束执行时读取最终行，不能使用排队的旧 transition。对 completed 行要求两个 Binding 均存在、属于记录的组织／项目，且非空 `source_occurrence_id` 相同；保留原 Definition/value FK。允许一个事务内合法的 pending→completed 转换。两个 current-binding resolver projection 也增加同样的 fail-closed 比较；零个、唯一和歧义结果语义不变。不增加运行时 DML grant、设备或发布权限。

同时保留并明确测试现有 ProjectValue/source-pin/current-tip guard：不能只因 Binding occurrence 相同，就接受错误的新旧值或 source pin。其 SQL／ACL 仍须在同一 owner 完成事务内生效。

## R3——共享完整 manifest 校验（Spec P1）

直接调用者为 `canonicalJsonSource.ts`、`canonicalSource.ts`、`sourcePropertyProof.ts`。只在现有 `sourceVersion.ts` owner 修一次：返回任何 member 字节前，对完整冻结成员验证 entry/include/overlay 的类型、安全路径和引用。复用 `normalizePersistedManifest` 与路径规范化，仅补其缺失的引用检查，不新增解析器。

DTS／混合集要求显式且唯一的 DTS base/entry、合法相对 include root，以及指向正确冻结 DTS member 的有序、不重复 overlay。混合集保留 JSON member，但不将其送入 DTS resolver。不选第一个 member，不以当前显示文件名替代。JSON-only 要求所有 member 均为 `format=json`、`entry_file IS NULL`、`include_search_paths=[]`、`overlay_order=[]`、`manifest_state=complete`，与现有 creator 的 `insertConfigRevision` 默认值一致。拒绝非空 DTS 字段；不能调用 DTS normalizer 伪造 base 或 `["."]` 默认值。异常类型、路径逃逸、entry/overlay 缺失或格式错误、alias 歧义及预算超限均拒绝；首次 `getBounded` 前完成全部元数据校验。可用规范化视图校验，但不悄悄改存储 manifest 身份，不改变已接受的历史生命周期状态兼容性。保持既有 DTS 规则：历史 `[]` 与 `["."]` 的有效 resolver 搜索路径均为 `["."]`，非空路径和 overlay 的顺序保留。返回／导出各 revision 的原始持久 manifest，而不是规范化视图；各自精确导出包须原样通过 reimport。`needs_review` 仍拒绝。保持每成员 2 MiB、128 成员、总计 32 MiB、元数据 8 MiB 限制。迁移校验位置本身不要求扩展公共 API。

## R4——JSON root digest 不可变（Spec P2）

现有 JSON creator 使用 `sha256:` 加精确 root pointer UTF-8 字节的 SHA-256，而不是 JSON 序列化。保持该表示。新增 DB 修复须拒绝只改 digest 的身份更新，在插入时校验格式及其与不可变 root 的一致性，对不一致存量先决拒绝，不能重写身份。DTS root/digest 仍均为空。保留同值无操作更新，actor ACL 不变。先核验数据库原生 SHA-256 支持再复用，不单为此新增 extension。

本任务 lane 的只读能力检查已找到 `pg_catalog.sha256(bytea)`，设计无需新增 `pgcrypto` extension 或 grant。这只是本地能力证据，不是修复执行。

## 必需 Red→Green 证据

| 修复 | 正向证明 | 拒绝／回滚证明 |
| --- | --- | --- |
| R1 | 存量 observation＋match＋review-evidence 升级保留精确 ID／引用；同 root 两参数保留；重连／重放不变 | 不可证明／歧义／跨归属／缺失 locator；一条坏行使 schema、数据、receipt 全部回滚；旧 checksum 冲突仍拒绝 |
| R2 | 同 occurrence completed replacement；事务内合法 pending→completed；新旧 resolver 等价 | 不同 occurrence/file/config-set/tenant、缺失端点、存量错误 completed；`SET CONSTRAINTS ALL IMMEDIATE` 与 commit 均拒绝，历史不丢失 |
| R3 | DTS include/overlay、混合集、纯 JSON，以及原已接受的各历史状态 | 异常数组、逃逸／缺失／错误格式 entry/overlay、alias 冲突及限额，经共享 loader **和公共 export/reimport** 拒绝；无部分响应或状态变动 |
| R4 | 空／转义／Unicode JSON root 及正确 digest；不变更新；DTS 空值 | 仅改 digest、格式错误／不匹配 digest 插入、不一致历史行；精确回滚与角色拒绝 |

主智能体负责处置、迁移及集成。实施子智能体仅接收受审的有限路径任务包，使用 GPT-5.6-Luna 当前最高推理档，不开／合 PR。Standards、Spec 保持独立，实施 WIP 至多二。每项先观察 Red，再跑聚焦原生 PostgreSQL，需字节时使用真实存储；最终迁移获批后再生成 schema／ACL 产物，执行 build／docs／boundary 检查。问题稳定前不重跑之前的宽套件。新的 relocation destination 字节变更需独立精确数据决策，不自动重签。UI 仍为单 PC 1440×900，本地证据不外推 Hosted／目标环境。

## Git & PR Workflow

保持 `codex/849-853-t11-source-identity`。用户现已明确接受具体修复合同及冻结候选边界。原 0151 保存在生效迁移清单之外的 `work/migration-evidence/0151-frozen-b2740b8e.sql`，修复前已核验 SHA-256 逐字节相同。不授权 commit、PR、合并、目标执行或下一 todo。

实施任务包：`r1_upgrade` 独占 0151、其迁移集成测试及 evidence fingerprint／replay 测试；`r3_manifest` 独占共享 source loader 和聚焦来源证明／JSON 集成测试。二者均为 GPT-5.6-Luna／`max`，实施 WIP 二。主智能体负责文档、集成，并在释放槽位后处理 R2／R4。已有 `wiseeff_lane_849` 仅作已知服务／admin 连接定位，不得对其迁移或写入；每次运行使用 helper 新建临时库，记录精确 Red／Green 数量。独立评审者不实施这些修改。runtime usage 未知，不作整个程序的费用声明。

## 历史设计评审与验证

- 初次设计评审为 NOT READY。本次明确任务测试范围并补齐上文方案后，Spec 接受限定 observation/match 归属回填子合同；Standards 对精确 locator、原子锁定、digest 和重放设计给出 conditional PASS，无新增阻断。二者都不替代真实 ProjectValue/ObjectStore 证据或整候选验收。
- Standards 同时接受 R3 的既有有效 `[]`／`["."]` 兼容与原始导出身份不变规则，要求在 `getBounded` 前拒绝非法元数据。R2 仍保留 ProjectValue/source-pin/current-tip 测试；R4 须保护 root 不可变，不能只检查 digest 格式。具体 Scratch-0151 解冻仍需用户决定，不能从测试范围回答推导修改许可。
- 上一设计轮：`git diff --check`、文档治理及完整 `npm run docs:check` 已通过，schema 核验使用 helper 自建并清理的临时迁移 PostgreSQL 库。本次续轮：两个只读 SQL／TypeScript 精确字节 digest 向量、文档治理和 diff 检查通过。0151／0152 冻结摘要未变。两轮均未跑产品 build／回归套件，未实施修复，未验证目标环境。

## Documentation Impact Matrix

| 领域 | 处理 |
| --- | --- |
| 地图／产品／架构／参考 | No change：本轮不改 `AGENTS.md`、`ARCHITECTURE.md`、ADR-0046 与 #849 契约的不变量 |
| 计划／威胁／schema／workflow | Update 本文件、`source-occurrence-threat-matrix.md`、闭环 todolist 及中英配套；实施前 Review 同目录 schema/workflow 契约 |
| 迁移历史／安全／恢复 | Review `server/shared/database/migrations.ts`、`docs/SECURITY.md`、`docs/runbooks/README.md`；部署分类及恢复授权是明确先决条件，不是新增权限 |
| 质量／API／UI | No change：`docs/developer/verification-matrix.md`、`docs/developer/ui-quality-checklist.md`、公共 API／设计契约，沿用既有证据门禁 |
| schema／ACL／fingerprint 产物 | Update：实施后原生生成 schema，并将角色升级边界推进至 0153；OpenAPI 不变并核验漂移 |
| boundary 记录／allowance | No change：`scripts/fixtures/parameter-catalog-allowlist/` 保持获批字节，实际 consumer 漂移另行审查 |

## Documentation Update Gate

维护英文配套，交付前通过完整文档／diff 检查。迁移边界与来源证明接口现已获明确授权。原生修复证据与独立复审须和历史设计回执分别记录；仅设计评审不能关闭 T1.1 或开始 T1.2。

## 修复执行回执（2026-09-17）

明确授权的 R1–R4 Scratch 修复已实现并通过独立复审。开发者停止编辑后，主智能体先后接管 R3、R1；最终集成改动由主智能体负责。实施 WIP 不超过二，开发者和独立 Standards／Spec 评审者均为 GPT-5.6-Luna / `max`。未并发编辑相同路径，未 commit、PR、合并、重写已应用历史或开始下一 todo。

| 问题 | 最终处理 |
| --- | --- |
| R1 | 仅修订未发布 0151。按 observation 自身历史图／locator 回填，保留 ID、match、review 引用和旧 evidence preimage；确定性行锁置于原表锁围栏内。pin／observation 拒绝额外键和非字符串；数据库 owner 校验 DTS／JSON observation 的规范摘要。重放键改用无歧义 JSON tuple；多层 JSON Pointer 保留合法分段／转义，不再误拒。 |
| R2 | 新增 0153，预检已完成 replacement 端点，延迟检查最终行的同 occurrence／租户／项目约束，两种 resolver 均拒绝不一致投影；保留已有 source-pin／value／current-tip 保护。 |
| R3 | 共享 source-version owner 在读取对象前完整校验元数据；历史 entry／overlay 错误在 export／reimport 拒绝，零对象读取／状态修改。保留原始 `[]`／`["."]` manifest 身份及其既有等效解析语义。 |
| R4 | 0153 校验 root 精确 UTF-8 摘要，禁止仅改摘要的身份变更；历史坏数据整体回滚，同值更新仍合法。 |

交付时迁移 SHA-256 清单：

| 产物 | SHA-256 |
| --- | --- |
| 原 0151 归档（`work/migration-evidence/0151-frozen-b2740b8e.sql`） | `b2740b8ef3854661ef156bf63d0f83ba72403b41ba616ca0c02961964f65ed64` |
| 修订后现行 0151 | `fda64044cda15be8a3eade7463e1b4c7ba54b67e0ae5c4ecb0bdf5996e34e9a6` |
| 未改动的现行 0152 | `fbdb6ae3efbae67476c7daf96491d08904b995d3654d6027cc07ad3a9acc88fe` |
| 新增 0153 | `42783d4e0cb9cdd8635f44d27153e38677cd7ee1fc6911211df915d96b34a0f1` |

只读复核持久任务库 `wiseeff_lane_849`：仍仅有原 0151 checksum `8930a209b4a2907a8bcfe297d1744c795fd0a8e4cacb1286b639988c39c86ad7`，无 0152／0153 回执。旧库不是修订候选的验收证据；原 SQL 归档为本地 gitignored 证据，尚未提交。

验证记录：

- 真实初始反例：R1 带数据升级选中 1 项失败；R2 约束 4 失败／1 通过；R3 控制字符 manifest 选中 1 项失败；R4 摘要选中 2 项失败。这些有筛选的运行不代表完整套件。最后新增的 JSON 多层 Pointer 原生测试也在一行修复前失败、修复后通过。重放碰撞／伪摘要补充用例是在修复后加入，作为回归覆盖，不声称修复前 Red。
- 最终原生运行：**12 文件、183 通过、0 失败、0 跳过**，2026-09-17 10:52:48（上海时间）开始，耗时 29.82 秒。覆盖 `sourceOccurrenceMigration`、`drafts`、`sourcePropertyProof`、`canonicalJsonSource`、`sourceOccurrenceGuard`、`catalogRoles`、evidence `ingest` 集成／单元及 `jsonLocator`、replacement `execute`／`provenance` 和种子初始化 `archive` 集成。根库由 `withTempDatabase(prefix: "t11repairfinal")` 在专属 55438 pgvector 服务创建；套件按要求使用 helper 子库、实际运行角色及对象存储。这是本地受影响回归，不是完整后端／S1。
- 较早两次组合尝试（138/139、139/140）不作为通过证据：修正一处过时测试期望和一处超大 fixture 超时；预算 fixture 改为小规模两层 include 展开，仍超出原访问预算，未增大超时或产品预算。最终 183/183 运行替代上述尝试。
- 排除开发者较早误用默认 5432 的运行；只读检查未见残留 `wiseeff_r3red_%` 数据库，但其存储清理未独立证明。另一次误指旧任务库的尝试被原 checksum-drift guard 拒绝，同样不计入验收。没有标准化旧回执。
- 最终边界检查基于 `46b6068693942b95f7cba28ee5de6748a97170fa`：**3513 项／3513 已获批；未批准、过期、元数据不符、增长均为 0**。测试中的动态 SQL／越界原始 value 访问改为静态归属 SQL／现有 typed repository；未修改 allowance、检查器策略或 relocation 记录。
- 最终 `npm run build`、Node TypeScript 检查通过；保留既有浏览器 externalization 和大 chunk 警告。schema 已通过仓库命令在新建 PostgreSQL 临时库重新生成；本轮较早 OpenAPI／UI 检查通过，期间未改变 API／UI。完整文档和 diff 检查见下方文档门禁记录。
- **Standards PASS**：coercion P1 关闭，有界复审未见新增 P1/P2。**Spec PASS**：重放 tuple 和规范摘要 P1 关闭，含最后的 JSON Pointer 修正；R1–R4 范围无新增阻断。评审者独立读代码并引用主智能体测试回执，没有声称自行重跑。

文档门禁：`npm run docs:check` 的治理检查与原生 pgvector schema 比对均通过，使用 helper 新建的 `t11docsfinal` 根库，未跳过 schema 检查。`git diff --check` 通过。中英 todolist 和威胁矩阵已链接本回执，T1.1 保持未勾选。

本回执仅关闭重开的 R1–R4 评审清单。继承的 dirty candidate 仍未提交／封板，T1.1 保持未勾选，待整体候选验收／封板及交付授权。这里不提供 T3.1 完整后端／S1、T3.2 更广验收、S2、Hosted 或目标环境证据。本次后端修复无新增可见 UI 改动、无新浏览器证明；较早单 PC 1440×900 证据仍属历史，不改称当前。后续 todo 未启动。
