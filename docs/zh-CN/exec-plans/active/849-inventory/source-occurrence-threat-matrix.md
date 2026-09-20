# B1 来源出现身份：实施前威胁矩阵

> English: [English](../../../../exec-plans/active/849-inventory/source-occurrence-threat-matrix.md)

契约：#849、#853 T1.1 与 [ADR-0046](../../../design-docs/adr-0046-source-occurrence-identity-spans-dts-and-software-configuration.md)。
状态：SCRATCH／T1.1 本地验收与封板准备完成，未执行正式 SEALED 交付。[最终回执](source-occurrence-whole-acceptance.md)记录 R5／R6 独立设计批准、原生 Red→Green、Standards／Spec PASS、19 文件 171/171 受影响回归、明确真实鉴权上传／sync audit 及新单 PC 读回，关闭两项问题。此前 R1–R4 和 B1-03／06／29 保留证据范围。仅使用 helper 新库，原归档、迁移字节和持久历史不变。到此停止：无 commit／PR／合并、Issue 关闭或下一 todo。

## 工作分支与边界

- 最新 main 为 `46b6068693942b95f7cba28ee5de6748a97170fa`，包含 #883 的显式保存草稿改动。
- Scratch 分支为 `codex/849-853-t11-source-identity`，工作树位于 `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`。
- 继承的洁净 HEAD 为 `f9c710f6a`：P0/T0.6 五个提交完整保留到新 main 上，原工作树未修改；根工作区已从洁净状态同步到新 main。
- 指令发现：根目录无 `AGENTS.override.md`，选中 `AGENTS.md`；cwd 为仓库根目录，未发现模块级指令文件。用户全局指令继续适用。
- 风险为 R3。主智能体负责集成、迁移和矩阵；开发及独立评审者统一 GPT-5.6-Luna / max（较早运行时记录为 xhigh）。实施 WIP 不超过二，不并发编辑同一路径。
- 完成 T1.1 后停止并请求确认。不提前实施 T1.2/v4、完整种子重建、消费者族迁移、legacy 清退、数据处置或目标部署；本项不创建或合并 PR。
- 未请求自动续跑 Goal 或截止时间。用量数据未知；Hosted 和 seal/fingerprint 生成次数均为零。

## 实施契约

1. 增加统一不可变 occurrence 关系：组织、项目、配置集、类型、稳定实例、不可变文件 ID 以及格式专属 locator。DTS 使用真实逻辑节点，JSON 使用真实配置实例及严格 RFC 6901 Pointer，不伪造 DTS 节点或点号路径。
2. 原有 DTS Binding ID 和历史引用不变。仅使用可证明的源／文件／配置集事实回填；缺失、矛盾或多归属时中止迁移并给出可处理报告，不猜文件、不填虚假占位身份。
3. 先扩展，比较包含 replacement 投影的旧／新 DTS 读取，再切换为项目＋occurrence＋Definition 唯一性。完整矩阵通过前保留旧 logical-node 投影，禁止在 Binding 堆叠 JSON 可空字段。
4. 先回填再强化不可变触发器，启用新写入前锁定 occurrence/Binding 身份。Observation/match 的复合约束必须证明 occurrence 相同，不能只比较 Definition。已应用迁移不可改写。
5. 新 resolver 使用不同名称和显式最小权限；原三 text 参数函数保留为 DTS 兼容投影。多文件／配置集歧义必须拒绝，不能随意取第一行。
6. 文件／配置 revision pin 属于 ProjectValue 与源版本，不进入 Binding 身份。合法版本推进不创建新 Binding；文件／实例／配置集变化属于另一 occurrence。
7. 复用 canonical Binding、ProjectValue、真实草稿、评审、审计与受保护引用所有者。JSON 解析／定位／写回归 parameter-files，DTS 归 parameter-topology；不恢复 legacy 写入或新增发布旁路。
8. JSON 仅支持严格语法；重复解码键、非法转义、不支持语法、非有限或不安全数值转换、定位缺失／歧义、数组追加／非规范索引、过期版本都在发布前拒绝。保留标量类型、精度、数组及字面点号／斜线／波浪号键和无关语义；序列化改动进入可审阅 diff。
9. Candidate 和 pending draft 不改当前文件／值／配置指针。提交冻结准确 pin；独立授权的审批／生效重验 pin，并原子提交值、源元数据、历史、工作流及审计。对象准备失败不破坏旧状态。
10. 导出读取精确 pin 的源版本，不读取恰好当前的版本。重导入证明类型和值／定位等价。未知输入进入既有 observation/review，不自动发明 Catalog 身份。

## 威胁矩阵

以下为实施前定义的用例契约，不是当前未完成清单；实际处置见后续证据及最终整体验收回执。

