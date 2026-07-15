# DTS 程序后续：硬化收口 + 导入向导对齐 · 方案概要

> 本文是 **P0–P3.1 程序归档后**的后续方案概要，锁定 B/C 两条路线的目标、边界与排序。可执行任务级计划见：
>
> - [DTS 硬化收口（B）](../exec-plans/active/2026-07-15-dts-hardening-closeout.md)
> - [参数批导向导对齐 TD-035（C）](../exec-plans/active/2026-07-15-parameter-import-wizard-td035.md)
>
> Git 发布集成（原定位决策 #1 的「后续独立立项」）**不在本期**，仍待单独立项。

**日期：** 2026-07-15  
**前置：** DTS 程序 P0–P3.1 已归档（`docs/exec-plans/completed/2026-07-14-dts-*`）。

---

## 1. 为何是 B + C，而不是 Git

| 路线 | 说明 | 本期 |
| --- | --- | --- |
| **B 硬化收口** | 消化 TD-039 / TD-040 残余：新建项目无默认配置集、旧面板绕过 Port、身份 fallback、门禁可选增强 | ✅ |
| **C 导入对齐** | 消化 TD-035：批导仍用 fragment 伪解析完整 `.dts`；跳过原因无服务端审计；大文件无服务端解析 | ✅ |
| **A Git 发布** | 配置集/基线 → Git PR/提交 | ❌ 独立立项（依赖 B 的配置集默认化更稳） |

B 与 C **可并行**（不同分支、弱依赖）：C 的服务端 parse 复用 P1 `server/modules/dts/`；B 的 Port 化不阻塞 C。建议 **B 先合或同批合**，避免新建项目在导入向导建项后仍无默认配置集。

---

## 2. 方案 B — 硬化收口（摘要）

### 目标
让「项目 → 默认配置集」自动成立；参数文件管理走 Port；身份以 `source_*` 为主并**可度量/可收紧** fallback；门禁保留子进程默认，schema/容器按开关渐进。

### 锁定决策

| # | 决策 | 结论 |
| --- | --- | --- |
| B1 | 新建项目 | `createProject`（及等价建项路径）成功后**必须**幂等调用 `ensureDefaultConfigSet` |
| B2 | 旧面板 | `ProjectParameterFilesPanel` / `ParameterFileConflictPanel` 改为注入 `ParameterFileRepository`；补 mock + runtime 解析；**禁止**组件内 `createParameterFileClient()` |
| B3 | 身份 fallback | 默认保留 `(name,module)` 回退但**暴露并累计** `identityFallbackUses`；新增 `DTS_IDENTITY_FALLBACK_MODE=allow\|warn\|deny`（默认 `allow`，deny 时回退路径 409）——不在本期强删列 |
| B4 | dt-schema | 可选：`enableDtSchema` 真接线时调用外部工具（缺省 off）；无工具时与 dtc unavailable 同降级语义 |
| B5 | 容器沙箱 | **本期不做实现**；在 SECURITY / TD-040 记「评估结论：维持受限子进程，容器化另立」 |

### 非目标
Git 集成；重写结构化 UI；改教学 fixture；新迁移（除非 env 文档外必须落库——本方案无迁移）。

---

## 3. 方案 C — 导入向导对齐 TD-035（摘要）

### 目标
完整 `.dts` 走真结构解析（nodePath → module 建议）；跳过原因进服务端审计；大文件经服务端解析端点——**前端永不 import `server/`**。

### 锁定决策

| # | 决策 | 结论 |
| --- | --- | --- |
| C1 | 解析权威 | 服务端 `parseDts`/`resolveDts` 为完整 DTS 权威；新增 `POST /api/v1/parameter-import/parse-dts` |
| C2 | 前端小文件 | `parseDtsFull.ts` **优先调上述 API**（mock 内置教学/样例派生）；不再让 `dts-full`  silently 走 `parseDtsFragment` |
| C3 | 共享包 | **本期不抽** `packages/dts-core`（避免范围膨胀）；值类型前端继续用已有 `dtsValueClient` 镜像 |
| C4 | reviewMetadata | 扩 `createImportPreview` / apply 可选 `reviewMetadata`（含 skipReasons）；写入既有 import audit，**无新表** |
| C5 | 大小阈值 | 客户端 >2MB（可配置）强制走服务端端点；小于阈值亦允许走 API（推荐统一走 API 简化路径） |

### 非目标
替换整个 wizard UX；xlsx/csv/json 解析重写；`/include/` 展开（仍拒绝，与程序决策 #4 一致）。

---

## 4. 排序与分支

```
main
 ├─ feat/dts-hardening-closeout          ← B（建议先或并行）
 └─ feat/parameter-import-wizard-td035   ← C（可并行；合入前建议 B 已合或同 PR 说明）
```

每期一分支、TDD、架构师评审后 PR。残余 TD 在各期门禁勾选关闭或降级记账。

---

## 5. 成功标准（跨两期）

- 新建项目后立刻存在 `name=default` 配置集（API 可证）。
- mock 模式下文件/冲突面板可演示，不直连 `:8787`。
- `identityFallbackUses` 可观测；`deny` 模式有测试。
- 导入完整 `.dts` 的行带正确 `nodePath`/`@address` 模块建议；`PARAM-IMPORT-*` 或新 ID 覆盖。
- `reviewMetadata` 出现在审计事件 metadata。
- `docs:check` 通过；TD-035 关闭或大幅收敛；TD-039/040 按任务勾选更新。
