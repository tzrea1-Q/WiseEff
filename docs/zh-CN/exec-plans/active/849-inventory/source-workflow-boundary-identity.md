# T1.1 精确边界身份后继记录

> English: [English](../../../../exec-plans/active/849-inventory/source-workflow-boundary-identity.md)

状态：独立 Spec 与 Standards 在激活前通过两份精确数据设计，随后通过两部分实施评审。组合实施已通过正式边界门禁和 128 项聚焦脚本测试。此限定身份修复已完成，不代表流程验收、新 allowance 或合并授权。

## 范围与精确数据

未修改的边界门禁拒绝 T1.1 变更后的历史 destination blob 后，用户授权此独立身份修复。原始 fixture、全部 allowance shard、五份旧记录及其固定 digest 保持不变。下述额外七条映射原已拥有 allowance，并非新增债务。

拟议[后继记录](../../../../../scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json) SHA-256 为 `6ae5ba0609e64987e195e282236a4429fe02b50e9c3a0d3473097d9aa9d12a48`，共 82 对原始至当前身份：

| `server/modules/parameter-topology/` 下文件 | 数量 | 精确 destination blob |
| --- | ---: | --- |
| `ingestService.ts` | 20 | `12319db0dfd39eb801ddad858f6a3bd4187e87ef` |
| `schemas.ts` | 3 | `fcf2ca2c5530974baf1eda3c9c9f1d103ffc6cc4` |
| `editService.ts` | 26 | `0d87d79a907eedd265cc4c09519d6ea1228f09dd` |
| `editService.test.ts` | 28 | `22cd470949340763c3e5757d1da1b8ae2d8014d2` |
| `overlayWriteback.ts` | 5 | `2c568b87026190f5dfa640dcb83a063cde46c254` |

两个 editService 文件未变，保留全部 54 条映射。其余三文件保留 28 条 occurrence：21 条曾 relocation，另七条原先按未变位置绑定。每对均保留原始 slice、元数据、列号和稳定结构锚点；同锚点重复项按字节顺序配对。这里只证明身份，不证明周边运行行为等价。

## 拟议组合方式

1. 首先保留 fixture 完整性、可信父提交 ancestry 和 allowance 增长检查。
2. 将旧 runtime-topology 16 对及 edit-service-version-index 59 对记录作为历史先决证明：校验未变的固定 digest、原始 blob 和 Git 中精确历史 destination blob。认证历史记录中的观察值不冒充当前新扫描；Git 对象缺失或记录变更均拒绝。
3. 对固定 82 对后继记录复用严格 relocation 校验器，对照真实当前 scanner 发现与当前整文件字节，禁止 allowance 增长、要求稳定结构锚点。历史 75 个 source endpoint 必须原样出现在后继记录中。不增加任意 destination override、旧策略 fallback、自动重签 hash、SQL 等价匹配或运行时策略参数。
4. 仅后继记录提供这五文件的活动 alias；原 23 对、post-cutover 29 对和 debugging 4 对继续原活动检查。最终 138 个 source ID 与 138 个 observed ID 各自唯一且互不重叠；仍是 3513 条 allowance，保留六项移除。

历史 Git provenance 固定，不由运行时传入：runtime commit `e31226b6cc06c2278230b810bb1becd8dbc1f32a`、tree `d55df1260ea99a60fa38a3101a5e9f5af7c29fc8`；edit commit `8ef8f25179c4be1f4f64d1cb3dfed953dbd1759f`、tree `38f9040e456dcf87d575b6672161fba004bf8b69`。核验这些 tree 和每个 commit-path blob 与未变历史记录一致。历史证明使用独立返回类型，不是活动 relocation outcome。后继另须在每个稳定锚点组内强制字节序：old offset 递增时 new offset 必须严格递增，拒绝同锚点／同 slice 交换。

## 威胁与验证门禁

| 威胁 | 必须观察 |
| --- | --- |
| 新旧记录缺失、部分、篡改或自签 | alias 前拒绝 |
| 原始／历史中间／当前整文件漂移 | 即使 mapped slice 外也拒绝 |
| 缺失／重复／交换／跨文件 pair 或 endpoint | 拒绝，不返回部分 alias |
| 相同 slice 属于另一结构锚点 | 拒绝 |
| 原始 occurrence／allowance 缺失、权限元数据改变或增长 | 拒绝 |
| 后继遗漏历史 endpoint | 拒绝 |
| 新增无关债务、恢复已移除 allowance | inventory 比较仍失败 |
| 当前文件退回旧受审 destination | 拒绝，不 fallback 旧活动策略 |
| 未变 editService 文件 | 完整检查，不从旧记录中丢弃 |