| ID | 场景 | 预期可观察结果 | 证据所有者 |
| --- | --- | --- | --- |
| B1-01 | 空库及有数据 DTS 升级 | Binding ID、值、历史和 match 引用不变，无丢行 | 迁移 PG |
| B1-02 | 回填来源缺失、仅占位或矛盾 | 事务整体拒绝，明确未解身份；旧 DTS 数据可用 | 迁移 PG |
| B1-03 | 多文件／配置集／实例共用 Definition | occurrence/Binding 独立，写入隔离，不取首条 | Binding PG |
| B1-04 | 分别伪造组织／项目／配置集／文件／实例 | FK 和所有权拒绝，无外域行或字节泄露 | Binding PG＋HTTP |
| B1-05 | 改身份或删除／移动源父项 | 身份不可变，无级联历史丢失 | 迁移 PG |
| B1-06 | 同 Definition 但不同 occurrence 的 observation/match | 数据库拒绝混配；合法非空历史保留 | Observation PG |
| B1-07 | 普通、replacement、歧义身份的双读取 | 切换前唯一结果等值；replacement 一致；歧义拒绝 | 迁移 PG |
| B1-08 | 回填／不可变触发器顺序错误或写窗口 | 扩展整体提交或回滚，不出现可变身份窗口 | 迁移 PG |
| B1-09 | Reader/editor/governance/migration 与 PUBLIC 权限 | 精确 ACL，非法直写拒绝，真实角色 canary 通过 | 角色 PG |
| B1-10 | occurrence/Binding 重放与并发创建 | 唯一身份、稳定重放；冲突元数据拒绝 | Binding PG |
| B1-11 | 版本推进、丢响应及重试 | Binding ID 不变，仅一次有效推进，重放结果真实 | 工作流 PG＋HTTP |
| B1-12 | JSON 字面点号／斜线／波浪号／空／Unicode 键及数组 | Pointer 往返准确，仅修改目标，不按点号拆分 | JSON 公共接口 |
| B1-13 | 重复解码键、注释、尾逗号、转义错误、过大／过深输入 | 有界明确拒绝，无 candidate 或当前写入 | JSON 接口＋HTTP |
| B1-14 | 数值／小数／布尔／null／字符串／嵌套数组 | 不强制转换或静默丢精度；无法精确表达时明确拒绝 | JSON 公共接口 |
| B1-15 | 缺成员、错误转义、前导零／负数／追加索引、原型类键 | 不修改原型，不降级定位；合法自有键隔离 | JSON 公共接口 |
| B1-16 | DTS 重复节点、cells、include/overlay 与不支持语法 | 精确出现和定位，保留 cells 与无关源；歧义拒绝 | DTS PG＋源接口 |
| B1-17 | 预览／candidate／草稿创建、重载、删除 | 当前值／历史／源指针不变，真实 pending draft | 工作流 PG＋HTTP |
| B1-18 | 伪造 candidate 所有者、过期基底、错误文件成员 | 不改源并拒绝激活 | 工作流 PG＋HTTP |
| B1-19 | 无权限、跨项目、自审、Agent 来源行为 | 真实身份／角色／来源拒绝，拒绝审计持久保留 | 工作流 HTTP |
| B1-20 | 评审／生效前 definition/value/source pin 变化 | 提交前冲突，不伪造请求状态 | 工作流 PG＋HTTP |
| B1-21 | 并发评审／生效及无关文件编辑 | CAS 串行化，无丢更新或重复历史／审计 | 工作流 PG |
| B1-22 | 对象准备失败、对象落盘后 DB/audit 失败、pin 对象缺失 | 无部分推进；旧字节可读；标识孤立对象，不声称恢复完成 | 工作流 PG＋真实本地存储 |
| B1-23 | JSON 格式／键顺序变化 | 源 diff 可审阅；解析后无关语义全等 | 工作流 HTTP |
| B1-24 | DTS 与 JSON 正向全流程 | 预览→candidate→真实草稿→提交→独立审批／生效→重解析→导出→重导入，身份精确 | HTTP＋PG＋存储 |
| B1-25 | 其他文件／版本成为当前后导出 | 精确历史 pin 和字节，非最新快照；外域拒绝 | 导出 PG＋HTTP |
| B1-26 | YAML/TOML/ENV 项目源 | 明确 unsupported，无活动 Binding/value；厂商 YAML 不变 | 格式拒绝测试 |
| B1-27 | Capability 或无关种子／消费者漂移 | v1/v2/v3 含义／digest 不变，无 v4 或 TD-125 清理 | Diff＋聚焦回归 |
| B1-28 | 归档或 schema 清单漏新关系／依赖 | occurrence 纳入精确捕获边界，schema/ACL 增量明确 | 归档 PG＋生成文档 |
| B1-29 | 升级中断／重连或尝试降级 | 整体回滚或完整迁移；保留 DTS 投影，不改写迁移或破坏性降级 | 迁移 PG |
| B1-30 | UI 接收 JSON 值／源 diff／candidate 状态变化 | 单 PC 1440x900，角色／操作／键盘／snapshot／截图／console/network 实证，不用 mock 替代 | 受影响浏览器所有者 |

## 原生命令、接口与推进门禁

用户确认的 T1.1 已定义测试接口：迁移／SQL 所有权、canonical Binding/observation、真实鉴权的导入／草稿／评审／导出 API、源解析与写回。按垂直小步 Red→Green，不批量编写假实现测试。

- PG 使用 `npm run catalog:lane:env -- provision --issue 849`、doctor 和 `catalog:lane:accept`。不 reset 或使用共享 compose DB；测试前检查既有 lane 内容，临时测试库保留所有权及清理证明。
- 身份与并发复用 `binding/binding.integration.test.ts`、`binding/concurrency.integration.test.ts`；增加真实 populated-upgrade 案例。角色测试执行前核实准确现有路径。
- 工作流复用 `parameter-bindings/drafts/drafts.integration.test.ts`、`catalogProjectValueSync.integration.test.ts` 及 parameter-files candidate/parser safety。扩展真实鉴权 route 测试，不把 Admin 形状的服务参数称为鉴权证据。
- JSON 公共源接口增加窄测试，预期 pointer/content 使用独立字面量，覆盖严格拒绝。
- 候选执行受影响原生测试、typecheck/build、docs/diff；记录非零收集数及失败／跳过。预期收集数非零，实际数待执行。可见状态变动保留 #849 全部相关操作，单 PC 1440x900。
- 生产实现前，独立 Spec 和 Standards 评审矩阵与具体 schema/调用链；实现本地通过后，两者对同一个精确候选独立复审，不用实现者自审替代。
- 最终 schema、ACL、关系计数和 S2 fingerprint 仅从完整受审改动生成；无法解释的 capability digest 改动阻止 seal。

缺失证据由主智能体负责。下一步：解决独立设计发现，取得对抗性 Red，再进入 SCRATCH。文件或测试名存在不算通过。

### 独立评审结论与待确认方案

评审对象为继承 HEAD `f9c710f6a` 上尚未提交的矩阵，产品代码未改。`t11_design_spec` 返回未通过（1 个 P0、6 个 P1）；复用为独立 Standards 评审者的 `t06_status_audit` 返回未通过（4 个 P1、1 个 P2）。二者均独立于只读调查者 `t11_b1_recon`，统一 Luna/xhigh。测试路径 P2 已修正；实质发现仍未关闭，不声称复审通过。

用户在初次评审后的下一条确认中，已**接受以下两项决策**：

1. **显式 JSON 实例生命周期。** 首次明确导入／注册时，由 parameter-files 所有者生成服务端 opaque ID，绑定组织、项目、配置集、不可变文件 ID、明确选择的 ConfigurationSchema 及实例根／子树 JSON Pointer。版本推进／重导入只有在相同不可变归属与实例定位得到证明时复用身份。同一文件 ID 改名保留实例；换配置集、换文件 ID、换正式模型或移动实例根时创建新实例并要求显式映射，不自动转移当前值／历史。数组重排或过期 locator 不能仅凭索引推断身份延续。统一 occurrence 关系拥有实例身份，不伪造 DTS 节点、不从文件名猜主体。参数精确 locator 和版本 pin 与实例根 locator 分别冻结。
2. **旧身份无法证明时阻止整批升级。** 回填沿历史 `file_version_id → project_parameter_file_versions.file_id → project_parameter_files` 及完整归属校验，不依赖 `current_version_id`。任何旧 Binding/observation/match 仍缺唯一可信来源时，列出问题并回滚整笔迁移，保留旧 DTS schema／数据可用。不删除、不猜配、不静默忽略，也不自动隔离后宣称整体升级完成。将来如需隔离后继续，须另行接受该策略。

