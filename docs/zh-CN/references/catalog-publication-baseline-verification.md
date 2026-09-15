# Catalog 发布基线核验

> English: [English](../../references/catalog-publication-baseline-verification.md)

状态：**CP-01 只读记录**。不是 Artifact 接管、不是 Catalog 变更、不是生产授权。

本文件由 CP-01 拥有。不得当成 CP-00 合同的第二份副本。合同见 [ADR-0043](../../adr/0043-catalog-authoring-and-online-publication.md)、[控制面](../design-docs/catalog-authoring-and-publication-control-plane.md)、[现行计划](../exec-plans/active/2026-09-12-catalog-authoring-publication.md)。

## 1. SHA

| 项 | 值 | 来源 |
| --- | --- | --- |
| 计划简报中的 main | `c332ed3cc2893cadc10d50e235f291bb8fd1ac30` | 架构简报；**已过期** |
| 本记录的 `origin/main` | `063b12c49dbc134e83103c77b813188e34f09461` | 本会话 `git fetch origin main` |
| 差额 | [#826](https://github.com/tzrea1-Q/WiseEff/pull/826) vendor 后继编译器 + `advance` CLI | `git log c332ed3cc..063b12c49` |
| 本 Scratch 分支 | `docs/catalog-authoring-publication-cp00` | worktree `/private/tmp/wiseeff-catalog-authoring-publication` |
| 会话开始时的用户工作区 | `docs/catalog-repair-status` @ `475695fb9` | 无关；不是本候选 |

相对简报 SHA，#826 只改文档/脚本/测试：

- `scripts/compile-vendor-catalog-release.ts` 及测试
- `scripts/install-catalog-release.ts`（`--mode bootstrap|advance`、期望当前 pin、确认 digest）
- `server/modules/catalog-kernel/install/vendorSuccessor.integration.test.ts`
- `ops/self-hosted/upgrade.md`（及中文）、`operations.md`（及中文）
- verification-matrix / 自托管运行时文档（随 #826 合入）

#826 没有改 ADR 或设计文档。这正是 CP-00 要补的缺口。

## 2. 已核验与未核验

### 在 `063b12c49` 仓库内已核验

| ID | 事实 | 说明 |
| --- | --- | --- |
| R-F1 | 树中最高 migration 前缀是 `0139_parameter_catalog_verification_core.sql` | 下一个编号在 CP-02 合并时确认，不在此预占 |
| R-F2 | `installPublishedRelease` 支持 bootstrap 与 advance，含 `expectedCurrent`、独占锁、Kernel 自有事务 | 代码在 main；本 lane 未重跑 PostgreSQL |
| R-F3 | 第一份 fixture 发布 id `crel_acme_1`，digest `sha256:365305492cf3fddb973b65268d1c7b8c60715240e9fd2dac05aa9091f0c38044` | `validCatalogReleaseBundle()` 的第一份发布；编译器常量 `FIRST_ACME_*` |
| R-F4 | Vendor 后继编译器常量：id `crel_vendor_catalog_1`，version `1.1.0`，publishedAt `2026-09-12T00:00:00Z`，digest `sha256:efc5336e625f0eb6f994223a5f67a57b119e92bda2edb5c209fc901284f126c7` | 测试通过时的仓库编译器输出；**不是**主机安装 |
| R-F5 | 该后继的编译器测试计数：48 subjects、1 alias、114 definitions/revisions | 包含前驱 `csub_acme_power` / `pdef_acme_power_iin_max`；排除 `shared_prop`、`fast_charge_current_limit_ma`、`status`、ambiguous ids |
| R-F6 | `schemas/dts/catalog.json` 列出 **49** 条 `schemaPaths`；`vendorContentHash` `fd4051a43b5d62f050eabd3a57c26e583498c5dda95f1a9c3c701670399042f0`；`importedAt` `2026-07-16T00:00:00.000Z` | 精确清单，不是简报里的“约 50” |
| R-F7 | `schemas/dts/vendor/wiseeff/` 含 **50** 个 YAML 文件 | `common-status.yaml` 在磁盘上且 **不在** `schemaPaths` 中 |
| R-F8 | 编译器排除 `common-status.yaml`、`test-ambiguous-a.yaml`、`test-ambiguous-b.yaml` | 两个测试文件 **在** `schemaPaths` 中；`common-status.yaml` 不在 |
| R-F9 | 列出的 49 个文件均解析为 `lifecycle: active` | 对非 active 的额外跳过在本清单上用不上 |
| R-F10 | 排除两个测试 YAML 后，对列出文件做朴素 `properties:` 遍历：135 个嵌套 property 项，113 个非结构项 | **不是**编译器的 114 条定义。不得把 130 写成已核验定义数 |
| R-F11 | 原始第一份发布包存在于 `server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle.ts` | 这是仓库里 `crel_acme_1` 的来源。它 **不能**证明主机仍保存这些精确字节 |
| R-F12 | Accept Proposal 仍要求 `repositoryReference` | `server/modules/parameter-governance/proposals/command.ts` |
| R-F13 | `readApprovedRuntimePin` 仍要求精确 P13 / writer-retirement fingerprint / pin 匹配 | #826 未改 |
| R-F14 | `parameter-data-mode` 的 new-empty 路径对已安装 Catalog 只读 | #826 未改 |

### 用户报告，**不是**主机核验

| ID | 报告 | 用途 |
| --- | --- | --- |
| H-R1 | 主机以 `new-empty` 升级并 bootstrap 了 `crel_acme_1` | 授权后用采集器核验 |
| H-R2 | 主机 digest `sha256:365305492cf3fddb973b65268d1c7b8c60715240e9fd2dac05aa9091f0c38044` | 同上 |
| H-R3 | 主机当前定义只有 `acme,power` / `iin_max` | 同上 |
| H-R4 | 主机尚未 advance vendor 后继 | 与“不再二次 bootstrap / 不 seed / 不改 Catalog SQL”一致；仍未核验 |

### 未访问 / 未运行

| 项 | 状态 | 拥有者 |
| --- | --- | --- |
| 目标机 PostgreSQL | **未访问。** 未提供 DSN。本 lane 未扫描网络、未登录。 | 人工操作者 |
| 主机部署 data mode | 未核验 | 采集器 |
| 主机 migration 清单与校验和 | 未核验 | 采集器 |
| 主机当前 id/digest/heads | 未核验 | 采集器 |
| 主机 subject/definition/binding/value 计数 | 未核验 | 采集器 |
| 主机引用的历史 release | 未核验 | 采集器 |
| 主机上已安装包的精确字节 | 未核验 | 采集器 + Artifact 存储 |
| 主机上的独立投影校验 | 未核验 | 采集器 / verifier 角色 |
| 从主机字节重编译是否等于当前 pin | 未核验 | 失败则阻断接管 |
| 本波次真实 PostgreSQL 测试 | **未运行** | — |
| 浏览器 / Hosted / 生产 | **未运行** / **未授予** | — |

**阻断：** 在收集下列主机证据之前，该实例的在线发布接管 **blocked**。现有读取可以继续。CP-00 可以继续。不得把缺失的主机包伪装成已完成。

## 3. 仓库 vendor 清单（不是主机 Catalog）

不要把“约 50 个 YAML / 约 130 个属性”写成验收断言。

| 集合 | 数量 | 处置 |
| --- | --- | --- |
| `schemaPaths` | 49 | 权威 vendor 列表 |
| 磁盘 `vendor/wiseeff/*.yaml` | 50 | 额外：`common-status.yaml`（退役/排除，未列入） |
| 列表减去编译器排除项 | 47 | #826 后继编译器输入 |
| 编译器后继 definitions | 114 | 包含 `crel_acme_1` 前驱内容；**仓库测试**，不是主机 |
| 朴素 property 项遍历 | 135 / 113 非结构 | 仅诊断；CP-09 禁止静默丢弃不能转换的字段 |

vendor 编译器可跳过的结构键是构造失败项，例如 `compatible` / `reg` / `#address-cells` / `status`。那些跳过不是被省略的参数。CP-09 仍须列出每个不能转换的字段，并给出阻断或显式批准；不得静默丢弃。

`src/config/power-management.json` 的演示项仍 **不在** vendor 定义集合中（#826 前已锁定）。

## 4. 主机必须提供的最小证据

须经操作者授权、只读、脱敏。日志中不得出现秘密。

1. 实际运行的应用 SHA（镜像/源码 pin）。
2. Catalog data mode（`new-empty`、populated 或其他）。
3. Migration 名称 + 校验和。
4. `catalog_state.current_catalog_release_id` 与 `catalog_releases.release_digest`。
5. 计数：subjects、release memberships、aliases、definitions、heads、bindings、project values、被引用的历史 release id。
6. 该 digest 的 Artifact 字节是否存在于数据库之外（仓库 fixture、编译 YAML 或已存包）。
7. 独立投影指纹 vs 该 digest 的已编译 fixture。
8. 确认 `crel_vendor_catalog_1` **不是** current，除非另有授权的 advance。

若 (6) 或 (7) 失败：**不得接管**。保留读取。不得从投影行重建 Release。digest 不匹配时不得用 `validCatalogReleaseBundle()` 代替主机字节。

## 5. 只读采集器设计（本波次不实现）

拟议路径：`scripts/inspect-catalog-publication-baseline.ts` 及测试。实现是后续带下列保证的小任务。本波次不添加该脚本。

### 保证

- DSN 只来自操作者显式提供的环境变量 `CATALOG_BASELINE_READONLY_DATABASE_URL`。无默认值、无发现、无 compose 网络扫描。
- 以专用角色 `catalog_baseline_reader` 连接，仅对指名 Catalog 与计数关系 `SELECT`。脚本设置 `SET default_transaction_read_only = on`，并在 `REPEATABLE READ` 下 `SET TRANSACTION READ ONLY`。
- 若该角色对 `parameter_catalog.*` 或 `catalog_publication.*` 拥有 INSERT/UPDATE/DELETE/TRUNCATE，失败关闭。
- 永不从数据表行编译 Release。永不 INSERT Artifact 行。永不 bootstrap/seed/advance。
- 永不打印 DSN、密码或 PII。只输出计数与 id/digest。
- 输出一份 JSON 及其规范 JSON 的 SHA-256。该文件是证据，不是 Artifact。

### 建议的只读查询

```sql
SELECT current_catalog_release_id FROM parameter_catalog.catalog_state;
SELECT id, release_version, release_digest, predecessor_release_id
  FROM parameter_catalog.catalog_releases;
SELECT count(*) FROM parameter_catalog.catalog_subjects;
SELECT count(*) FROM parameter_catalog.catalog_release_subjects;
SELECT count(*) FROM parameter_catalog.parameter_definitions;
SELECT count(*) FROM parameter_catalog.definition_revisions;
SELECT count(*) FROM parameter_catalog.project_parameter_bindings;
-- 以及已授权的 organization registrations / project values
```

精确物理名以运行时生成 schema 为准。缺失关系失败关闭。

### 本地编译检查（无主机）

操作者把 **主机导出的 Artifact 字节**（不是投影转储）拷到隔离目录后，第二条命令可以运行 `compileCatalogRelease` 并把 digest 与导出的当前 pin 比较。仅当仓库 fixture 的 digest 等于主机 pin 时，才允许使用该 fixture。

## 6. 接管门禁（不是本波次）

仅当以下全部成立时才可写 `adopted-preexisting`：

- 主机当前 id/digest 与已编译 Artifact 匹配；
- 独立投影检查通过；
- Binding/ProjectValue 计数在前后记录且不变；
- 证明标记为 `adopted-preexisting`，并写明采集时间与批准人；
- 该入口不能被复用为未签名包的通用激活器。

在此之前：该实例 **不得启用** 在线发布。

## 7. 已运行 / 未运行的检查

| 检查 | 结果 |
| --- | --- |
| `git fetch origin main` | `063b12c49` |
| `git log c332ed3cc..063b12c49` | 仅 #826 |
| 阅读 `catalog.json` / vendor 目录 / 编译器常量 / installer / proposal accept / runtime pin 文档 | 见上 |
| 经 `yaml` parse 的朴素 YAML property 遍历 | 135 / 113 |
| `npm test` / `npm run test:server` / 真实 PG / 浏览器 / Hosted / 主机 SQL | **未运行** |
| 主机登录 | **未做** |