运行聚焦 relocation／checker 脚本测试、以已接受 main `46b6068693942b95f7cba28ee5de6748a97170fa` 为依据的正式 checker、类型／构建、文档及 diff 检查。历史单元证据明确标注历史，新端到端 checker 必须观察真实工作树。实施前完成独立设计批准，宣布此限定修复完成前完成独立实施评审。T1.1 的整体候选／原生／浏览器／Hosted 义务保持独立。

## 新暴露的 consumer 身份——单独批准的设计

82 对后继生效后，未变的完整 inventory 比较暴露另外十文件的 210 条 unallowlisted 与 210 条 stale：parameter-files 验收 2、导入向导验收 2、topology 验收 83、file writeback 21、topology repository 1、import-batch repository 16、parameter service 29、topology port 1、topology client 测试 22、topology client 33。正式门禁仍失败（3303/3513 获允许）；四文件聚焦测试 109/110 通过，仅完整 inventory 断言失败。这是此前阻断后新暴露的身份漂移，不代表 82 对设计已通过完整门禁。

独立的 [210 对提案记录](../../../../../scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json)，SHA-256 `ab82be7c29d061c27131b07badce45112c7881630f03ad248db8613b78f69240`，只对应原已允许身份与当前观察，保留精确 slice、锚点和全部权限／evidence 元数据。不改旧记录、82 对 digest、fixture 或 allowance。提案在 82 对步骤后复用严格 runner，只有两名独立设计评审批准精确字节后才形成 348 个活动 alias。它没有历史前驱记录，不得走 historical proof 路径。

部分 import-batch 观察拥有相同锚点及字节区间，但 scanner evidence 不同（literal 与 resolved-template 检测）。Ordinal 以**锚点加原已要求不变的 token、evidence、column**分组，不能因 offset 相同就配对不同 evidence；组内 old／new offset 必须严格保序。现有精确元数据比较独立拒绝跨组交换。保留同锚点／同 evidence 交换拒绝用例，新增同区间不同 evidence 不混淆的用例。不允许 SQL 归一化或 evidence 字段豁免。

## 当前实施回执

两名评审均在实施前批准上述精确 210 对字节。固定 consumer 配置在前序全部 138 条 alias 后复用严格 runner，并使用要求的 evidence 感知序号分组。最终组合为 **348 条 alias／696 个互异 endpoint**，不是上文中间检查点的 138 条。

- `npm run test:scripts -- scripts/parameter-catalog-allowlist/sourceWorkflowRelocation.test.ts scripts/parameter-catalog-allowlist/runtimeTopologyRelocation.test.ts scripts/parameter-catalog-allowlist/exactRelocation.test.ts scripts/check-parameter-catalog-boundaries.test.ts`：**4 文件／128 通过／0 失败／0 跳过**。Git 对象缺失负例会刻意从空的一次性仓库输出 unknown-revision 诊断。
- `npx tsx scripts/check-parameter-catalog-boundaries.ts --trusted-base-sha 46b6068693942b95f7cba28ee5de6748a97170fa`：**退出 0；3513 allowed／0 unallowed／0 stale／0 metadata mismatch／0 growth；348 alias**。捕获 CLI JSON 后仅摘要展示，未改命令或判定。
- `npm run build` 通过，保留既有浏览器 externalization 和大 chunk 警告；`git diff --check` 通过。两份新记录 digest 与受审字节完全一致，未修改受跟踪历史 fixture 或 allowance 文件。

Standards：**PASS**，无 P1/P2 或需报告的 smell；独立校验十文件 source/destination blob、endpoint 互斥及 195 个序号组，包括五组同区间不同 evidence。Spec：**PASS**，无 P1/P2；固定策略、组合及负例覆盖符合独立批准设计。两名评审均未重复运行慢扫描，上述执行结果由主智能体实际观察。

`npm run docs:check` 在新建、完整迁移的 helper-owned 一次性 pgvector 数据库中通过，包括 schema 产物且无跳过；Node TypeScript 编译通过。T1.1 整体候选评审仍待完成。本回执不授权 commit、PR、Hosted 声明、合并、生产操作或下一 todo。

## Documentation Impact Matrix

| 领域 | 处理 |
| --- | --- |
| 身份策略 | 更新本中英决策，保留历史决策 |
| 状态／证据 | 按实际结果更新中英 T1.1 威胁矩阵及 todo |
| 运行时／API／schema | 本修复不变 |
| 已生成 baseline／allowance | 不变 |

## Documentation Update Gate

维护英文配套版本，报告本修复完成前通过文档检查。边界 checker 通过不能单独勾选 T1.1。