两项决策已补入 ADR-0046 的 2026-09-16 补充。确认仅允许继续设计／实现，不等于迁移验收通过或目标升级授权。[来源工作流契约](source-occurrence-workflow-contract.md)明确冻结输入、真实写回、精确导出、严格 JSON 与并发；schema 契约负责具体关系约束。

确认后，主智能体仍须补齐以下设计并重新取得两项独立评审通过，才能写生产代码：

- 冻结 occurrence、配置集、文件／版本、ProjectValue、observations/matches 的具体复合所有权键／FK；禁止会改归属或删除受保护历史的父项操作；区别身份占位值与真实有源值。
- 明确事务内 expand／backfill／等值验证／switch 顺序及旧 writer 拒绝机制；旧 resolver 对 replacement／普通多结果拒绝，不能保留 `LIMIT 1`。
- 明确唯一 canonical 源写回事务，按 occurrence／file／version／locator CAS。先准备对象，后将值／源元数据／历史／工作流／审计整体提交。当前 `writebackProtectedReference` 只追加 ProjectValue，不能充当源字节写回证据。
- 按冻结 revision 的成员导出，验证所有权和对象 digest，不用 current-only snapshot 冒充历史字节。
- 明确严格有界 JSON 解析、重复解码键与丢精度拒绝、Pointer／数组规则、防原型污染写回及非目标语义全等，保留原始源／diff 展示。

历史实现前状态：当时 T1.1 未勾选、T1.2 未启动，尚未编写迁移／产品代码。下方实现回执取代这条历史状态，但不代表 todo 已完成。

历史中间设计回执（2026-09-16）：收齐两份独立工作流评审后，修订了服务端 candidate/digest、值源原子 CAS、全部源 writer、全局锁、文档绝对 Pointer 和精确导出；当时 schema 发现仍待修订。

后续设计门禁回执：独立 `t11_design_spec` 与 `t06_status_audit` 均返回 **PASS，仅设计**。实际表锁、完整 pin 归属、当前占位值阻止整个升级、旧 resolver 歧义拒绝、全部文件／值 writer、防参数观察混并的精确重放键，以及 JSON 键和值的非法字符拒绝均已明确。不代表运行证据。开发 WIP 为二：`t11_b1_recon` 负责新迁移 0151 及专用 PG 测试，主智能体负责 JSON／来源／工作流代码；不并发改同一文件，不启动下一 todo。

### 已观察的预检证据

- 本地 pgvector 55438 的 `wiseeff_lane_849` doctor/provision 通过，`catalog_migration_owner` canary 通过，未使用 reset。准备前迁移到 0149，canonical Binding 为 **零**，不能作为 populated-upgrade 验收。
- 只读执行现有 JSON 公共函数：`{"a/b":1,"a":{"b":2},"unchanged":true}` 只产生值为 `2` 的 `a/b` 索引，字面斜线键丢失；`{"x":1,"x":2}` 被接受为 `2`。写回 `a/b` 修改嵌套成员，证明旧模糊 locator 不能冒充 canonical Pointer。
- 源码确认 `exportCanonicalBindingSource()` 返回 ProjectValue 的 config revision，却调用读取当前文件版本的 `loadConfigSetSnapshot()`。B1-25 必须校验实际 pin 字节，不只比较 DTO 的 ID。
- 文档治理与 `git diff --check` 通过；默认 schema-doc 子检查所选服务器缺少 pgvector，因此跳过。专用 lane doctor 通过不能把另一个跳过子检查改称通过。
- 确认设计后，用 `connectionStringFor("wiseeff_lane_849")` 设置两个数据库变量重跑 `docs:check`，退出 0：文档治理通过，**db-schema artifact is current**；此轮没有 pgvector 跳过。
- 行为 Red：`catalog:lane:accept -- --issue 849 -- npm run test:server -- server/modules/parameter-files/parseIndex.test.ts` 收集 5 例，4 通过、1 预期失败：解码后重复的 `limit`/`\\u006cimit` 键未抛错。此前默认数据库尝试因已有迁移 0118 checksum 漂移在 global setup 失败（0 例），不作为 Red 证据，也没有修复／重置该无关数据库。

## 实现检查点：本地、未提交、未完成

T1.1 仍未勾选。正在实现来源 occurrence/pin 迁移 0151、严格 JSON、canonical 初始化、精确历史导出、候选准备与共享生效。共享配置集缺口要求冻结 Binding 集合、不可变有序批次结果、单份生效审计及同级派生历史；中英 workflow/schema 已补充。下述限定 JSON 独立登录结果不等于完整工作流验收。尚无实现评审 PASS、PC 验收、Hosted／目标环境证据、commit、PR 或合并。

