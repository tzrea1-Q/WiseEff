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
| 升级入口及重启 | 既有控制器、run 绑定初始化、就绪及队列/代理恢复 | 选项、计划/run 及管理初始化已接线，focused shell 检查通过。完整终端流程待 amd64 执行；本地 daemon 为 arm64，保留原平台拒绝。 |
| 保全及恢复 | 逐条原字段/关系、对象、必要任务及实际恢复 | 实际 PG 恢复保留原记录并移除新 schema。新 HTTP 上传 201，worker 完成任务；实际对象存储故障后任务保持延迟，恢复后第 2 次执行完成。Redis 备份/恢复改为停进程复制 AOF，重启后实际 BullMQ 任务恢复。同一终端 run 的 PG/对象/Redis 联合验收仍待执行。 |
| 审查及交付 | 稳定候选测试、三个视口、独立审查及 required CI | 三个视口检查了 Catalog 空态、原节点详情、已发布定义。首次登记成功；修复首个 Subject 被隐藏和成功后未刷新的问题。复现并修复初始化误查演示项目，新增延迟加载回归。完整编辑/导入、CI 和独立审查待执行。 |

真实副本、可信目标构建及维护窗口是生产前置材料，不阻塞内部合成实现。若需要新权限或发布语义，必须指出具体受阻操作；不新增通用控制器或检查器。

当前证据为 WIP，非封存候选或服务器目标构建。API/worker 业务使用 ARM 镜像 `sha256:9bb4554d4e20b34a09f452663630bca2d9c4d8121e0af4a3e70a3076c09e0ae9`；重试/首个 Subject 浏览器构建为 `sha256:afd02abed466a6afd93056624b700f65f0fcb69b6777cf4e48d915c4ce8de4cc`，不覆盖之后的刷新、项目初始化及 Redis 恢复改动。Focused 结果：backend 单元 60 项、Catalog 前端 31 项、真实项目加载回归 1 项、离线 Redis 恢复 shell 3 项。浏览器等待窗口在部分观察后超时，该进程非零退出并清理源环境，额外浏览器资源另行清理；不宣称完整浏览器验收通过。

首个终端探针为 `scripts/run-minimal-upgrade-acceptance.ts`，由 workflow-dispatch 的 `minimal-upgrade` 模式运行。它创建独占的原 Compose 部署并调用 `upgrade.sh`；本地原生 ARM 在创建部署前被拒绝。当前即使执行成功，也仅证明原用户/节点及 Catalog 空态，明确输出 `complete:false`。首次参数写入、记录/对象 oracle 和联合恢复必须在同一流程继续补齐。Hosted 尚未执行，此中间入口不是已测试的生产手册。

剩余产品接线：Catalog 合同通过仓库评审的包发布，页面提案仅表示发布意图；项目参数工作台仍读旧模型，canonical ProjectValue 需要真实 Binding、来源和配置 revision。保留现有发布规则，不把提案成功或手填来源 ID 当作新的编辑保存流程。本计划不授权扩权或伪造来源。

## Documentation Impact Matrix

| 范围 | 处理 | 文件 |
| --- | --- | --- |
| 仓库索引 | Review | `AGENTS.md`、`ARCHITECTURE.md` |
| 计划 | Update | 本计划及英文配对 |
| 产品/架构 | Review | `CONTEXT.md`、`docs/design-docs/domain-model.md` |
| 测试/前端 | Review | `docs/developer/verification-matrix.md`、`docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md` |
| 运维/参考 | Update | `ops/self-hosted/upgrade.md`、`ops/self-hosted/upgrade.zh-CN.md` |
| 安全/治理 | Review | `docs/SECURITY.md`、`docs/agents/agent-delivery-protocol.md` |
| 生成 schema | Review | `docs/generated/db-schema.md` |

## Documentation Update Gate

全部验收有本候选证据且文档矩阵处理完成前保持 active。关闭前运行 `npm run docs:check`，记录已实测升级/恢复命令、候选和镜像身份、完整源码/diff 及独立审查；代码合并条件与生产执行条件分别判断。
