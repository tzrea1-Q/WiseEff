# T1.3 设计 Spec 评审

Model: grok-4.6（要求的 gpt-5.6-luna 不可用）
Verdict: PASS with P2

对 [t13-complete-successor-design.md](t13-complete-successor-design.md) 与 [t13-complete-successor-threat-matrix.md](t13-complete-successor-threat-matrix.md) 的独立复审。作者已按先前 FAIL（P1-1／P1-2／P1-3）修订。对照中英决策对等做了抽查。修订所依赖的生产代码已复核。本评审不改生产代码，也不把 T1.3 标为完成。

先前的 P1-1、P1-2、P1-3 **已关闭**，不再列为未决 P1。可以开始生产实现；下面的 P2 措辞应在同一轮设计修补或首批实现提交中一并处理。

## P1

无未决项。

## P2

1. **残留的「拆分 DTS／JSON」／双编排措辞。** 设计 §5.1 与 PR 计划 D 正确要求混合 `misc` 成员，以及紧挨 `importVendorCatalog` 的编排。实施顺序第 7 步仍写「拆分 materialize 的 DTS／JSON」，PR 计划 B 仍列「种子／发布编排」。只读这两处的实现者可能重现 P1-1。两者都应指向 §5.1／`catalog-publication/import/`。英文双胞胎有同样残留（implementation order step 7 “Split materialize DTS/JSON”；PR Plan B “seed/publication composer”）。

2. **B2-19 应写明预检在 DTS 同步之前。** 设计 §5.2 顺序是：暂存 → 放置屏障 → JSON 预检（无写入）→ DTS 同步 → JSON 注册。因此第 3 步的 mapping／解析失败产生的是**全部绑定为零**，不只是 JSON 绑定为零。矩阵 B2-19 目前只写「JSON 绑定为零」，未写预检先于 DTS 同步。与 §5.2 对齐，避免实现者先同步 DTS 再预检。

3. **`seed_digest` 载荷。** §5.2／B2-16 正确要求对每项目全部三个文件做 SHA-256，避免仅含 DTS 的摘要 `already-complete` 跳过 JSON。「加上既有受审计划身份」仍未点名。在摘要所有者里钉住精确拼接（文件字节的既定顺序，以及哪些计划字段），重放测试才不用猜。

这些不重开门禁、身份、B6 或 124／372 漏洞。它们是给实现者的措辞诚实。

## 已关闭的先前 P1（不要重开）

- **P1-1 混合成员。** JSON 是配置集 `misc`（sort 2），绝不是 overlay。Ingest 清单为 `entryFile: vendor-drivers.dts`，`overlayOrder: [charging-thermal.dts]`，`members` = 三个文件。JSON 是 revision **成员**，不是 DTS 解析／overlay 输入。绑定仍只经 `registerCanonicalJsonSource`，且复用该混合 revision。B2-09／B2-10 现已写清区分。与 `ingestService.ts:850-883`、`canonicalJsonSource.ts:75-88` 一致。
- **P1-2 JSON 写入在屏障之后。** 暂存循环写明「无绑定写入」。放置屏障：`failed` + `SeedInitializationBlockedError` + **零**绑定，无 DTS 同步、无 JSON 注册（B2-13）。第一次 `registerCanonicalJsonSource` 之前对三个项目做 JSON 预检（B2-19）。重放跳过 JSON 注册。预检之后意外的注册失败与后一项目 DTS 同步失败同类：不是 `completed`，也不是 B6 旁路。
- **P1-3 B6 列表上的 ConfigurationSchema。** 暂存注册输入为 `observedSubjectsWithDefinitions ∪ [{ subjectId: 已发布 wiseeff.power-config, subjectKind: "configuration-schema" }]`，在空闲 `business` 模块存在之后、屏障之前。快照缺少该主体是发布失败，不是静默跳过。与 `registration.ts:49-69`（只观察 DTS）和 `canonicalJsonSource.ts:133-134`（要求注册）一致。

## 已关闭的先前 P2（已纳入）

`productPath: "m2-core"`；必填 `documentation` 复制受审 `power-management.json`；只覆盖 `CATALOG_CAPABILITY_ALLOW_LIST.maxChangeSetOps`（不改 `SHARED_BUDGETS`）；额外容量走 `createParameterModule` 且**无** compatible 映射，不用 `registerOrClaimDriver`；B2-11 预言键与 §8 一致；种子 YAML/TOML/ENV 证据是 `materialize.test.ts`；悬空 **29** 个 `&label`／**37** 个缺失 `&name`，不铸造绑定；摘要覆盖三个文件；`createUserInvocation(auth)`；编排紧挨 `importVendorCatalog`。中英决策对等成立（库存 127／119／124、混合 `misc`、屏障、显式 ConfigurationSchema、55438 对 `wiseeff_lane_849`）。

## 已核对并接受

- 库存诚实 127／119／124／372；T1.2 的 `charging_core` 属性合并到 DTS 定位；不另增绑定。
- 两个后继；厂商只读 YAML；ConfigurationSchema 经 `buildCompleteSuccessor`，以前驱为已安装厂商后继。
- 一个模型 `wiseeff.power-config`；键长 18 与 27，低于 31 字符上限；JSON Pointer `/charger.cv.limitMv` 与 `/battery.thermal.targetTempC`。
- TD-124 YAML/TOML/ENV；删除错误的 `TD-124-json-project-source-semantics`。
- 原批准人；不臆造 SQL；策展不在 `materializeSeedSources` 内；初始化规程重放时幂等 claim-or-skip。
- 没有额外 `driver-group`（以及若需要时没有空闲 `business`）时 B6 仍失败关闭，注册列表漏掉 ConfigurationSchema 时也是。
- Helper PG 55438；不用 `wiseeff_lane_849`；本地 ≠ 目标；无新迁移。
- 冻结 v3 保持 32；v4 预算 128 是第二个后继的余量，不是把厂商导入拼进去。

按 §5.1、§5.2、§6.2 作为绑定规程开始实现。在同一轮文档中清掉 P2 残留，避免实施顺序列表把 P1-1 带回来。