- 专用本地 55438 集群的一次性 PostgreSQL：结果字段／ordinal 修正后，迁移 tracer 4/4 与初版 JSON 来源集成 3/3 同轮通过。只代表限定本地证据，不是完整迁移矩阵。
- 后续原生执行 `canonicalJsonSource.integration.test.ts` 与 `configSetRepository.test.ts`，14/14 通过：覆盖候选集合冻结、批准后字节／值／pin 传播、获授权重放不追加记录、失权重放拒绝、旧成员添加入口拒绝。使用测试 AuthContext 与真实本地 ObjectStore，不是独立鉴权 HTTP 会话。
- pinned base 连续性、生效时 CST 复验及最终生效 occurrence 选择已通过 DTS 集成 9/9。alias 小步前，DTS／JSON／草稿联合执行 26/26（9+5+12）通过，包含双连接提交／编辑锁顺序和禁止直接 CAS 回退历史 tip 的 Red→Green。真实 JSON 读取／DTO 检查服务端 15/15、前端 41/41 通过，路由测试 17/17、DTS 根节点精确 span 检查 1/1 通过。均为限定本地检查，不是全套或独立登录会话验收。
- 最终 effect 的迁移证明 7/7 通过，覆盖 override 选择、并列最终 effect 及后置 delete。冻结来源 alias 的补充设计随后获得 `t06_status_audit` 独立限定 PASS，仅为设计评审。展示名修改后的历史导出已复现 Red（错误使用修改后的展示名）；alias schema／runtime 及新 Green 仍在进行，之前的通过数不覆盖这些修改。
- 2026-09-17 本地续行：alias runtime 与 DTS／JSON／草稿回归 27/27（9+6+12）通过。新 JSON 用例使用生产 server、项目软件用户与另一软件 committer 的真实本地密码登录会话、专用一次性 PostgreSQL 和真实本地 ObjectStore，证明待提交创建、提交、审批、重放、失权拒绝及精确导出；尚未证明初始来源注册／导入的真实鉴权或 PC UI。它发现并修复路由误读不存在的 `node.compatible` 列，以及首次响应／重放响应的草稿 FK 差异。随后“展示重命名后显式新增实例”用例在复用精确 pinned revision 后通过 JSON 7/7。临时诊断日志已删除。早先一次迁移语法失败收集零例，不计验收。
- Observation 角色忠实 ACL 后续 15/15 通过，包含拒绝直接读取来源表、允许 governance 经 owner trigger 写入；迁移 4/4 通过。随后提交请求的草稿解绑修正也通过迁移 4/4：仅允许 FK 单向解绑，禁止重分配／重新挂接。未增加来源表直读授权。
- 长期 `wiseeff_lane_849` 含早期 0151 草案 checksum，未改写／reset。新迁移和测试都用 helper 所有的一次性数据库并自动限定清理。默认共享库的 0118 checksum 错误收集零例，不计 Red 或验收。
- 当前开发 WIP 为二：主智能体负责导入／导出／来源写入整合；`t11_b1_recon` 负责真实 Binding 夹具、旧适配器及 Definition replacement 来源证明。UI 智能体已在 67/67 聚焦测试后冻结。转为实现者的设计评审者不能独立批准自身实现。
- 2026-09-17 补充本地整合检查：来源 parser／index／config-set／overlay 四文件安全测试 32/32 通过；0151 迁移 9/9 通过。Binding／并发加 observation 收集 25 例，16 通过、9 失败，原因是旧 Binding 夹具缺少强制 occurrence 和同事务真实 value/pin。Catalog roles 收集 25 例，22 通过、3 失败（清单缺两张新表、旧 observation-match 夹具、分步 ACL 升级未到 0151）。Binding／value 单元与威胁检查收集 11 例，9 通过、2 失败（已批准 occurrence 表未加入来源白名单；新 CAS 查询未复用已有 canonical 表名变量）。这些失败仍待修复，禁止放宽约束或删除原并发／归属断言以通过测试。
- 独立只读整合审计确认，除夹具适配外还有真实缺口：`mapLegacyBinding` 仍在缺少已证明 occurrence/value/pin 时独立创建占位值；Definition replacement 未继承 occurrence 或创建新值 pin；新 occurrence resolver 缺少旧 resolver 的 completed-replacement 投影。B1-07 要求修复并用原生测试证明等价。property-key 变更沿用 ADR-0034/0044 的 source-first 切换：缺少新 property 的精确来源证明时，应阻断项目并保留旧身份／值／来源；改写 `source_ref` 或复制旧 key 的 pin 不算来源证明。两张新表还须加入项目归档清单（B1-28）。
- 后续冻结 SQL／ACL 小步：实施者报告一次性 pgvector 库迁移 10/10、角色套件 25/25；0151 SHA-256 为 `b2740b8ef3854661ef156bf63d0f83ba72403b41ba616ca0c02961964f65ed64`。completed-replacement 投影及两张来源表的 ACL 清单已修复；生产 replacement／adapter 是另一小步，仍在实施。
- 主智能体的原生 HTTP 导入仅暂存精确 canonical 草稿，不移动来源／当前值；第二行非法 JSON 会回滚整批。独立审计发现草稿删除后的重放与对象复验缺口，修复后拒绝已删除／编辑的草稿及损坏候选字节，不自动重建。相同 JSON 值（含指数写法）标记为不变。JSON＋route＋sync 聚焦检查 41/41；前端 runtime／import／client 47/47 和类型检查在后续服务端修改前通过。指定历史值导出在 JSON 8/8 中完成 Red→Green；精确导出包重导入核验正在添加，尚不计验收。
- 原生双连接 Red 复现上传持有文件 FK 锁后等待配置集锁。旧上传／回滚／候选／基线／writeback／overlay 防护已前移至来源修改之前；批量基线先排序锁所有配置集，再锁文件。JSON＋成员＋候选激活＋基线聚焦检查 53/53。上述限定结果不代表长期 lane 重置、外部上线、PC 验收或 todo 完成。
- 下一次限定原生检查 JSON 10/10＋DTS 草稿 13/13（共 23/23）通过：精确导出包只读重导入、异常包拒绝、全部成员字节校验，以及混合 DTS／JSON 注册→草稿→另一用户审批→生效且保留 DTS 字节。归档纳入 occurrence／pin，适配后的类型化图夹具、精确外部 FK 与触发器清单 14/14 通过。历史值选择器正确编码后，前端 client／runtime／JSON panel 32/32。导入／导出的独立只读复核已关闭该轮发现，但不是整份候选的最终 Spec／Standards 批准。混合注册在复用现有 cohort 时也强制 resolved／complete DTS entry manifest；历史只读导出策略未变。
- 早期生成 schema／build 缺口由下述续行记录更新；最终受影响套件与独立评审仍未通过。

### 真实鉴权工作流与 PC 续行记录 — 2026-09-17

以下是继承 HEAD `f9c710f6a` 的本地 Scratch 证据，不是封存候选、完整 S1、Hosted、目标环境或发布回执。旧适配器／来源证明审查问题及受影响回归仍在修复，T1.1 保持未完成。

