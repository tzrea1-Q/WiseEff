# T2.3a 档案处置与恢复 — 可实现设计

> English: [English](../../../../exec-plans/active/849-inventory/t23a-archive-disposal-design.md)

配套：[威胁矩阵](t23a-archive-disposal-threat-matrix.md)。生产删除前必须独立 Spec。**T2.3a 不删除。**

状态：**Spec 再评审 PASS with P2** `a53d7ed7-9e12-45a2-a3af-ed0889296b01`。本次 PASS **不**授权 T2.3b。

## 1. T2.3a 做什么

冻结 #849 第 4 项在捕获+重建之后的线上删除范围。T0.3 捕获 34 张 per-Project 关系与源字节，行仍在线上。T1.3 重建 Atlas/Aurora/Nebula，没有处置列。T2.3b 只删 **残留**：快照主键里不是当前 successor、也不被 RESTRICT/NO ACTION 护住的那些。整库+对象存储恢复仍归 T3.3。

## 2. 为什么不 DROP

T1.3/T2.2 仍查询 bindings、dts 源结构、canonical catalog、`parameter_specs`／modules。T1.4 剩余 49 条就是这些 SQL。DROP 等于拆 successor。

## 3. 删除集（规范）

输入：组织、项目（该组织的 Atlas/Aurora/Nebula）、`archiveId`、`archiveDigest`、operator 与 approval ref。按精确档案守卫加载 0149 账本与对象；从文档取 34 张表的 `snapshot_pks`；按矩阵表计算 successor；RESTRICT 父键留下；先删 regenerable 子行再删 NO ACTION 父残留；迁走 `dts_reload_run_targets`（rehome **只这一张表**）。**全部**残留 DELETE 只走 `dispose_plane_residue`（SECURITY DEFINER + definer-only allow-list 表，不是 GUC）。普通 DELETE 仍失败。行删完后对 `storage_key` 做独占反向检查。空残留算成功。重放是 no-op。

## 4. 缝

在 `seedInitialization/archive.ts` 旁新增 `planProjectParameterPlaneDisposal`（只读）与 `disposeProjectParameterPlaneResidue`（仅 T2.3b；`materializeSeedSources` 不得调用）。权限严于 `parameter:edit`。新 migration 记相位 `archive-verified` → `rehomed`（只迁 `dts_reload_run_targets`）→ `residue-deleted`，并提供 `dispose_plane_residue` + definer-only allow-list 表，不改 0148/0149/0151/0152。捕获检索今天没有公开 GET；T2.3b 在 cutover 缝上加仅 operator 的按 archive id 读取，不是产品 UI。

## 5. 恢复

operator 可按 archive id 取 v2 捕获；P7 仍走 `restoreArchive`；已删残留只能靠 T3.3 在 T2.3b 之前的恢复点整库还原。T2.3b 不是行级 undelete。

## 6. 嵌入引用

不批量改写 JSONB／Agent checkpoint／日志／URL。旧链的 410／archived notice 就是评审过的最小 stub，不再做第二张 stub 表。非 regenerable 的 RESTRICT/NO ACTION 跳过父行保留完整载荷（具名例外）。

## 7. 具名破坏动作（只提出，不执行）

**名称：** `disposeProjectParameterPlaneResidue`  
**对象：** 一份精确 0149 档案所覆盖的、一个 Atlas/Aurora/Nebula 项目的线上残留行。  
**不含：** DROP／TRUNCATE／删档案对象／preserved 表／successor 主键／其他组织／5432／`wiseeff_lane_849`／目标机。  
**T2.3b 须在 Spec PASS 之后，再对该具名动作做一次确认。** 此前的「全部授权」不能代替这次确认。

## 8. 关键决定

34 张关系以代码为准；只删行不删表；同 id successor 保留；先处理 FK；两套档案分开；不改已应用的 0148/0149；T2.3a 不 commit。
