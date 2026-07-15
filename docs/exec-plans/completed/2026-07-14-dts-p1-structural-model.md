# DTS 结构化核心（P1）Implementation Plan

> **For agentic workers:** 逐任务执行「写失败测试 → FAIL → 实现 → PASS → 提交」。仅在特性分支提交，不开/合 PR。本期最重，任务间有依赖，务必顺序执行。
>
> 隶属主计划：[DTS 参数管理结构化重构 · 主计划](2026-07-14-dts-management-program.md)。前置：**P0 已合并**。背景见[现状评估](../../design-docs/2026-07-14-dts-parameter-management-assessment.md)。

**Goal:** 引入**真 DTS 解析器（产出可无损往返的 CST + 合并解析的节点模型）**、**结构化数据模型（节点树 / 类型化属性 / phandle 引用，作用域为文件版本）**、以及基于结构的**正确身份、类型感知同步、CST 无损回写**。修复现状评估第一层（解析）与第二层（数据模型/兼容性基础）的根因。

**Architecture:**
- 新增纯解析模块 `server/modules/dts/`（lexer + parser → CST；resolver → 合并节点模型；serializer → 无损输出；value-typing → 类型化与规范化）。**不 import `src/`**。
- 新增结构化表（迁移）：`dts_nodes` / `dts_properties` / `dts_phandle_refs`，均挂 `project_parameter_file_versions.id`。
- 上传时（`format=dts`）解析 → 落结构化表 + 由**合并节点模型派生更正确的 `parsed_index`**（节点路径含 `@address`、label 解析、类型规范化值），使现有同步/审阅流直接受益。
- 回写改为**基于 CST 的最小节点替换**，替换 P0 的正则护栏。
- 现有 M1 参数流、`project_parameter_files` API 保持可用；结构化落表以特性开关 `DTS_STRUCTURAL_INGEST`（默认开）控制，可回退。

**Tech Stack:** Node/tsx, PostgreSQL migration, Vitest。解析器**手写 lexer + 递归下降**（DTS overlay/label/类型化值语义超出通用库能力，手写最可控且便于无损 CST）。

**Scope:** 服务端解析 + 结构化落库 + 同步/回写正确性。**不含** include（已决定拒绝）、配置集/基线/dtc 门禁（P2）、前端结构化编辑/差异/检索 UI（P3）。

**Branch:** `feat/dts-structural-model`（P0 合并后从最新 `main` 拉出）。

---

## Contracts（本期锁定的核心契约）

### 值类型 `DtsValueType`
```
"u32-array"     // <42>, <1 2800>, 多行矩阵
"bytes"         // /bits/ 8 <0x19 ...>
"string-list"   // "a", "b"
"phandle-list"  // <&a &b>（纯引用）
"mixed"         // <&gpio 29 0>、<1 2>,<3 4> 多组、cell+ref 混合
"bool"          // 无值属性（存在即 true）
"empty"         // 显式空（如 ranges;）
```

### CST（词法层，逐次出现，供无损回写）
```
DtsDocument   { directives: DtsDirective[]; topLevel: DtsNodeCst[]; source: string }
DtsNodeCst    { kind:"node"; name:string; unitAddress?:string; labels:string[];
                refTarget?:string;        // &label 覆盖块引用的 label（去掉 &）
                isOverlayRoot:boolean;    // "/" 块
                children:(DtsNodeCst|DtsPropertyCst)[]; span:{start:number;end:number} }
DtsPropertyCst{ kind:"property"; name:string; valueType:DtsValueType;
                rawText:string; normalizedValue:string; span:{start:number;end:number} }
```
- `serialize(document)` 必须对未编辑文档**逐字节还原**源文件（对教学范例做往返幂等测试）。

### 合并节点模型（语义层，供身份/同步）
- resolver 把 CST 按 **label / 完整路径** 合并（overlay 多处覆盖 #26、内联 `label:name` 与 `&label` 引用 #27 合并为同一逻辑节点）。
- 每个逻辑节点有**规范路径** `nodePath`（含 `@unitAddress`），例如 `amba/i2c@XXXX0000/chip@6E/sub_module`；同名多实例（`@0/@1`、`@77/@75`）路径唯一、不再碰撞。
- 属性携带 `valueType` + `normalizedValue`（类型感知比较用）+ `rawText`。