- 使用真实本地密码会话、55438 集群中 helper 所有的一次性 PostgreSQL、真实本地 ObjectStore，API 为 `http://127.0.0.1:63409`，前端为 `http://127.0.0.1:5174`。真实编译的 Driver／ConfigurationSchema 夹具通过实际 installer 安装，注册经过受保护 owner；不等同 publication-manager 或最终种子验收。
- DTS 和 JSON 的真实 HTTP 闭环均通过：导入预览 → 整批候选／草稿暂存 → 当前导出不变 → 提交 → 不同审核者查看固定差异 → 自审 403 → 批准 → 获授权重放响应一致 → 精确来源字节 → 历史／当前完整导出包重导入核验。occurrence／instance ID 保持不变。这里的重导入是约定的只读精确包核验，不是任意外部修改文件的生效。DTS 请求为 `pvcr_663afe24-8e43-4b50-8233-9e1260de877c`，JSON 请求为 `pvcr_798de146-d6ba-4afe-a6f1-fe4e1e556bb5`。
- PC `1440x900`，`liu.min` 访问 `/parameters?project=aurora`，`sun.mei` 访问 `/parameter-review?project=aurora`：实际 JSON 小数／DTS cell 编辑、原因、提交、独立来源差异审核／批准、键盘批准／历史导航、刷新、JSON 历史与来源包下载。最终值为 DTS `<1250>`、JSON `45.625`；4 条已批准请求仅见于历史，无审批操作。下载包包含两个精确版本成员，不只是可见 JSON 文件。非法 JSON 显示与 `aria-invalid` 关联的中文提示；未观察到页面横向溢出。
- 已检查任务工作区 `work/ui-checks/` 中 `t11-review-diff.png`、`t11-dts-review.png`、`t11-json-error.png`、`t11-author-final.png`、`t11-review-history.png` 和 `t11-json-source-package.json`。快照／命令回执在 `.playwright-cli/`；本地可执行探针为 `work/t11-pc-runtime.ts`、`work/t11-http-loop.ts`。这些被忽略的产物仅是本地证据，不是已提交／发布证据。浏览器发现并修复审核面板过窄、DTS 草稿错误回读配置修订、客户端遗漏 pending 状态筛选。
- 最终稳定浏览器检查：两会话均零控制台错误、各两条 CopilotKit `selfManagedAgents` 生产许可证警告，来源／历史读取成功。此前预登录 401、非法 JSON 400 按预期记录；开发 watch 重启另造成短暂连接拒绝及截图中断，只计随后成功复测。CLI 定位器／命令错误不计产品失败或通过。
- 原生失败注入现覆盖对象写入／读取失败、指针暂写后的审计失败（数据库全量回滚）、并发审批与重放。公共 DTS／JSON 混合集上传因语义 ingest 漏掉 JSON 成员先失败，已修复共享入口；JSON 来源＋文件 service 22/22 通过，其中 JSON 11 例。未重写长期 lane 或迁移 checksum。
- 最新前端聚焦执行 12 文件 129/129；build、UI ratchet、diff 检查通过。lint 为零错误、335 警告。构建仍有 Node 模块浏览器 externalization 与 >500 kB chunk 警告。从全新一次性 0151 PostgreSQL 生成 schema 文档，`docs:check` 无 pgvector 跳过地通过；验收 schema 指纹已核对更新，没有豁免检查。
- 扩展受影响服务端执行仍为 **未通过**：77 文件、593 例，567 通过／24 失败／2 跳过。父智能体负责的两处夹具／mock 失败后续联合回归 12/12 通过；其余 adapter／value／migration 夹具失败由实施者修复。独立审计另要求服务端派生旧身份证明、包含 delete 的唯一最终 effect、node 身份一致及固定成员别名。T1.1 完成前必须以最终回归和独立 Spec／Standards 评审替代此检查点。

### 后续限定 UI 复核及剩余门禁

独立审计发现三项 UI 回归：新 canonical 草稿绕过托盘、节点使能提交选择了错误 owner、下一条审核请求未自动加载差异。新增回归断言先有 4 项失败（50 通过／4 失败），修复后三文件 54/54 通过。现在把服务器真实草稿响应直接展示于托盘，不伪造其他 canonical 草稿的 base；canonical 与 legacy 按 owner 分流，混合提交在调用任一入口前拒绝；审核加载实际显示的请求。独立评审仅关闭上述三项，不代表完整候选 PASS。

最终前端聚焦收集 **13 文件 156/156**；再次通过 build 与 UI 检查。补充 PC 观察证明草稿立即出现并可移除，当前 JSON 仍为 `45.625`；驳回前一条审核后，下一条来源差异自动加载。两条探针请求均已驳回，未修改当前值。已检查补充截图 `work/ui-checks/t11-immediate-draft-tray.png`、`work/ui-checks/t11-auto-next-review.png`。这些扩充此前本地浏览器证据，不代表目标环境。

OpenAPI freshness 首次失败，原生生成器更新 `docs/generated/openapi.json` 后 `contract:check` 通过。使用受信 main `46b6068693942b95f7cba28ee5de6748a97170fa` 的边界检查器在冻结的 runtime-topology `ingestService.ts` 整文件 relocation blob 上 **失败**；既有精确身份决策不授权后续源码字节变化。未放宽 allowance、基线、relocation hash 或验证器，正在限定只读清点并确定处理路径。该门禁独立于产品测试通过结果，仍未完成。

### R3 熔断——重开来源／值证明

独立来源评审返回 NOT PASS，指出两项 P1 反例：`migrationAdapter.ts` 的精确属性夹具为 `<5>`，却接受调用方值 `0`；Definition 替换复制旧值 `5`，没有证明新属性值，因此可能将规范值 `5` 关联至来源 `<9>`。身份、最终 effect 和 member 核验不等于值等价证明。这是同一不变量的第二轮修复；按交付协议 Step 5，相关实现冻结，修订威胁矩阵和具体设计必须重新取得两名独立设计评审。此前局部通过不授权继续修补、封存或开始下一 todo。

最新独立夹具调整使用 fresh PostgreSQL，七个文件共 25 项：**22 通过／3 失败／0 跳过**。preview、guards、values、usage 通过。三个 adapter 用例仍期望对已有来源进行仅值写入，被 `owned-source-commit-required` 拒绝；修改生产或断言前须明确调用方及写入归属契约，保留拒绝用例和真实已批准来源的 CAS／并发证明。最新 lint 为零错误、333 警告。未修改持久数据库或已应用迁移。

边界核对发现新增 35 项、移除既有 6 项（当前 3548，基线 3519，allowlist 3513），另有三个 whole-file relocation blob 已变化。旧 relocation record 仅授权已评审的精确字节，不覆盖新增项。scanner、baseline、allowlist 和旧记录保持不变；生产读取须走有类型的所属模块操作，测试须使用真实支持的建立／观察接口。新 relocation artifact 须独立完成精确字节 Spec/Standards 评审，与来源值证明分开。

只读调用方分类：Agent／文件／DTS comparison contribution 传入 unbound 负向探针；cutover wrapper 仅检查接口形状，项目 wrapper 仅读取。当前树无 `saveCanonicalProjectValue` 生产调用方。真实初始化仍由 sync／JSON registration 承担；这些均不授权对已有来源仅改值。既有 JSON 审批并发覆盖同一请求的重复重试；新增回归须另证同 base 两个不同请求仅一方生效。

