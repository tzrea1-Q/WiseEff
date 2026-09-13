# Catalog 编写与发布

> English: [English](../../../exec-plans/active/2026-09-12-catalog-authoring-publication.md)

状态：**进行中**。CP-00 合同冻结包含在本次变更中。CP-01 只读核验单独记录。不声称已有生产 TypeScript、SQL migration、Hosted 运行、目标机变更、GitHub Issue 或生产启用。

工作包前缀：`CP`。编号是计划内编号，在授权创建 Issue 之前不是 GitHub Issue。

本次冻结已接受的 `origin/main`：`063b12c49dbc134e83103c77b813188e34f09461`（[#826](https://github.com/tzrea1-Q/WiseEff/pull/826) 的 merge）。架构简报使用 `c332ed3cc2893cadc10d50e235f291bb8fd1ac30`；差额是 vendor 后继编译器与 `advance` CLI。每次后续派发前重新 fetch。

规范合同：

- [ADR-0043](../../../adr/0043-catalog-authoring-and-online-publication.md)
- [控制面](../../design-docs/catalog-authoring-and-publication-control-plane.md)
- [基线核验](../../references/catalog-publication-baseline-verification.md)

## 目标

把参数定义从“必须随应用发行的内容”改为“可在产品内受控编写和发布的业务元数据”，同时保留正式 Subject、Definition、不可变 Revision、完整 Catalog Release、唯一同步器和精确历史解释。

完成层级必须分开记录：实现完成、真实 PostgreSQL、真实浏览器、Hosted、目标机证据、生产授权。任何一层都不能推导另一层。

## 范围

包含：

- 类型化产品内编写与受控 YAML 导入进入同一发布管道。
- 冻结的 Artifact / Candidate / Authorization / Job / Activation Receipt。
- 经现有 installer 的在线 `advance` 加上 Receipt。
- 实例内共享的正式定义；显式能力；自托管低风险单人发布仅在真实授权与显式策略下允许。
- 对已安装基线的 `adopted-preexisting`。

不包含：

- 组织私有定义、overlay、来源优先级。
- Web/SQL 写 Catalog 表。
- #824、伪造 P13 退休、再次 bootstrap、seed、改旧 migration。
- 改冻结的 Wayfinder #668 53 节点图。
- 本轮文档波次中的生产主机执行。

## 硬依赖

```text
CP-00（本次冻结）
  ├─ CP-01 精确 Artifact（阻断在线接管，不阻断继续写合同）
  └─ CP-02 持久化/角色
        ├─ CP-03 Builder
        ├─ CP-04 Authorization
        └─ CP-05 在线激活  ← CP-03 + CP-04
              └─ CP-06 运行时/升级门禁
                    └─ CP-07 jobs/API/管理进程
                          └─ CP-08 M1 页面
                                └─ CP-11(M1) → CP-12(限定范围)
CP-09 vendor 适配在 CP-03 之后；通道集成在 CP-07 之后
CP-10 在 M1 路径稳定后
```

不得在 CP-05/06 之前提供页面直写 Catalog。下游可按本冻结写契约测试；上线只能使用已通过其原生门禁的实现。

## 工作包状态

| 工作包 | 风险 | 状态 | 后续 Scratch 可写路径（本波次不改代码） | 停止点 |
| --- | --- | --- | --- | --- |
| CP-00 合同 | R3 设计 / R1 文档 | **本候选** | 文档影响矩阵所列文档 | 可审阅文档。不改产品代码。 |
| CP-01 只读核验 | R1 | **本候选** | `docs/references/catalog-publication-baseline-verification.md` 及中文配对 | 不登录主机、不写 Catalog、不用 fixture 冒充安装包 |
| CP-01 Artifact 写入接管 | R3 | 被主机证据与 CP-00/02 阻断 | publication 接管 adapter | 不 bootstrap/seed/SQL 插入 Catalog |
| CP-02 | R3 | 未派发 | 下一个 migration、`catalog-kernel/security/`、publication 持久化、生成 schema | 共享文件只由本 lane 拥有 |
| CP-03 | R3 | 未派发 | `server/modules/catalog-publication/builder/` | 不写 Catalog |
| CP-04 | R3 | 未派发 | auth 策略、proposals、publication authorization | 角色不由请求体决定；不用假仓库 URL |
| CP-05 | R3 | 未派发 | `catalog-kernel/install/` | 不另造 materializer；不先切再验证 |
| CP-06 | R3 | 未派发 | `productionWire.ts`、release-verification、`parameter-data-mode.ts`、自托管门禁 | 不删除 P13/digest 检查 |
| CP-07 | R3 执行 / R2 HTTP | 未派发 | publication 模块、catalog-api 路由、生成 DTO | handler 不是同步器 |
| CP-08 | R2 | 未派发 | `src/features/parameter-catalog-governance/` 与 ports | mock ≠ 验收 |
| CP-09 | R2 转换 / R3 激活 | 未派发 | vendor 导入适配器 | CP-07 之后不维持第二个 writer |
| CP-10 | R2 / matcher R3 | 未派发 | Builder 操作 + UI | 不静默切换 Binding |
| CP-11 | R3 | 未派发 | 窄测试、e2e | 独立测试者不得先改实现再自称通过 |
| CP-12 | Temporal / 运维 | 未派发 | runbook、经授权的主机 | 默认交可审阅候选，不是业务机执行权 |

本波次之后的 frontier：CP-00 可审阅；CP-01 主机接管 **blocked**（未访问主机）。只有对本候选完成独立审查并另行授权后，才派发 CP-02。未经该授权不得创建 GitHub Issue、开 PR 或打 ready 标签。

## 证据边界

| 层级 | 本波次 |
| --- | --- |
| 文档 / 静态 | 范围内（候选上跑 `docs:check`） |
| 本地纯/假测试 | 未改产品代码，不跑 |
| 真实本地 PostgreSQL | **未运行** |
| 真实浏览器 | **未运行** |
| Hosted/CI | **未运行** |
| 目标主机 | **未访问** |
| 发布 / 生产批准 | **未授予** |

用户报告的主机事实（`crel_acme_1`、digest `sha256:365305492cf3fddb973b65268d1c7b8c60715240e9fd2dac05aa9091f0c38044`、一条定义）是供 CP-01 核验的报告，不是数据库证据。

## Git 与 PR 工作流

- 本轮文档 Scratch 分支：`docs/catalog-authoring-publication-cp00`，从 `origin/main` `063b12c49dbc134e83103c77b813188e34f09461` 检出。
- 实现代理只在功能分支提交。不得推 `main`、开或合 GitHub PR，也不得在合并后同步 `main`。
- 父代理仅在本 lane 达到 `INTEGRATION-READY` **并且**用户授权开 PR 时才开 PR。本波次停止点是可审阅文档候选。
- 后续代码 lane 使用不同 Scratch 分支（`feat/catalog-publication-schema`、`feat/catalog-publication-builder` 等）；共享 migration/OpenAPI/auth/Kernel/CI 时开发 WIP 为 2，否则最多 4 并保留评审容量。
- 合并顺序：CP-00/01 文档 → CP-02 → CP-03/04（路径不重叠可并行 Scratch，共享合同串行）→ CP-05 → CP-06 → CP-07 → CP-08 → CP-11(M1)。CP-09 内容清点可在 CP-03 后进行；未经另行授权不得在主机上安装。
- 立即停止的情况：web 写 Catalog 表、伪造仓库引用、捆绑 #824、伪造 P13、第二个 pointer、先切再验证、未经明确授权的生产主机变更。

建议的后续 Issue 标题（尚未创建）：

| ID | 标题 |
| --- | --- |
| CP-00 | Freeze catalog authoring/publication contract |
| CP-01 | Verify and adopt preexisting Catalog Artifact |
| CP-02 | Publication schema, receipts, and role isolation |
| CP-03 | Complete-successor Builder from typed ChangeSet |
| CP-04 | Catalog publish capabilities, policy, and bound authorization |
| CP-05 | Online activation with pre-commit verification and Receipt |
| CP-06 | Dual application/Catalog readiness and upgrade freeze |
| CP-07 | Publication jobs, API, and manager process |
| CP-08 | M1 page loop on `/parameter-admin/specs` |
| CP-09 | Vendor YAML import on the same pipeline |
| CP-10 | New subjects and revisions |
| CP-11 | Adversarial integration evidence |
| CP-12 | Target enablement and operator handoff |

## T01–T28 归属

见[控制面 §10](../../design-docs/catalog-authoring-and-publication-control-plane.md)。高风险反例在实现前已经分配。

## 后续 lane 的聚焦命令（本波次不声称已运行产品测试）

```bash
npm run docs:check
npm run contract:check
npm run parameter-catalog-boundaries:check
npm run db:schema-doc:check
npm run test:server -- <package-owned test path>
npm run build
npm run selfhost:check
```

带尖括号的形式不能原样执行。新的 publication 测试入口在文件存在后再登记。

## 文档影响矩阵

| 文档 | 动作 | 门禁 |
| --- | --- | --- |
| `docs/exec-plans/active/2026-09-12-catalog-authoring-publication.md` | 新增（英文） | CP-00 |
| `docs/zh-CN/exec-plans/active/2026-09-12-catalog-authoring-publication.md` | 新增中文配对（本文件） | CP-00 |
| `docs/adr/0043-catalog-authoring-and-online-publication.md` | 新增 | CP-00 |
| `docs/zh-CN/design-docs/adr-0043-catalog-authoring-and-online-publication.md` | 新增中文配对 | CP-00 |
| `docs/adr/0040-canonical-parameter-catalog-relational-model.md` | 有限修订来源/权威条款 | CP-00 |
| `docs/zh-CN/design-docs/adr-0040-canonical-parameter-catalog-relational-model.md` | 同上 | CP-00 |
| `docs/adr/0041-platform-schema-catalog-releases-materialize-before-runtime.md` | 有限修订来源/运行时条款 | CP-00 |
| `docs/zh-CN/design-docs/adr-0041-platform-schema-catalog-releases-materialize-before-runtime.md` | 同上 | CP-00 |
| `docs/design-docs/catalog-authoring-and-publication-control-plane.md` | 新增 | CP-00 |
| `docs/zh-CN/design-docs/catalog-authoring-and-publication-control-plane.md` | 新增中文配对 | CP-00 |
| `docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md` | 补记 Receipt、当前 installer、无第二 pointer | CP-00 文本；CP-05 代码 |
| 对应中文页 | 同上 | CP-00 |
| `docs/design-docs/parameter-catalog-api-transition.md` | 补记能力、路由、reason | CP-00 文本；CP-04/07 代码 |
| 对应中文页 | 同上 | CP-00 |
| `docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md` | 补记应用 pin 与 Catalog 激活组合；`new-empty` ≠ P13 | CP-00 文本；CP-06 代码 |
| 对应中文页 | 同上 | CP-00 |
| `docs/design-docs/parameter-catalog-cutover-archive-rollback.md` | 补记 `adopted-preexisting`；不捆绑 #824 | CP-00 文本；CP-01/06/12 |
| 对应中文页 | 同上 | CP-00 |
| `docs/references/catalog-publication-baseline-verification.md` | 新增 CP-01 记录 | CP-01 |
| `docs/zh-CN/references/catalog-publication-baseline-verification.md` | 新增中文配对 | CP-01 |
| `docs/adr/README.md`、`CONTEXT.md` | 索引 ADR-0043；更新术语来源条款 | CP-00 |
| `docs/PLANS.md`、`docs/zh-CN/PLANS.md` | 索引本计划 | CP-00 |
| `docs/design-docs/index.md` 及中文 | 索引控制面 | CP-00 |
| `scripts/bilingual-docs.ts` | 登记控制面配对 | CP-00 |
| `docs/runbooks/catalog-publication.md` | 以后 | CP-07/12 |
| `docs/generated/db-schema.md` | 只允许生成 | CP-02 |
| 冻结的 Wayfinder 53 节点图 | 不改 | — |

旧断言不批量删除。“Proposal 接受不物化”仍要测试。“任何网页都不可能请求正式发布”才是本程序要替换的产品约束。

## 文档更新门禁

- 语言配对是互相链接的独立文件。命令、路径、API 名、状态名和能力名在两种语言中保持英文。
- 事实、目标与未核验状态必须标注。本波次不为 CP-02–CP-12 写 completed。
- 生成 schema/OpenAPI 不手工改。
- 宣称 CP-00 本地绿色前，本候选必须通过 `npm run docs:check`。
- 目标机与生产句子保持 `not-run` / `not-granted`。
- 已改文件中的链接必须可解析。

## 本波次完成清单

- [x] 冻结 SHA 上确认 ADR 编号 0043 未被占用
- [x] ADR-0040/0041 的保留/取代表
- [x] 冻结 ChangeSet、关系、API、reason、能力、T01–T28 owner
- [x] CP-01 记录不把用户简报当成主机证据
- [ ] 对本 SHA 的独立 Standards/Spec 审查
- [ ] 用户授权开 PR
- [ ] Hosted
- [ ] 合并
- [ ] 生产启用