### 规范化（消除假 diff，对每种类型）
- `u32-array`/`bytes`/`mixed`：token 化、十六进制小写、去多余空白、多组 `<..>,<..>` 展平为规范序列（保留分组信息于 CST，比较用展平值）。
- `string-list`：按逗号切分、trim、`ok`↔`okay` **不**归一（语义不同，保留）。
- `bool`/`empty`：规范为固定标记。

---

## File Map

| File | Responsibility |
| --- | --- |
| `server/modules/dts/lexer.ts` | DTS 词法（含 `@`、`&`、`:`、`/bits/`、`<>`、`""`、`;`、注释复用 P0 剥离） |
| `server/modules/dts/parser.ts` | 递归下降 → `DtsDocument` CST |
| `server/modules/dts/valueTyping.ts` | RHS → `DtsValueType` + `normalizedValue` |
| `server/modules/dts/resolver.ts` | CST → 合并节点模型（label/路径合并、phandle 收集） |
| `server/modules/dts/serialize.ts` | CST → 源码（无损 + 编辑后序列化） |
| `server/modules/dts/index.ts` | 对外 API：`parseDts` / `resolveDts` / `serializeDts` |
| `server/modules/dts/*.test.ts` | 各单元 + 教学范例 fixture 全覆盖 |
| `server/migrations/0042_dts_structural_model.sql` | `dts_nodes` / `dts_properties` / `dts_phandle_refs` |
| `server/modules/parameter-files/structuralIngest.ts` | 解析 → 落结构化表 + 派生 `parsed_index` |
| `server/modules/parameter-files/structuralRepository.ts` | 结构化表 CRUD |
| `server/modules/parameter-files/parseIndex.ts` | `buildDtsParsedIndex` 改为经合并模型派生 |
| `server/modules/parameter-files/service.ts` | 上传接入 `structuralIngest`（特性开关） |
| `server/modules/parameter-files/writebackService.ts` | `patchDtsProperty` 改为 CST 定位替换 |
| `server/modules/parameter-files/pathMapper.ts` | 保留（兼容回退），身份优先用结构化 `nodePath` |

> 复用 P0 的 `server/modules/parameter-files/__fixtures__/dts-teaching-sample.dts` 作为全期正确性基准。

---

## Git & PR Workflow

- Branch: `feat/dts-structural-model` from latest `main`（P0 合并后）。
- 开发智能体仅在分支提交；架构师评审、验证、开 PR、合并、同步 `main`。

---

## Task 1: Lexer

**Files:** `server/modules/dts/lexer.ts` + test

- [x] **Step 1: 失败测试** — 覆盖 token：标识符（含 `-`/`,` 如 `vendor,led-type`）、`@`、`&`、`:`、数字/十六进制、字符串（含转义与内部 `/*`）、`<` `>` `{` `}` `;` `,`、`/bits/`、`/dts-v1/` `/plugin/` `/include/` 指令 token。
- [x] **Step 2: FAIL** → **Step 3: 实现**（先经 P0 `stripDtsComments`，再产 token 流，保留每 token 的 `span`）→ **Step 4: PASS** → 提交。

---

## Task 2: Parser → CST

**Files:** `server/modules/dts/parser.ts` + test

- [x] **Step 1: 失败测试**（对 fixture 与最小样例）
  - 节点 `name@addr {}`、`label:name {}`、`&label {}`、根 `/ {}`。
  - 属性：整数/多行矩阵、字符串列表、`/bits/ 8 <..>`、phandle `<&x 1 0>`、多组 `<..>,<..>`、布尔（无 `=`）、`ranges;`（empty）。
  - 指令 `/dts-v1/` `/plugin/`；`/include/` **解析为 directive 节点并标记 unsupported**（不展开）。