重开的中英设计在 fresh helper-owned 已迁移 PostgreSQL 上通过 `docs:check`（含 schema，无跳过），并通过 `git diff --check`。已关闭本任务 `t11-author`／`t11-reviewer` 浏览器，对核验过的 `work/t11-pc-runtime.ts` 进程发送 SIGTERM，正常经过 `finally`／`runtime.dispose()` 以 exit 0 退出；进程和 63409／5174 监听均已消失。本地证据文件保留；这些检查不代表设计或实现获批。

重开后的首轮两份设计评审均 NOT PASS：Spec 要求明确建 pin 前 owner 操作、replay 和无损比较；Standards 要求无环接口、精确 alias/include 证明、完整来源元数据／事实／workflow 锁及可执行事务／存储接线。父端进一步确认 overlay ref-path 可能不同于 resolved logical path；原始 locator 相等会误拒绝合法来源，同名／同 raw 匹配又可能选错 occurrence。中英 workflow 的具体修订覆盖上述问题，正在第二轮独立设计复审。重开门禁期间未修改生产实现。

重开后的第二轮设计复审：`t06_status_audit`（Spec）与 `t11_design_spec`（Standards）均对 workflow 的具体修订返回 **PASS，仅设计**。可按该契约恢复实施，不代表实现或完整候选 PASS。当前 local/S3 store 都以 SHA-256 和规范化名称生成对象 key；生产证明须保留内容寻址的不可变版本语义，测试使用真实 local 对象。父端负责精确来源读取／DTS proof 与 resolver origin，既有实施子智能体负责 adapter/replacement 及真实存储夹具，开发 WIP 仍为二。boundary/relocation 门禁独立保持未完成。

### 重开后的实施：精确 origin 与锁证据

父端复用既有 parser/resolver，加入建 pin 前的来源读取及 topology proof。include 展开和 alias overlay 保留原始 UTF-16 span。原生 Red 暴露旧同名／同值 fallback 会选择同值兄弟节点并丢失 delete 来源；ingest owner 已按原始 file-version/span/name 建索引，重复 include 也复用同一 occurrence。来源证明以真实 local 对象字节对照完整有序 effect chain，包含 delete 和非标量 cells。PostgreSQL 双连接覆盖 metadata 更新、member alias 更新、新 member/effect 插入，以及发现阶段之前已进行的 member 插入。容量拒绝的稳定错误码另有 Red/Green 修正。

五文件聚焦运行（`sourcePropertyProof.integration.test.ts`、`ingestService.test.ts`、`configSetResolver.test.ts`、`parser.test.ts`、`canonicalJsonSource.integration.test.ts`）在 helper-owned 临时 PostgreSQL 根库 **49/49 通过、无跳过**；Node TypeScript 编译通过。这仅是有界本地证据。后续独立评审发现生命周期兼容性及未 pin 删除触发器问题；新增原生反例共 **16 项：12 通过／4 失败／0 跳过**（validated/compiled/pending-approval 来源证明被拒；允许的 DELETE 返回零行）。畸形 member 的疑点正在对照 proof 独立解析全部 member 的路径核验。两份评审收齐后才统一修补生产代码。0151 保持已记录的冻结 digest；必要修正须使用经评审的新增后继迁移，不改原迁移或数据库 checksum。T1.1 和 boundary/relocation 门禁仍未完成。

### 完整来源图后继修订与来源 owner 推进 — 2026-09-17

畸形 member 的疑点已由 exact proof 独立解析全部 DTS member 的路径排除。生命周期与元数据类型／容量检查已修复，历史读取策略不变。新增完整图 mutation 用例在 0151 上真实失败：最初 20 条 SQL 断言中 18 条失败。两名独立评审通过 schema §2.8 后，父端才实施新增迁移 0152；冻结的 0151 保持不变。

全新 helper-owned PostgreSQL 四文件 **57/57 通过**：migration 12、exact source proof 25、source sync 9、JSON 11。覆盖未选中图记录、property 为空的 delete effect、六类 OLD 未 pin／NEW 已 pin 移动、混合语句回滚、真实未 pin DELETE RETURNING／提交后不存在／回滚恢复、双向首次 pin 与 child writer 竞争、旧 REPEATABLE READ 快照拒绝、实际 migration owner 插入 pin，以及五个既有角色的精确列／函数权限。SQL 与设计一致性的 Spec 评审通过；整体候选评审仍未完成。另一次此前运行中 drafts 13/13、Catalog roles 25/25 通过，包含全新与逐步升级至 0152 的 ACL 等价。

来源同步、JSON 注册和已评审来源提交均在读取 bytes／facts 前取得完整 source-prefix；新 JSON revision 在首 pin 前完整构造，并复核版本的全部 membership。`55P03/40001` 作为整事务回滚后可重试冲突。随后 JSON **12/12 通过**，新增两名作者针对同一 base 提交不同真实请求：恰好一次审批成功、败者重试为 stale、一条 history／applied audit 增量、授权重放完全一致、历史导出不变。子智能体报告 adapter／replacement **14/14**，另有 value-only adapter 拒绝测试 **7/7**，未放宽 approved-source 边界。

来源 consumer 与旧导入入口的 canonical 查询改为 Binding／value owner 的类型化操作。Boundary 策略／allowance／relocation hash 均未改动；剩余测试夹具和精确 relocation 门禁仍是独立阻断。上述均为本地未提交 Scratch 证据，不是完整 S1、Hosted、目标或发布证据，不授权下一 todo、提交、PR、合并、持久数据库重置或生产操作。

### Owner 路由回归与身份门禁 — 2026-09-17

较宽检查点在 80 文件收集 **648 项：627 通过／21 失败／0 跳过**。失败分别为 replacement execute／guards／preview 夹具 17 项、Binding concurrency 1 项、archive trigger inventory 1 项及 Binding／value 来源隔离断言 2 项。后续限定运行已修正归档清单，两组隔离测试 **9/9 通过**；replacement／concurrency 修复单独跟踪，不默认为绿。未重跑或认证该较宽套件。

独立 Standards 复核已关闭 mixed-revision P1 及过晚 candidate lock P2：prepare／commit 均发现、锁定并重读全部当前来源 cohort；混合 revision 拒绝，sibling snapshot 必须属于同一 revision，删除无必要的过晚 candidate 锁。原生 mixed-revision 回滚探针覆盖共享 guard。JSON 测试现通过真实 module／registration、file／config-set、draft→submit owner 及类型化 value 读取；具名本地 bootstrap 和租户／项目限定的固定回滚快照替代直接 canonical 夹具／观察 SQL，不提供通用查询代理，也不认证 publication。最新 JSON＋draft 两文件在临时原生 PostgreSQL 和真实本地对象存储 **25/25 通过、无跳过**。Node 类型检查及 diff 检查通过。

