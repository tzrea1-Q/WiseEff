# 最小参数升级

> English: [English](../../../exec-plans/active/minimal-parameter-upgrade.md)

状态：实施中。用户于 2026-09-09 批准本范围。基线：`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`。

保留全部非参数记录、原主键和关系、对象字节及任务状态。旧参数表和共享引用保留；新参数以尚无首个发布的空态开始，不伪造发布。通过既有升级入口交付正式新增、读取、修改、基本导入、生产 API/worker 启动、重启持久性和一次实际备份恢复。

采用与计划和 run 绑定的 `--parameter-data-mode new-empty`，不作为运行期绕过。历史迁移和账本不变；未知源和部分转换在停服前拒绝。管理期初始化不能在重启或重复执行时重置数据。迁移后失败保持隔离。

本分支按用户批准的最小范围执行，不继承完整 populated 认证。#824 和 Scratch 单独保留；旧参数等价、mapping/Archive 和 P0–P16 不属于本路径前置条件。未授权合并或生产执行。

## 执行与证据

单人实施、单路 Docker。复用固定旧源 `82344044b436a8dafecefbb85dfd724cecb05e3f` 夹具，先运行纵向探针，再修首个实测失败。旧 HTTP 上传失败如实保留，显式合成生产者只能证明旧 worker 路径。

| 阶段 | 验收 | 当前证据 |
| --- | --- | --- |
| 旧源到迁移 | 完整账本/schema、受保护记录保全 | 真实旧语义切换、重复兼容准备后，0129–0139 全部迁移成功；126 张原表、190 条原记录的原字段全部保留。属于小规模组件探针，非完整升级验收。 |
| 空态到首个真实数据 | 正式页面/API、合法发布、基本导入 | production API 返回未发布空态；真实编译/安装非空首个发布，重启后 API 仍可读取。页面编辑及导入尚未验收。 |
| 升级入口及重启 | 既有控制器、run 绑定初始化、就绪及队列/代理恢复 | 原生 amd64 终端 apply、原用户/节点、首个真实发布、API/worker 正常重启及同 SHA 保全在 34310318652 通过。错误目标及中断执行待完成；本地 ARM 平台拒绝保留。 |
| 保全及恢复 | 逐条原字段/关系、对象、必要任务及实际恢复 | 同一终端 run 的升级和整套恢复均保全 126 张表中 183 条原记录的全部原字段、原对象字节/metadata 及实际队列 payload/状态。新 HTTP 上传和 worker 完成。早期对象故障重试及各存储探针继续单列为组件证据。 |
| 审查及交付 | 稳定候选测试、三个视口、独立审查及 required CI | 三个视口检查了 Catalog 空态、原节点详情、已发布定义。首次登记成功；修复首个 Subject 被隐藏和成功后未刷新的问题。复现并修复初始化误查演示项目，新增延迟加载回归。完整编辑/导入、CI 和独立审查待执行。 |

真实副本、可信目标构建及维护窗口是生产前置材料，不阻塞内部合成实现。若需要新权限或发布语义，必须指出具体受阻操作；不新增通用控制器或检查器。

当前证据为 WIP，非封存候选或服务器目标构建。API/worker 业务使用 ARM 镜像 `sha256:9bb4554d4e20b34a09f452663630bca2d9c4d8121e0af4a3e70a3076c09e0ae9`；重试/首个 Subject 浏览器构建为 `sha256:afd02abed466a6afd93056624b700f65f0fcb69b6777cf4e48d915c4ce8de4cc`，不覆盖之后的刷新、项目初始化及 Redis 恢复改动。Focused 结果：backend 单元 60 项、Catalog 前端 31 项、真实项目加载回归 1 项、离线 Redis 恢复 shell 3 项。浏览器等待窗口在部分观察后超时，该进程非零退出并清理源环境，额外浏览器资源另行清理；不宣称完整浏览器验收通过。

终端探针为 `scripts/run-minimal-upgrade-acceptance.ts`，由 workflow-dispatch 的 `minimal-upgrade` 模式运行。它创建独占的原 Compose 部署并调用 `upgrade.sh`；本地原生 ARM 在创建部署前被拒绝。入口现已加入原有字段/对象/任务 oracle、原成员权限隔离、真实仓库发布、正常重启、同 SHA 执行和联合恢复。成功运行到达之前，这些阶段仍属于未执行；`complete:false` 同时保留页面编辑/导入及中断验收缺口。此中间入口不是已测试的生产手册。