- [x] **Step 2: FAIL** → **Step 3: 实现递归下降**，产 `DtsDocument`；每节点/属性带 `span`；属性 `valueType`/`normalizedValue` 交 Task 3（先占位，Task 3 后接线）。→ **Step 4: PASS** → 提交。

---

## Task 3: 值类型与规范化

**Files:** `server/modules/dts/valueTyping.ts` + test

- [x] **Step 1: 失败测试** — 断言各 RHS → 正确 `DtsValueType` 与 `normalizedValue`：
  - `<0xB 0x4b>` 与 `<0xb 0x4B>` → 同一 `normalizedValue`（十六进制小写、去空白）。
  - `<1 2>,<3 4>` 与 `<1 2 3 4>` → 同一展平 `normalizedValue`，`valueType="mixed"`（分组信息留 CST）。
  - `"a", "b"` → `string-list`；`<&a &b>` → `phandle-list`；`/bits/ 8 <..>` → `bytes`；无值 → `bool`。
- [x] **Step 2: FAIL** → **Step 3: 实现** → **Step 4: PASS**，接线进 parser → 提交。

---

## Task 4: Resolver（合并节点模型 + phandle 收集）

**Files:** `server/modules/dts/resolver.ts` + test

- [x] **Step 1: 失败测试**
  - `&demo_multi_ref` 两次覆盖（#26）→ 合并为一个逻辑节点，属性并集。
  - 内联 `my_batt:batt_cell` + 之后 `&my_batt {..}`（#27）→ 同一逻辑节点（路径以 `batt_cell` 为准，label `my_batt` 记于 `labels`）。
  - `battery_checker@0` / `@1`、`bypass_chip@77` / `@75` → **不同** `nodePath`，不碰撞。
  - phandle：`<&demo_ic_a &demo_ic_b>` 收集为两条 `phandle_ref`，`target_label` 为 `demo_ic_a`/`demo_ic_b`。
- [x] **Step 2: FAIL** → **Step 3: 实现** resolver：遍历 CST，按 label/路径建逻辑节点图，合并覆盖，产 `{ nodes:[{nodePath, name, unitAddress, labels, compatible?, status?, properties:[{name,valueType,rawText,normalizedValue}], phandleRefs:[...] }] }`。→ **Step 4: PASS** → 提交。

---

## Task 5: Serializer（无损往返）

**Files:** `server/modules/dts/serialize.ts` + test

- [x] **Step 1: 失败测试** — `serializeDts(parseDts(sample)) === sample`（对教学范例逐字节幂等）。另测「编辑单个属性 `normalizedValue`/`rawText` 后仅该属性文本变化，其余逐字节不变」。
- [x] **Step 2: FAIL** → **Step 3: 实现**（基于 `span`：未编辑段直接切片原文；编辑段用新 `rawText` 替换）→ **Step 4: PASS** → 提交。

---

## Task 6: 迁移（结构化表）

**Files:** `server/migrations/0042_dts_structural_model.sql` + `migration.test.ts`

- [x] **Step 1: 写迁移**

```sql
create table if not exists dts_nodes (
  id text primary key,
  file_version_id text not null references project_parameter_file_versions(id) on delete cascade,
  parent_id text references dts_nodes(id) on delete cascade,
  name text not null,
  unit_address text,
  labels jsonb not null default '[]'::jsonb,
  ref_target text,
  is_overlay_root boolean not null default false,
  node_path text not null,
  compatible text,
  status text,
  sort_order integer not null default 0
);
create table if not exists dts_properties (
  id text primary key,
  node_id text not null references dts_nodes(id) on delete cascade,
  name text not null,
  value_type text not null,
  raw_text text not null,
  normalized_value text not null,
  sort_order integer not null default 0
);
create table if not exists dts_phandle_refs (
  id text primary key,
  from_property_id text not null references dts_properties(id) on delete cascade,
  target_label text not null,
  resolved_target_node_id text references dts_nodes(id)
);
create index if not exists dts_nodes_version_path_idx on dts_nodes(file_version_id, node_path);
create index if not exists dts_nodes_parent_idx on dts_nodes(parent_id, sort_order);
create index if not exists dts_properties_node_idx on dts_properties(node_id, name);
create index if not exists dts_nodes_compatible_idx on dts_nodes(file_version_id, compatible) where compatible is not null;
create index if not exists dts_phandle_refs_target_idx on dts_phandle_refs(target_label);
```