只读边界扫描现发现 **3513 条 occurrence**，与已接受 main 数量一致，JSON integration 文件为零。数量相同不等同门禁通过：未修改的正式 checker 仍因 `ingestService.ts` 历史 runtime-topology destination 整文件 blob 不符而拒绝；`schemas.ts` 和 `overlayWriteback.ts` 也保留此前记录的独立身份义务。未改 scanner、baseline、allowance、旧 relocation 记录或固定 hash。新的精确字节身份决策需要明确授权和独立评审后才能实施。T1.1 保持未勾选；这些有界结果不启动 T1.2、封存、提交、PR、合并或生产操作。

本轮检查：`npm run build` 通过，保留 browser externalization 与大 chunk 警告。`npm run docs:check` 在全新 helper-owned、已迁移的 pgvector 数据库通过，包含 schema artifact、无跳过。冻结 0151 SHA-256 仍为 `b2740b8ef3854661ef156bf63d0f83ba72403b41ba616ca0c02961964f65ed64`。这些检查不替代仍开放的正式边界门禁，也不认证较宽后端套件。

后续有界结果取代上述 replacement／concurrency 单项失败：实施子智能体报告 replacement 套件 **22/22**、provenance **5/5**。它的 concurrency 尝试因 pgvector 连接不可用收集零项，另一次持久 lane clone 报既有 0151 checksum 不符；两次均不计验收，也未修补持久环境。父端在可用临时 lane 重跑 Binding concurrency，**1 通过／1 失败** 定位到两个夹具初始化与赢家首 pin 竞争。改为并发创建 Binding 前预建同一真实来源图，保留全部赢家／重放／租户／CAS 断言；重跑 **2/2 通过**，独立 Standards 接受该有界夹具修正。这些定向通过取代对应失败，不将未重跑的 80 文件结果改写为通过。

最后的有界夹具评审已关闭两项 P2 证据缺口：混合 revision 回滚对比完整限定状态（新增 member IDs），保留 current-pointer 断言；其余普通 file／config-set 建立改走既有 upload／create owner。独立复核在该窄范围未发现新 P1/P2。修正后 JSON 在全新原生 PostgreSQL 重跑 **12/12 通过**。整体候选评审及独立的精确身份授权门禁仍待完成。

### 授权身份修复与受影响回归——2026-09-17

用户已授权独立精确身份决策。[中英回执](source-workflow-boundary-identity.md) 记录两份独立批准的精确数据设计及 Standards／Spec 双实施 PASS。五份历史记录、digest、原始 fixture、allowance shard 和冻结 0151 均未改动。以已接受 main 为依据的正式边界门禁现已通过：**3513 allowed；unallowed、stale、metadata mismatch、allowance growth 均为零；348 条精确 alias**。聚焦脚本 **四文件 128/128 通过**。这取代先前身份授权／边界失败检查点，不取代 T1.1 整体验收。

主智能体在 helper-owned 一次性 PostgreSQL 中执行新的受影响回归：`npm run test:server -- server/modules/parameter-bindings server/modules/parameter-files server/modules/parameter-catalog-migration server/modules/parameter-topology`，结果 **95 文件／785 测试／零失败／零跳过**。这是明确界定的新选择，不是把旧 80 文件结果重标为通过，也不是仓库全套测试。构建、Node 类型、diff 及原生数据库支持的 docs/schema 检查通过，保留既有构建警告。

整体候选的独立 Standards 和 Spec 评审已启动，针对继承 `f9c710f6a90d67462965a06abd47e33aa200e75e` 后尚未提交的 T1.1 改动，包含未跟踪新增文件。两名评审使用 `gpt-5.6-luna`／`max`，为当前支持的最高推理程度，取代先前会话的 `xhigh` 派发设置。不声明 seal 或精确已提交候选 PASS。T1.1 仍未勾选、T1.2 未启动；没有 commit、PR、合并或生产操作。

同一产品字节上的额外主智能体观察：五个变更后端文件（Catalog 角色、DTS resolver/parser、治理 ingest 单元及集成）**70/70 通过**；十一个变更／新增前端文件 **136/136 通过**，均零跳过。此前端选择不冒充先前十三文件选择。OpenAPI 新鲜度及 error 级 lint 检查通过。原生 UI ratchet 生成将 raw-color 978→973、font-size 214→212、spacing 1237→1233、radius 146→145，其余阈值不变。身份修复续轮未改 UI 行为，早先 PC 观察明确作为历史证据，而非本轮重跑。

兼容性选择另通过 **5 文件／29 测试／零跳过**：`goldenPowerFixture.test.ts`、`seedM1DtsFiles.test.ts`、`matcher.test.ts`、publication 的 `capabilities.test.ts` 及 parameter 的 `schemas.test.ts`。这些有界检查保留 golden 解析／种子、能力与 DTO 断言，不代表生产种子资格或完整能力发布。

### 新鲜 HTTP／PC 证据与重开的存量升级门禁

主智能体在新建一次性 API `http://127.0.0.1:55532` 上重跑 `work/t11-http-loop.ts`：DTS 与 JSON 均通过真实鉴权 preview → staged draft（当前源不变）→ submit → 不同审核员查看源 diff → 自审拒绝 → apply → replay → 精确历史导出及旧／当前包重新导入验证。请求分别为 DTS `pvcr_7bbcc6b9-5e12-4259-bc3a-17963204d7f3`、JSON `pvcr_741c5d82-5c9c-44b1-a1e2-49d4cd5c12b6`。本地 fixture 不代表生产发布或最终种子资格。

新鲜浏览器观察使用 `playwright-cli`、PC **1440×900**、API runtime `http://127.0.0.1:5174/parameters?project=aurora`（`liu.min`）和 `/parameter-review?project=aurora`（`sun.mei`）。非法 JSON 显示中文错误且 `aria-invalid=true`；真实草稿立即进入托盘，当前 45.625 不变。提交显示固定 diff 及两个受影响绑定，另一用户通过键盘 focus＋Enter 批准，刷新显示 **46.875**。DTS 仍可读为 `<1250>`，本续轮 DTS 编辑闭环为 HTTP，不冒充新鲜 UI 编辑。两个最终会话均零 console error、各两条既有 CopilotKit warning；初始未登录 401 和刻意非法 JSON 400 保留为预期探针。观察到 source/topology/review 请求 200。视口宽 1440 时 pageWidth 为 1440，检查截图未见这些状态中的遮挡或横向溢出。