Hosted [34306500953](https://github.com/tzrea1-Q/WiseEff/actions/runs/34306500953) 对应代码 `75a5f88f7849fbb78b7d487a24c5f0e99679378e`，从固定旧源实际构建 amd64 镜像 `sha256:f26bb4fc466ff1a65c980503d1ba8afb32460bc8a9fc04017d05a2f0dc7b3fa4`，在 `old-start` / `minimal-terminal-api-not-ready` 停止，尚未升级或迁移，部署已清理。已复用现有脱敏器补充依赖/命令诊断，不改旧源、不改 timeout。单独的文档 job 因中文计划使用英文节标题失败，标题已修正；本 run 不算 required CI 通过。

Hosted [34307587109](https://github.com/tzrea1-Q/WiseEff/actions/runs/34307587109) 对应代码 `3f7ca488a28dc5875dabc343ce2999b67ea3e7b2`，在升级前的旧环境启动失败：夹具缺少必需的 `XIAOZE_CHECKPOINTER=postgres`。实际旧源镜像为 `sha256:55773c688794fa58fc107219e12f682c4256c3e3d4f442ae40f0637d9158d6d5`，已完成清理。现已补上配置，并在构建前调用固定旧源自己的环境验证器；旧代码和 timeout 保持不变。[34308789909](https://github.com/tzrea1-Q/WiseEff/actions/runs/34308789909) 正在验证 `68f660b61` 的修复及扩展流程，暂不声明结果。

对象恢复实测复现“字节相同、S3 metadata 丢失”，原生 `mc mirror --preserve` 也未保留所需字段。新的本地单机 MinIO 卷恢复已验证原字节、`contentType`、`originalFileName`、`retentionClass` 恢复，备份后的新增对象消失。这是实际停进程备份/恢复组件观察，不是完整终端验收。升级 shell focused 9 项、App 回归 143 项通过；文档治理检查通过，数据库 schema 文档仍待独占数据库验证。

剩余产品接线：Catalog 合同通过仓库评审的包发布，页面提案仅表示发布意图；项目参数工作台仍读旧模型，canonical ProjectValue 需要真实 Binding、来源和配置 revision。保留现有发布规则，不把提案成功或手填来源 ID 当作新的编辑保存流程。本计划不授权扩权或伪造来源。

`34308789909` 随后被取消：旧目标 job 条件也匹配了新增的最小模式。误触发的目标 job 在 `https://example.invalid/` 浏览器预热失败，不算目标验证。终端 job 被中断，没有完成或清理证明。现已在目标条件中排除 `minimal-upgrade`，并加入回归，要求隔离 job 不读取仓库 secrets；12 项 CI 配置测试通过。下次终端运行必须包含此路由修复。

[34309051449](https://github.com/tzrea1-Q/WiseEff/actions/runs/34309051449) 对应 `b7bc76af66f99427a0c4e21d1bf86e217c076141`，真实旧 API 已就绪，随后在 `old-synthetic-business` 失败：bootstrap 夹具误用了已退休的部门名作为组织名。尚未升级，已完成清理。实际旧镜像为 `sha256:e588b50fe38b5603e8399d85e52ca001346cde047447debade2154016da55cce`。现已改用合法的合成组织名，并将 `WISEEFF_PUBLIC_URL` 绑定到实际回环代理端口。selfhost 静态检查已同步到更强的清洁环境 `fdtoverlay` 命令；18 项测试及 `selfhost:check` 通过。[34309386308](https://github.com/tzrea1-Q/WiseEff/actions/runs/34309386308) 正在验证 `be6d17dae`，结果待定。

[34309386308](https://github.com/tzrea1-Q/WiseEff/actions/runs/34309386308) 在 `be6d17dae43d149dfccdba4f7719f7b1101cbb74` 到达 `terminal-apply`：真实原用户/项目/节点/旧参数/log 对象已创建，旧 worker 原生任务已完成。旧镜像为 `sha256:f725bdfea4274ed13c02f3e8c937a5521655d35ea2042ef2478213da73625fce`，候选镜像为 `sha256:7d72c04b59a6529b7c76ba82cccf4ff0f40249c301ed0548ae2de2c46ba54ac4`。控制器执行全部 11 项迁移并观察到 canonical 未发布状态，随后在 `candidate-proxy-public` 返回 70，夹具已清理。本地真实 Caddy 复现了夹具的行内 block 语法错误；改为多行后 `caddy adapt` 通过。探针现改为构建前校验 Caddy、通过真实回环代理检查就绪，并保存脱敏的代理/journal 诊断。本 run 尚未到达逐条记录/对象比较、重启和联合恢复。

当前终端里程碑：[34310318652](https://github.com/tzrea1-Q/WiseEff/actions/runs/34310318652) 在 `c1d44f17f036a561ac46f28fb35f9c1f1e56f234` 通过，[脱敏证据](../../../exec-plans/active/minimal-parameter-upgrade-evidence/terminal-c1d44f17f.json)。同一非空部署完成正式升级、126 张表/183 条原记录逐字段比较、对象保全、原用户登录及权限隔离、新 HTTP/worker 业务、首个仓库发布、正常重启、同 SHA no-op 和包括对象/Redis 的整套恢复，清理完成。候选镜像为 `sha256:33aa2fe161d2a19fbf39d601eed637d2b74a7e4b3e0cc2410bd1d4462b7926c1`。通过的是专用 job，常规 required suites 被跳过，证据仍为 `complete:false`；页面编辑保存/导入和完整浏览器验收仍未完成。下一版探针加入同一部署的错误目标拒绝及真实杀死迁移后的显式恢复，尚未执行。

## 文档影响矩阵

| 范围 | 处理 | 文件 |
| --- | --- | --- |
| 仓库索引 | Review | `AGENTS.md`、`ARCHITECTURE.md` |
| 计划 | Update | 本计划及英文配对 |
| 产品/架构 | Review | `CONTEXT.md`、`docs/design-docs/domain-model.md` |
| 测试/前端 | Review | `docs/developer/verification-matrix.md`、`docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md` |
| 运维/参考 | Update | `ops/self-hosted/upgrade.md`、`ops/self-hosted/upgrade.zh-CN.md` |
| 安全/治理 | Review | `docs/SECURITY.md`、`docs/agents/agent-delivery-protocol.md` |
| 生成 schema | Review | `docs/generated/db-schema.md` |

## 文档更新门禁

全部验收有本候选证据且文档矩阵处理完成前保持 active。关闭前运行 `npm run docs:check`，记录已实测升级/恢复命令、候选和镜像身份、完整源码/diff 及独立审查；代码合并条件与生产执行条件分别判断。