- [x] **Step 2: smoke test**（读文件断言含表名/关键列）→ **Step 3:** `npm run db:migrate` → **Step 4: PASS** → 提交。

---

## Task 7: 结构化落库 + 派生 parsed_index

**Files:** `structuralRepository.ts`, `structuralIngest.ts`, `parseIndex.ts` + tests

- [x] **Step 1: 失败测试**
  - `ingestDtsFileVersion(db, versionId, source)`：对 fixture 落 `dts_nodes`/`dts_properties`/`dts_phandle_refs`，节点数/属性数/phandle 数符合预期，`node_path` 含 `@address`。
  - `buildDtsParsedIndex(source)`（改造后）：键为**合并模型的 `nodePath`**，值为 `normalizedValue`；**不含**布尔属性误判、**不再**因 `@address` 碰撞；十六进制/多组等价不产生不同键值。
- [x] **Step 2: FAIL**
- [x] **Step 3: 实现**
  - `structuralRepository`：批量插入节点树/属性/phandle（事务）。
  - `structuralIngest`：`parseDts → resolveDts →` 落库；返回派生的 `parsed_index`（供现有 sync）。
  - `parseIndex.ts` 的 `buildDtsParsedIndex` 改为：`resolveDts(source)` → 遍历逻辑节点/属性 → `{ [nodePath+"/"+propName]: { value: normalizedValue } }`。保留 JSON 分支不变。
- [x] **Step 4: PASS** → 提交。

---

## Task 8: 上传接入（特性开关）

**Files:** `service.ts` + test

- [x] **Step 1: 失败测试** — 上传 fixture（不含 include）：落文件版本后，`DTS_STRUCTURAL_INGEST` 开启时结构化表被填充；派生 `parsed_index` 用于 `syncFileVersion`。include 仍按 P0 拒绝。
- [x] **Step 2: FAIL** → **Step 3: 实现** — 在 `uploadProjectParameterFile` 事务内，`format=dts` 且开关开启时调用 `ingestDtsFileVersion(tx, version.id, source)`；`parsed_index` 来源改为结构化派生。P0 的 unsupported 检测：`@address`/`&label`/布尔/多组现已被结构化支持 → **从 unsupported 列表移除**，仅保留 `include`（硬拒绝）。→ **Step 4: PASS** → 提交。

> 注：P0 的 `detectUnsupportedDtsConstructs` 在 P1 收敛为「仅 include」，其余构造转由结构化解析处理；更新 P0 相关测试。

---

## Task 9: CST 无损回写

**Files:** `writebackService.ts` + test

- [x] **Step 1: 失败测试**
  - 回写多行矩阵属性 → 成功且仅该属性变化，文件其余逐字节不变（对 fixture）。
  - 回写 `@address` 节点内属性（如 `chip@6E/reg`）→ 成功（P0 的护栏解除）。
  - 多组值属性回写 → 成功。
- [x] **Step 2: FAIL** → **Step 3: 实现** — `patchDtsProperty` 改为：`parseDts(content) → resolveDts` 定位目标（按 `nodePath` + 属性名）→ 修改对应 CST 属性 `rawText` → `serializeDts`。移除正则实现与 P0 护栏。JSON 分支不变。→ **Step 4: PASS** → 提交。

---

## Task 10: 集成 + 身份解耦验证

**Files:** `structural.integration.test.ts` + `syncService.test.ts` 增补

- [x] **Step 1: 端到端**（对 fixture）
  - 上传 → 结构化落库 → 派生 index → sync 产草稿（同名多实例不再碰撞：`@0`/`@1` 各自独立命中）。
  - 十六进制/多组等价重排的新版本上传 → **不产生**假 diff 草稿。
  - 合入 → CST 回写 → 新版本 → 再解析幂等。