已检查本工作树产物：`work/ui-checks/t11-final-json-error.png`、`t11-final-review-diff.png`、`t11-final-author.png`；CLI snapshot/log 位于 `.playwright-cli/`。刷新先处理 dirty-form 的 beforeunload 提示，起初受阻截图不算验收。两浏览器和 55532／5174 端口均已停止。SIGINT 打断自动清理（退出 130）；主智能体核验精确测试 marker 和 cutover ID 后，仅删除 `wiseeff_acceptance_disposable_t11_pc_mu4u2rrh_87238f9b` 及其带标记对象根目录。未重置持久 lane；截图保留，临时数据可重建但未保留。完整 lint：**0 错误／333 警告**。

**整体候选 Standards：NOT PASS，1 个 P1。** 冻结 `0151_source_occurrence_identity.sql` 在 484–492 行新增 observation/match 可空归属列，却在实际 969–1037 行回填前的 928–950 行拒绝空值，正常存量升级无法到达 observation/match 回填。1024 行又写入 `md5:`，而 500–504 行约束要求规范参数 locator 的 `sha256:`。主智能体已核实顺序及冲突。既有原生测试只覆盖 observation 拒绝，没有正向存量 observation＋match 升级；选定套件全绿不能闭合此例的 B1-01/B1-06。独立 Spec 整体候选结论仍待返回。

0151 保持逐字节冻结。不得将修复悄悄放到 0152：后继无法修复根本无法完成 0151 的升级。主智能体必须重开升级设计，并在实施前解决冻结候选边界；当前结果不允许改校验记录、跳过迁移、删除旧证据、seal、下一 todo 或合并。

### 整体候选评审处置——暂停实施

Standards 仍为 **NOT PASS：1 个 P1**，即上述存量 observation/match 升级。未报告额外硬违规，但不代表整体候选通过。

Spec 返回 **NOT PASS：3 个 P1、1 个 P2**：

1. P1：上述 observation/match 回填及 digest 矛盾（与 Standards 重叠）。
2. P1：schema 契约 §2.6 要求 completed replacement 延迟约束证明新旧 Binding 的 `source_occurrence_id` 相同。0151、0152 均未安装；0151 occurrence resolver 返回 completed replacement 的新 Binding 时也未验证其 occurrence。现有 0144 FK 不保证两个 source occurrence 相等。
3. P1：`loadExactSourceRevisionForProof()` 校验 member 归属／别名／字节，却未验证 entry/include-search-path/overlay-order 的 manifest 语义。`proveExactDtsProperty()` 在下游校验，但 `loadCanonicalSourceSnapshot()` 导出直接使用共享 loader，遗漏该检查。异常 complete manifest 导出路径需要原生拒绝用例；评审提出的反例尚未由主智能体执行。
4. P2：`protect_source_occurrence_identity()` 的不可变字段比较遗漏 `root_pointer_digest`；JSON 行检查只要求非空，不要求等于 root 的规范 digest。

主智能体只读核验已确认这些缺失检查及重叠的 SQL 顺序／digest 冲突。这些是独立静态审查问题，不冒充新执行的利用／升级证据。评审后产品文件未变。按已接受 R3 circuit breaker，在实施前重开设计：明确如何完成存量升级且不悄悄重写冻结 0151 或删除既有 observations；通过获批的不可变迁移策略补 DB 约束；在共享 owner 恢复完整 manifest 校验。先设计、评审必要反例及正向存量回填，再修复。等待用户对冻结候选边界的方向。T1.1 **未完成**，T1.2 未启动。限定边界身份修复仍为 PASS，不外推整体资格。

### 重开设计授权

整体候选评审后，用户已授权重开四项设计。[修复设计](source-occurrence-review-repair-design.md) 仅修改文档，区分未发布候选政策与已应用迁移历史。只读核查发现持久任务 lane 的旧 0151 checksum 与冻结 Scratch 字节不同，未修复任何 checksum。普通后继 0153 无法越过失败的 0151。部署分类及获接受的具体来源证明／回填接口仍是先决条件。本设计轮未改迁移、runtime 代码、生成产物或测试基线；T1.1 仍未勾选。

续轮：用户明确本任务测试范围。修复设计已明确 observation 自有历史图、既有原子锁、规范 digest 与保留 evidence fingerprint 的重放合同；Spec 接受该限定子合同，Standards 条件通过且无新增阻断。Standards 同时接受精确 DTS 空值／默认值兼容规则。两个只读 PostgreSQL／TypeScript digest 向量、文档治理及 diff 检查通过。这些仅为设计／可行性结果；未发布 Scratch 0151 的明确解冻仍待接受，现有 lane／历史及冻结 0151／0152 字节均未改变。未实施修复，未开始下一 todo。

## Documentation Impact Matrix

| 领域 | 处理 | 路径／理由 |
| --- | --- | --- |
| 地图／产品范围 | Review | 既有 #849 与 ADR-0046，范围不变 |
| 计划／状态 | Update | 中英 closure todolist 与本清单记录实际推进 |
| 架构／API／安全 | Review | ADR-0046、来源／Binding 契约及 SECURITY；同步实际身份／ACL 变化 |
| 质量／浏览器 | Review | 导入／草稿／评审／导出的 requirement/operation ID；保留 PC 与角色断言 |
| 可靠性／runbook | Review | 不执行目标或处置；将新增关系纳入归档／恢复清单 |
| 生成产物 | Update | 实现就绪后原生生成 db-schema 与受审角色／schema fingerprint |
| 前端／参考 | Review | 仅更新受影响 DTO／状态说明，不重设计 UI |

## 最终本地验收处置——2026-09-17

上文各实现／设计／阻断检查点按时间保留，其未完成状态不代表当前结论。最终以[整体验收回执](source-occurrence-whole-acceptance.md)为准：R1–R6 已关闭，Standards／Spec 独立复审通过，受影响原生 19 文件 171/171，通过明确真实鉴权上传／同步审计和单 PC 读回。本地 T1.1 勾选完成后停止；不宣称正式 exact-SHA seal、Hosted／目标验收、#849／#853 关闭、提交或合并。

## Documentation Update Gate

维护独立英文伴随页。T1.1 完成前落实全部 Update/Review 项，执行 docs/diff 并记录精确候选和独立评审，缺失证据保持待完成。本矩阵不新增产品决定，也不降低完整流程要求。
