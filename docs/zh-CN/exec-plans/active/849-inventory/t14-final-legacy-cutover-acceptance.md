# T1.4 最终 legacy cutover — 进度回执

> English: [English](../../../../exec-plans/active/849-inventory/t14-final-legacy-cutover-acceptance.md)

状态：**未完成。** Repair A、B1、B2、C 已落地。当前扫描命中不为零（T14-03）。无 SEALED、commit、PR、overlay 410、governance **详情** 410、Issue 更新。

设计 Spec 再评审 `01a0b0a8-0492-434d-6fbb-ac1520d36674` PASS with P2。B2 Spec 再评审 `9e09e874-cae5-4e98-af76-c5f6cd638731` PASS with P2（已折入）。

## Repair A（已落地）

当前 successor 已重绑；历史 dest OID 未改。source-workflow 82；consumer 202（退役 8）。Checker dest-blob 阻塞已解除。

## Repair B1（已落地）

family successor 136 对相同切片。已 ratchet 真正消失的 10 条（OPS 4 + FIL 标识 5 + TOP 路由 1）。分片 **3513→3503**。`s12-ops.json` 为空。

## Repair B2（已落地）

改写切片 successor **51** 对，接在 136 对 family 记录之后。仅该记录设 `requireIdenticalSlice: false` 与 `requireUnchangedEvidence: false`。更粗顺序键与 dest-`byteStart` 并列例外仅在 `requireUnchangedEvidence === false` 时生效。

| | A 之后 | B1 + 10 ratchet 之后 | B2 之后 |
| --- | --- | --- | --- |
| unallowlisted | 236 | 100 | **49** |
| staleAllowances | 197 | 51 | **0** |
| allowlistGrowth | 0 | 0 | 0 |
| 分片 | 3513 | **3503** | **3503** |
| relocation | | 476 | **527** |

剩余 **49** = **48 个新 base-id + 1 条同锚点多余 dest**（writeback `read:project_parameter_bindings` dest 26362）。不要为多余 dest 臆造 span。不能涨 allowlist。

## Repair C（已落地）

B 之后的 live-caller 证明。仅对无产品 API 调用方的面 410。

| 面 | 决定 | 剩余调用方 |
| --- | --- | --- |
| Overlay HTTP | **keep 2xx** | T2.2-MOD DTS coverage adapter |
| `GET /api/v2/parameter-specs?view=governance` **list** | **410** gone-first | MOD picker 已不用。剩余 UI 是 mock/no-catalog。detail 保持 2xx（T2.1 fixture） |
| `/api/v2/parameter-modules` 写入 | **keep 2xx**（已拆除 winning router 上对非 GET `parameterModules.*` 的 catalog-legacy wrap） | mapping panel / driver-registry |
| seedInitialization | 无新 writer | T1.3 no-op + OPS CLI 410 |

## 验证

checker **failed**（49 unallowlisted / 0 stale / 527 relocs）。同一组 `test:scripts` **135 passed**（含 7 条 rewritten-slice）；折入 P2 后 rewritten-slice **8 passed**。

## 剩余 49 条具名 owner（禁止纸面清零）

relocation 不能映射不同前三段 id。禁止涨 allowlist。这些是 successor SQL、CGH 保留面、或测试对这些面的当前扫描命中。删生产 SQL 等于撤销 T2.2。删扫描规则属于后续 Spec。

| 类 | 条数 | Owner | 仍命中原因 |
| --- | --- | --- | --- |
| CGH 保留 overlay／governance **详情**／DTS 路由 | 10 | `parameterSpecHttpAdapter.test.ts`（8）、e2e import-wizard（2） | T2.2-CGH 冻结 keep 2xx。Repair C 不得 410。 |
| FIL 从锁定 binding 取 spec id | 15 | `writebackService.ts`（9，含多余 dest 26362）、conflict／sync 及其测试 | T2.2-FIL 要求 `parameterSpecId`。扫描器仍打这些 token。 |
| MOD successor remap SQL | 13 | `parameter-modules/repository.ts`（4）、`service.test.ts`（8）、recomputeDryRun 测试（1） | 仍 join bindings／revisions／`attribution_subjects`。 |
| TOP DTS 编辑测试 | 8 | `editService.test.ts` | 测试 SQL 仍 delete／update `dts_property_specs`／`parameter_specs`。 |
| KNW | 2 | `parameterReferences.ts`、comparison 测试 | `parameter_spec_id`／`left join parameter_specs`。 |
| DBG | 1 | `debugging/repository.ts` | `parameter_spec_id`。 |

不要为 writeback dest 26362 臆造 span。不要涨分片。

## 剩余

T1.4 清零被这 49 条挡住，需后续扫描器／仅-un Spec。Repair C 已落地（governance **list** 410；overlay／detail／module 写入 keep）。Spec 再评审 `01a0b261-c4e8-4b19-9d7a-2f6e8a15c093` PASS with P2。不 commit。