- [x] **Step 2:** 身份：`findProjectValueBySource` 用结构化 `nodePath` 优先；`(name,module)` 回退保留但记录为兼容路径。
- [x] **Step 3:** `npm run test:server -- server/modules/dts server/modules/parameter-files --run` → PASS → 提交。

---

## Verification Matrix

| Check | Command |
| --- | --- |
| Lexer/Parser/Typing/Resolver/Serialize | `npm run test:server -- server/modules/dts --run` |
| 无损往返 | serialize 幂等测试（Task 5） |
| 迁移 | `npm run db:migrate` + `npm run test:server -- server/modules/parameter-files/migration.test.ts --run` |
| 落库 + 派生 index | `npm run test:server -- server/modules/parameter-files/structuralIngest* --run` |
| 同步/回写 | `npm run test:server -- server/modules/parameter-files --run` |
| 集成 | `npm run test:server -- server/modules/parameter-files/structural.integration.test.ts --run` |
| Build | `npm run build` |
| Docs | `npm run docs:check` |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| 主计划 | `docs/exec-plans/active/2026-07-14-dts-management-program.md` | Review（P1 状态） |
| 领域模型 | `docs/design-docs/domain-model.md` | **Update**（新增结构化实体：节点树/类型化属性/phandle；身份改为 nodePath） |
| 生成的 schema | `docs/generated/db-schema.md` | **Update**（迁移后重生成，如有脚本） |
| API 契约 | `docs/design-docs/api-contract.md` | Review（上传行为/parsed_index 语义变化） |
| 技术债 | `docs/exec-plans/tech-debt-tracker.md` | **Update**（TD-039 主体完成；过渡期 `(name,module)` 回退与特性开关记账；TD-035 关联） |
| 计划登记 | `docs/PLANS.md` / `docs/zh-CN/PLANS.md` | **Update** |
| 架构总览 | `ARCHITECTURE.md` | Review（新增 `server/modules/dts/` 解析子域） |
| 安全 | `docs/SECURITY.md` | Review（解析器处理不可信文件输入的健壮性/资源上限） |

## Documentation Update Gate

移入 `completed/` 前：
- [x] domain-model 已更新结构化实体与身份规则
- [x] db-schema 已重生成（或记录无脚本）
- [x] tech-debt-tracker 记录特性开关/回退与 TD-039 进展
- [x] `docs/PLANS.md` 与 `docs/zh-CN/PLANS.md` 一致
- [x] `npm run docs:check` 通过

> **UI 交互自动化规则：** P1 为纯服务端结构化改造，不改变用户可见交互（前端仍读派生 `parsed_index`）。无需新增 `e2e/acceptance/` 覆盖；结构化编辑/差异/检索的可见 UI 在 P3 引入并补 requirement/operation ID。

---

## Spec Coverage Self-Review（对现状评估问题）

| 评估问题 | 本期解决 | Task |
| --- | --- | --- |
| 注释污染 | P0 已修，结构化路径复用 | 7 |
| 布尔/空属性不可见（#9/#20） | ✅ 结构化捕获 | 2,4,7 |
| `@address` 身份错乱/碰撞（#10/#11/#31） | ✅ nodePath 含地址、不碰撞 | 4,7,10 |
| `&label`/内联 label 合并（#26/#27） | ✅ resolver 合并 | 4 |
| 多 `<>` 组丢数据（#25） | ✅ 保留分组于 CST、比较展平 | 2,3 |
| 多行值回写损坏（#5/#6/#18） | ✅ CST 无损回写 | 5,9 |
| 值无类型 → 假 diff（#22 等） | ✅ 类型化 + 规范化比较 | 3,7,10 |
| phandle 无建模（#8/#23） | ✅ `dts_phandle_refs`（完整性检查留 P2/P3） | 4,6,7 |
| 身份绑死 `(name,module)` | ✅ nodePath 优先，回退保留 | 10 |
| include（#2） | 显式拒绝（决策 #4，不支持） | 8 |

**留待后续：** phandle 引用完整性检查、compatible 影响面、配置集/基线/dtc 门禁、无损导出（P2）；结构化编辑/差异/检索/影响分析/节点级 RBAC（P3）。
